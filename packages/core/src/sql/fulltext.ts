// M5.26 — FULLTEXT indexes and MATCH … AGAINST, as InnoDB answers them.
//
// A FULLTEXT index is kept in its table's definition (`options.fulltext`),
// its name and columns, and is not built: MATCH reads the table and ranks
// each row as InnoDB's index would. What 8.4.11 answered:
//
//   - A FULLTEXT key names CHAR, VARCHAR or TEXT columns (1283 for anything
//     else), shares its name space with the table's other keys, and is
//     refused by an engine without full-text support (1214). MATCH must name
//     the columns of one such index, in any order (1191), and AGAINST a
//     constant (1210).
//   - A word is a run of letters, digits and `_`; an apostrophe ends one.
//     Words shorter than 3 or longer than 84 characters, and InnoDB's
//     stopwords, are not indexed (`fulltext-params.ts`, captured).
//   - A row's rank is the sum, over the query's words, of `tf × idf²`, where
//     tf counts the word in the row and idf is `log10(N / n)` for N rows and
//     n rows holding the word, or `log10(1.0001)` when every row holds it;
//     a word repeated in a natural-language query counts its rows again. The
//     arithmetic is InnoDB's float: each term rounded to a float, and the sum.
//   - BOOLEAN MODE: `+` a word a row must hold, `-` one it must not, `>` and
//     `<` one that adds or takes away 1 from the rank, `~` one that takes 1
//     from a row the earlier terms matched, `word*` a prefix, `"…"` a phrase
//     whose words stand together, and parentheses a group. A row matches when
//     it holds every `+` term, no `-` term and, with no `+` term, any other.
//     The grammar's errors are 1064 with Bison's words, as the server's are.
//
// More than 32 levels of parentheses is 209, as InnoDB's parser has it.
//
// Named divergences: WITH QUERY EXPANSION is refused; InnoDB applies a
// transaction's changes to the index at its commit, and counts the rows of
// an UPDATE's old version in a prefix's or a boolean query's statistics
// until OPTIMIZE TABLE, where this reads the rows as they are; and a prefix
// term's tf is the largest of its words' in the row.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { collation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, TableDef } from '@myjs/engine'
import { SqlError, messages, sqlError } from '@myjs/protocol'
import { toText, type Value } from '@myjs/types'
import { FT_MAX_TOKEN, FT_MIN_TOKEN, FT_STOPWORDS } from './fulltext-params.ts'

export interface FulltextDef {
  readonly name: string
  readonly columns: readonly string[]
}

export function fulltextOf(def: { readonly options?: Readonly<Record<string, unknown>> }): FulltextDef[] {
  const stored = def.options?.['fulltext']
  return Array.isArray(stored) ? (stored as FulltextDef[]) : []
}

const TEXT_TYPES: ReadonlySet<number> = new Set([FIELD_TYPE.STRING, FIELD_TYPE.VAR_STRING, FIELD_TYPE.VARCHAR, FIELD_TYPE.TINY_BLOB, FIELD_TYPE.BLOB, FIELD_TYPE.MEDIUM_BLOB, FIELD_TYPE.LONG_BLOB])

