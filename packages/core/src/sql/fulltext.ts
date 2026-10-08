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
import { requireCollationInfo } from '@myjs/charsets'
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
export function checkFulltext(engine: string, columns: readonly ColumnDef[], names: readonly string[]): void {
  if (engine === 'memory') throw sqlError('ER_TABLE_CANT_HANDLE_FT', "The used table type doesn't support FULLTEXT indexes")
  for (const name of names) {
    const c = columns.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (c === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${name}' doesn't exist in table`)
    if (!TEXT_TYPES.has(c.type.type) || c.type.collationId === undefined || c.type.collationId === CHARSET_BINARY) {
      throw sqlError('ER_BAD_FT_COLUMN', `Column '${c.name}' cannot be part of FULLTEXT index`)
    }
  }
}

// --- words ------------------------------------------------------------------------

const WORD = /[\p{L}\p{N}_]+/gu

/** A word as the index compares it: folded as the collation folds case, and accents where it ignores them. */
function folder(collationId: number): (w: string) => string {
  const name = requireCollationInfo(collationId).name
  const ci = name.endsWith('_ci')
  // A pre-0900 `_ci` collation is accent-insensitive too; a 0900 one says so.
  const ai = name.includes('_ai_') || (ci && !name.includes('_as_') && !name.includes('0900'))
  return (w) => {
    const bare = ai ? w.normalize('NFD').replace(/\p{M}/gu, '') : w
    return ci ? bare.toLowerCase() : bare
  }
}

/** Whether a word is one the index keeps. */
function indexed(word: string): boolean {
  const length = [...word].length
  return length >= FT_MIN_TOKEN && length <= FT_MAX_TOKEN && !FT_STOPWORDS.has(word.toLowerCase())
}

/** A document's words, in order, folded; the ones the index leaves out are gone. */
export function wordsOf(text: string, fold: (w: string) => string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(WORD)) if (indexed(m[0])) out.push(fold(m[0]))
  return out
}

// --- the boolean grammar ----------------------------------------------------------

type Op = '+' | '-' | '~' | '<' | '>' | ''

export type Term =
  | { readonly kind: 'word'; readonly op: Op; readonly word: string; readonly prefix: boolean }
  | { readonly kind: 'phrase'; readonly op: Op; readonly words: readonly string[] }
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
  const describe = (c: string | undefined) => (c === undefined ? '$end' : `'${c}'`)
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
        return terms
      }
      if (c === ')') {
        if (depth === 0) throw syntax("unexpected ')', expecting $end")
        i++
        return terms
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
        const close = query.indexOf('"', i + 1)
        const body = close < 0 ? query.slice(i + 1) : query.slice(i + 1, close)
        i = close < 0 ? n : close + 1
        // An unclosed phrase is a phrase that matches nothing.
        terms.push({ kind: 'phrase', op, words: close < 0 ? ['\u0000'] : [...body.matchAll(WORD)].map((m) => (indexed(m[0]) ? fold(m[0]) : '\u0000')) })
        space()
        if (query[i] === '@') {
          i++
          space()
          if (!/\d/.test(query[i] ?? '')) throw syntax(`unexpected ${describe(query[i])}`)
          while (/\d/.test(query[i] ?? '')) i++
        }
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
        terms.push({ kind: 'word', op, word: prefix || indexed(word) ? fold(word) : '\u0000', prefix })
        if (query[i] === '@') throw syntax("unexpected '@', expecting $end")
      }
    }
  }
  return list(0)
}

// --- ranking ----------------------------------------------------------------------

/** The rows' words, and how many rows hold each: what a query is ranked against. */
export class Corpus {
  readonly rows: number
  readonly #docs = new Map<string, number>()
  readonly #words: string[][]

  constructor(documents: readonly (readonly string[])[]) {
    this.rows = documents.length
    this.#words = documents.map((d) => [...d])
    for (const d of documents) for (const w of new Set(d)) this.#docs.set(w, (this.#docs.get(w) ?? 0) + 1)
  }

  /** How many rows hold a word, or any word with a prefix. */
  holding(word: string, prefix: boolean): number {
    if (!prefix) return this.#docs.get(word) ?? 0
    let total = 0
    for (const [w, count] of this.#docs) if (w.startsWith(word)) total += count
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
function frequency(words: readonly string[], word: string, prefix: boolean): number {
  if (!prefix) return words.reduce((n, w) => (w === word ? n + 1 : n), 0)
  const counts = new Map<string, number>()
  for (const w of words) if (w.startsWith(word)) counts.set(w, (counts.get(w) ?? 0) + 1)
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

/** Whether `words` holds `phrase`'s words side by side. */
function holdsPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0) return false
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
      const tf = frequency(words, t.word, t.prefix)
      return tf === 0 ? undefined : f32(tf * corpus.weight(corpus.holding(t.word, t.prefix)))
    }
    case 'phrase': {
      if (!holdsPhrase(words, t.words)) return undefined
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