/** A FULLTEXT key's columns, checked: text columns of an engine that has full-text search. */
export function checkFulltext(engine: string, columns: readonly ColumnDef[], names: readonly string[], descending = false): void {
  if (descending) throw sqlError('ER_WRONG_USAGE', 'Incorrect usage of spatial/fulltext/hash index and explicit index order')
  if (engine === 'memory') throw sqlError('ER_TABLE_CANT_HANDLE_FT', "The used table type doesn't support FULLTEXT indexes")
  let charset: string | undefined
  for (const name of names) {
    const c = columns.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (c === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${name}' doesn't exist in table`)
    if (c.type.type === FIELD_TYPE.JSON) throw sqlError('ER_JSON_USED_AS_KEY', `JSON column '${c.name}' supports indexing only via generated columns on a specified JSON path.`)
    // Every column of one index is text in one character set (8.4.11: 1283 on the first that is not).
    const own = c.type.collationId === undefined || c.type.collationId === CHARSET_BINARY ? undefined : requireCollationInfo(c.type.collationId).charset
    if (!TEXT_TYPES.has(c.type.type) || own === undefined || (charset !== undefined && own !== charset)) {
      throw sqlError('ER_BAD_FT_COLUMN', `Column '${c.name}' cannot be part of FULLTEXT index`)
    }
    charset = own
  }
}

// --- words ------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}_]+/gu

/** A word as the index compares it: its collation's sort key, so 'Müller' and 'muller' meet where the collation says they do. */
function folder(collationId: number): (w: string) => string {
  const c = collation(collationId)
  return (w) => {
    const key = c.sortKey(encodeCollation(w, collationId))
    let out = ''
    for (const b of key) out += String.fromCharCode(b)
    return out
  }
}

/** Whether a word is one the index keeps. */
function indexed(word: string): boolean {
  const length = [...word].length
  return length >= FT_MIN_TOKEN && length <= FT_MAX_TOKEN && !FT_STOPWORDS.has(word.toLowerCase())
}

/** A document's words, in order, folded; the ones the index leaves out are gone. */
export function wordsOf(text: string, fold: (w: string) => string, raw?: Map<string, string>): string[] {
  const out: string[] = []
  for (const m of text.matchAll(WORD)) {
    if (!indexed(m[0])) continue
    const key = fold(m[0])
    if (raw !== undefined && !raw.has(key)) raw.set(key, m[0])
    out.push(key)
  }
  return out
}

// --- the boolean grammar ----------------------------------------------------------

type Op = '+' | '-' | '~' | '<' | '>' | ''

export type Term =
  | { readonly kind: 'word'; readonly op: Op; readonly word: string; readonly prefix: boolean; readonly times?: number }
  | { readonly kind: 'phrase'; readonly op: Op; readonly words: readonly string[]; readonly within?: number }
  | { readonly kind: 'group'; readonly op: Op; readonly terms: readonly Term[] }

const syntax = (detail: string) => sqlError('ER_PARSE_ERROR', `syntax error, ${detail}`)

/**
 * A BOOLEAN MODE query: `fts0pars.y`'s grammar, read with the errors 8.4.11
 * gives. An operator must be followed by a word, a phrase or a group; `*`
 * ends a word; `@` belongs only after a phrase. A word too short, too long or
 * a stopword stays in the tree and matches nothing.
 */
export function parseBoolean(query: string, fold: (w: string) => string): Term[] {
  let i = 0
  const n = query.length
  const space = () => {
    while (i < n && !/[\p{L}\p{N}_+\-~<>()"*@]/u.test(query[i] as string)) i++
  }
  // A token as Bison names it: a word FTS_TERM, a number FTS_NUMB, a phrase FTS_TEXT, anything else itself.
  const describe = (c: string | undefined) => {
    if (c === undefined) return '$end'
    if (c === '"') return 'FTS_TEXT'
    if (/[\p{L}\p{N}_]/u.test(c)) return /^\d+(?![\p{L}_])/u.test(query.slice(i)) ? 'FTS_NUMB' : 'FTS_TERM'
    return `'${c}'`
  }
  const list = (depth: number): Term[] => {
    // InnoDB's parser stops at 32 levels: a handler error, 209, with no
    // symbol of its own in the server's error table (8.4.11).
    if (depth > 32) throw new SqlError('HA_ERR_FTS_TOO_MANY_NESTED_EXP', 'Too many nested sub-expressions in a full-text search', { errno: 209, sqlState: 'HY000' })
    const terms: Term[] = []
    for (;;) {
      space()
      const c = query[i]
      if (c === undefined) {
        if (depth > 0) throw syntax('unexpected $end')
        return merged(terms)
      }
      if (c === ')') {
        if (depth === 0) throw syntax("unexpected ')', expecting $end")
        i++
        return merged(terms)
      }
      let op: Op = ''
      if ('+-~<>'.includes(c)) {
        op = c as Op
        i++
        space()
        const next = query[i]
        if (next === undefined) throw syntax('unexpected $end')
        if ('+-~<>)*@'.includes(next)) throw syntax(`unexpected ${describe(next)}`)
      }
      const d = query[i] as string
      if (d === '(') {
        i++
        terms.push({ kind: 'group', op, terms: list(depth + 1) })
      } else if (d === '"') {
        // A phrase's words the index leaves out
        // are left out of it too, and one with no words left is no term at
        // all (8.4.11: `'+"" words'` is `'words'`).
        const close = query.indexOf('"', i + 1)
        const body = close < 0 ? query.slice(i + 1) : query.slice(i + 1, close)
        i = close < 0 ? n : close + 1
        const words = [...body.matchAll(WORD)].filter((m) => indexed(m[0])).map((m) => fold(m[0]))
        space()
        let within: number | undefined
        if (query[i] === '@') {
          i++
          space()
          if (!/\d/.test(query[i] ?? '')) throw syntax(`unexpected ${describe(query[i])}, expecting FTS_NUMB`)
          const at = i
          while (/\d/.test(query[i] ?? '')) i++
          within = Number(query.slice(at, i))
        }
        // Unclosed, it is its words, each a term of its own (8.4.11: `'"more words'` finds 'words' alone).
        if (close < 0) for (const word of words) terms.push({ kind: 'word', op, word, prefix: false })
        else if (words.length > 0) terms.push({ kind: 'phrase', op, words, ...(within === undefined ? {} : { within }) })
      } else if (d === '*' || d === '@') {
        throw syntax(d === '*' ? "unexpected $end, expecting FTS_TERM or FTS_NUMB or '*'" : "unexpected '@', expecting $end")
      } else {
        // A sticky copy: `WORD`'s own lastIndex is what `matchAll` starts from.
        const at = new RegExp(WORD.source, 'uy')
        at.lastIndex = i
        const word = at.exec(query)?.[0] ?? ''
        if (word === '') throw syntax(`unexpected ${describe(query[i])}`)
        i += word.length
        let prefix = false
        if (query[i] === '*') {
          i++
          prefix = true
          if (query[i] === '*') throw syntax("unexpected $end, expecting FTS_TERM or FTS_NUMB or '*'")
        }
        // A prefix may be shorter than a word the index keeps; a word may not.
        // A prefix is kept as written, and compared by folding each word cut to its length.
        terms.push({ kind: 'word', op, word: prefix ? word : indexed(word) ? fold(word) : '\u0000', prefix })
        if (query[i] === '@') throw syntax("unexpected '@', expecting $end")
      }
    }
  }
  return list(0)
}

/** A word asked twice is one term that counts its rows twice, as a natural-language query's is (8.4.11: `'data data'`). */
function merged(terms: Term[]): Term[] {
  const out: Term[] = []
  for (const t of terms) {
    const at = t.kind === 'word' && !t.prefix ? out.findIndex((u) => u.kind === 'word' && !u.prefix && u.op === t.op && u.word === t.word) : -1
    const same = out[at]
    if (same !== undefined && same.kind === 'word') out[at] = { ...same, times: (same.times ?? 1) + 1 }
    else out.push(t)
  }
  return out
}

// --- ranking ----------------------------------------------------------------------

/** The rows' words, and how many rows hold each: what a query is ranked against. */
export class Corpus {
  readonly rows: number
  readonly #docs = new Map<string, number>()
  readonly #raw: ReadonlyMap<string, string>
  readonly #fold: (w: string) => string
  readonly #prefixes = new Map<string, Map<string, boolean>>()

  /** `documents` are folded words; `raw` a word as written for each, which a prefix is matched against. */
  constructor(documents: readonly (readonly string[])[], raw: ReadonlyMap<string, string>, fold: (w: string) => string) {
    this.rows = documents.length
    this.#raw = raw
    this.#fold = fold
    for (const d of documents) for (const w of new Set(d)) this.#docs.set(w, (this.#docs.get(w) ?? 0) + 1)
  }

  /** Whether a folded word starts with a prefix, as the collation compares them. */
  starts(key: string, prefix: string): boolean {
    let seen = this.#prefixes.get(prefix)
    if (seen === undefined) this.#prefixes.set(prefix, (seen = new Map()))
    let hit = seen.get(key)
    if (hit === undefined) {
      const raw = this.#raw.get(key) ?? ''
      hit = this.#fold([...raw].slice(0, [...prefix].length).join('')) === this.#fold(prefix)
      seen.set(key, hit)
    }
    return hit
  }

  /** How many rows hold a word, or any word with a prefix. */
  holding(word: string, prefix: boolean): number {
    if (!prefix) return this.#docs.get(word) ?? 0
    let total = 0
    for (const [w, count] of this.#docs) if (this.starts(w, word)) total += count
    return total
  }

  /** `idf²` for a word held by `count` rows. */
  weight(count: number): number {
    const idf = this.rows > count ? Math.log10(this.rows / count) : Math.log10(1.0001)
    return idf * idf
  }
}

const f32 = Math.fround

/** The occurrences of a word, or the most of any word with a prefix, in a row's words. */
function frequency(words: readonly string[], word: string, prefix: boolean, corpus?: Corpus): number {
  if (!prefix || corpus === undefined) return words.reduce((n, w) => (w === word ? n + 1 : n), 0)
  const counts = new Map<string, number>()
  for (const w of words) if (corpus.starts(w, word)) counts.set(w, (counts.get(w) ?? 0) + 1)
  return Math.max(0, ...counts.values())
}

/** A natural-language query's rank for a row. */
export function naturalRank(corpus: Corpus, query: readonly string[], words: readonly string[]): number {
  const asked = new Map<string, number>()
  for (const q of query) asked.set(q, (asked.get(q) ?? 0) + 1)
  let rank = 0
  for (const [word, times] of [...asked].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const tf = frequency(words, word, false)
    if (tf === 0) continue
    rank = f32(rank + f32(tf * corpus.weight(corpus.holding(word, false) * times)))
  }
  return rank
}

/** Whether `words` holds `phrase`'s words side by side, or, `"a b"@n`, all within a span of n words. */
function holdsPhrase(words: readonly string[], phrase: readonly string[], within: number | undefined): boolean {
  if (phrase.length === 0) return false
  if (within !== undefined) {
    for (let i = 0; i < words.length; i++) {
      const span = words.slice(i, i + Math.max(within, phrase.length))
      if (phrase.every((p) => span.includes(p)) && span.includes(words[i] as string) && phrase.includes(words[i] as string)) return true
    }
    return false
  }
  for (let i = 0; i + phrase.length <= words.length; i++) if (phrase.every((p, k) => words[i + k] === p)) return true
  return false
}

/** A boolean query's answer for a row: whether it matches, and its rank. */
export function booleanRank(corpus: Corpus, terms: readonly Term[], words: readonly string[]): { readonly matched: boolean; readonly rank: number } {
  let matched = false
  let rank = 0
  for (const t of terms) {
    const r = termRank(corpus, t, words)
    if (t.op === '-') {
      if (r !== undefined) return { matched: false, rank: 0 }
      continue
    }
    if (r === undefined) {
      if (t.op === '+') return { matched: false, rank: 0 }
      continue
    }
    // The term's rank is added, then its weight, each rounded: `>` adds 1,
    // `<` and `~` take 1 away, and `~` counts only against a row the terms
    // before it matched.
    if (t.op === '~') {
      if (matched) rank = f32(f32(rank + r) - 1)
      continue
    }
    rank = f32(rank + r)
    if (t.op === '>') rank = f32(rank + 1)
    else if (t.op === '<') rank = f32(rank - 1)
    matched = true
  }
  return { matched, rank }
}

/** One term's rank in a row, or `undefined` when the row does not hold it. */
function termRank(corpus: Corpus, t: Term, words: readonly string[]): number | undefined {
  switch (t.kind) {
    case 'word': {
      const tf = frequency(words, t.word, t.prefix, corpus)
      return tf === 0 ? undefined : f32(tf * corpus.weight(corpus.holding(t.word, t.prefix) * (t.times ?? 1)))
    }
    case 'phrase': {
      if (!holdsPhrase(words, t.words, t.within)) return undefined
      let rank = 0
      for (const w of new Set(t.words)) rank = f32(rank + f32(frequency(words, w, false) * corpus.weight(corpus.holding(w, false))))
      return rank
    }
    case 'group': {
      const inner = booleanRank(corpus, t.terms, words)
      return inner.matched ? inner.rank : undefined
    }
  }
}

/** AGAINST's argument as text; NULL searches for nothing. */
export const queryText = (v: Value): string => (v === null ? '' : toText(v))

export const noIndex = () => sqlError('ER_FT_MATCHING_KEY_NOT_FOUND', "Can't find FULLTEXT index matching the column list")
export const badAgainst = () => sqlError('ER_WRONG_ARGUMENTS', 'Incorrect arguments to AGAINST')
export const noExpansion = () => sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported('WITH QUERY EXPANSION'))

/** The fold a set of columns' words take: their collation's. */
export function foldFor(def: TableDef, columns: readonly string[]): (w: string) => string {
  const c = def.columns.find((x) => x.name.toLowerCase() === (columns[0] ?? '').toLowerCase())
  return folder(c?.type.collationId ?? 255)
}
