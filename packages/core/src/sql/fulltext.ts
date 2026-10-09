// M5.26 — FULLTEXT indexes and MATCH … AGAINST, as InnoDB answers them.
//
// A FULLTEXT index is kept in its table's definition (`options.fulltext`),
// its name and columns, and is not built: MATCH reads the table and ranks
// each row as InnoDB's index would. What 8.4.11 answered:
//
//   - A FULLTEXT key names CHAR, VARCHAR or TEXT columns (1283 for anything
//     else), shares its name space with the table's other keys, and is
//     refused by an engine without full-text support (1214). MATCH must name
//     the columns of one such index, in any order (1191), by name alone
//     (1064 otherwise), all of them text (1267), and AGAINST a constant, a
//     variable or a subquery, never a row's column (1210).
//   - A word is a run of letters, digits and `_`; an apostrophe ends one.
//     Words shorter than 3 or longer than 84 characters, and InnoDB's
//     stopwords, are not indexed (`fulltext-params.ts`, captured).
//   - A row's rank is the sum, over the query's words, of `tf × idf²`, where
//     tf counts the word in the row and idf is `log10(N / n)` for N rows and
//     n rows holding the word, or `log10(1.0001)` when every row holds it;
//     a word repeated in a query counts its rows again, and so does a prefix
//     with the word it spells, so n can pass N and the logarithm go below
//     zero. The arithmetic is InnoDB's float: each term rounded, and the sum.
//   - A prefix counts, in a row, the occurrences of the first of its words
//     that the row holds, in the order InnoDB scans them: its red-black tree
//     of cached words, from where the search lands, back and then forward.
//   - BOOLEAN MODE: `+` a word a row must hold, `-` one it must not, `>` and
//     `<` one that adds or takes away 1 from the rank, `~` one that takes 1
//     from a row the earlier terms matched, `word*` a prefix, `"…"` a phrase
//     whose words stand together, and parentheses a group. A row matches when
//     it holds every `+` term, no `-` term and, with no `+` term, any other.
//     The grammar's errors are 1064 with Bison's words, as the server's are.
//
// More than 32 levels of parentheses is 209, as InnoDB's parser has it,
// once the query has parsed; Bison's stack runs out first, at 10,000
// entries, with 1064. A constant query is parsed before any row is read.
//
// Named divergences: WITH QUERY EXPANSION is refused; InnoDB applies a
// transaction's changes to the index at its commit, and counts the rows of
// an UPDATE's old version in a prefix's or a boolean query's statistics
// until OPTIMIZE TABLE, where this reads the rows as they are; its cache
// takes rows in the order they were inserted, where this takes them in
// the table's; after a sync to disk a prefix scans its words in order; and
// MATCH over a derived table, which the server merges, is 1191 here.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { collation, encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, TableDef } from '@myjs/engine'
import { SqlError, messages, sqlError } from '@myjs/protocol'
import { toText, type Value } from '@myjs/types'
import { FT_MAX_TOKEN, FT_MIN_TOKEN, FT_STOPWORDS } from './fulltext-params.ts'

export interface FulltextDef {
  readonly name: string
  readonly columns: readonly string[]
  readonly comment?: string
  readonly invisible?: true
}

export function fulltextOf(def: { readonly options?: Readonly<Record<string, unknown>> }): FulltextDef[] {
  const stored = def.options?.['fulltext']
  return Array.isArray(stored) ? (stored as FulltextDef[]) : []
}

const TEXT_TYPES: ReadonlySet<number> = new Set([FIELD_TYPE.STRING, FIELD_TYPE.VAR_STRING, FIELD_TYPE.VARCHAR, FIELD_TYPE.TINY_BLOB, FIELD_TYPE.BLOB, FIELD_TYPE.MEDIUM_BLOB, FIELD_TYPE.LONG_BLOB])

/** A FULLTEXT key's columns, checked: text columns of an engine that has full-text search. */
export function checkFulltext(engine: string, columns: readonly ColumnDef[], names: readonly string[], ordered = false): void {
  if (ordered) throw sqlError('ER_WRONG_USAGE', 'Incorrect usage of spatial/fulltext/hash index and explicit index order')
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
  | {
      readonly kind: 'word'
      readonly op: Op
      readonly word: string
      readonly prefix: boolean
      /**
       * Every scan of the word's one entry in InnoDB's `word_freqs`, in the
       * query's order, each with its word as the term holds it: `'data data'`
       * scans it twice and `'data* data'` once each way. Its rows are counted
       * once a scan.
       */
      readonly scans?: readonly { readonly word: string; readonly prefix: boolean }[]
    }
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
  // Bison's stack: 10,000 entries, two for the start and the innermost
  // token, two for each open group and one more for an operator before it.
  // Past that is 1064 as the parse reads (8.4.11: 4,999 nested `(` or 3,333
  // `+(`), where too deep a query that parses is 209 after it.
  // The open groups, innermost last: a loop, not recursion, so 4,999 levels
  // reach the 209 the server gives rather than the engine's stack.
  let deepest = 0
  let stack = 2
  const frames: { terms: Term[]; readonly op: Op; readonly cost: number }[] = [{ terms: [], op: '', cost: 0 }]
  for (;;) {
    const depth = frames.length - 1
    const terms = (frames[depth] as { terms: Term[] }).terms
    space()
    const c = query[i]
    if (c === undefined) {
      if (depth > 0) throw stack + 1 > 10000 ? sqlError('ER_PARSE_ERROR', 'memory exhausted') : syntax('unexpected $end')
      break
    }
    if (c === ')') {
      if (depth === 0) throw syntax("unexpected ')', expecting $end")
      // Reading the `)`, or the end, is one entry more (8.4.11: 4,999 groups exhaust it, 4,998 do not).
      if (stack + 1 > 10000) throw sqlError('ER_PARSE_ERROR', 'memory exhausted')
      i++
      const done = frames.pop() as { terms: Term[]; op: Op; cost: number }
      stack -= done.cost
      ;(frames[depth - 1] as { terms: Term[] }).terms.push({ kind: 'group', op: done.op, terms: merged(done.terms, fold) })
      continue
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
      const cost = op === '' ? 2 : 3
      stack += cost
      if (stack > 10000) throw sqlError('ER_PARSE_ERROR', 'memory exhausted')
      frames.push({ terms: [], op, cost })
      deepest = Math.max(deepest, depth + 1)
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
  const terms = merged((frames[0] as { terms: Term[] }).terms, fold)
  // InnoDB's parser stops at 32 levels: a handler error, 209, with no
  // symbol of its own in the server's error table (8.4.11).
  if (deepest > 32) throw new SqlError('HA_ERR_FTS_TOO_MANY_NESTED_EXP', 'Too many nested sub-expressions in a full-text search', { errno: 209, sqlState: 'HY000' })
  return terms
}

/**
 * A word asked twice is one term that counts its rows twice, as a
 * natural-language query's is (8.4.11: `'data data'`); so is a prefix and
 * the word it spells, which InnoDB keys alike (`'data* data'`).
 */
function merged(terms: Term[], fold: (w: string) => string): Term[] {
  const out: Term[] = []
  const key = (t: Term & { kind: 'word' }) => (t.prefix ? fold(t.word) : t.word)
  for (const t of terms) {
    const at = t.kind === 'word' ? out.findIndex((u) => u.kind === 'word' && u.op === t.op && key(u) === key(t)) : -1
    const same = out[at]
    if (same !== undefined && same.kind === 'word' && t.kind === 'word') out[at] = { ...same, scans: [...(same.scans ?? [{ word: same.word, prefix: same.prefix }]), { word: t.word, prefix: t.prefix }] }
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
  /** InnoDB's FTS cache: its words in a red-black tree, as `ut0rbt.cc` builds it. */
  readonly #tree = new WordTree()
  readonly #visits = new Map<string, readonly string[]>()

  /** `documents` are folded words; `raw` a word as written for each, which a prefix is matched against. */
  constructor(documents: readonly (readonly string[])[], raw: ReadonlyMap<string, string>, fold: (w: string) => string) {
    this.rows = documents.length
    this.#raw = raw
    this.#fold = fold
    for (const d of documents) {
      const words = [...new Set(d)]
      for (const w of words) this.#docs.set(w, (this.#docs.get(w) ?? 0) + 1)
      // A document's words reach the cache in their own order, sorted (`fts_cache_add_doc`).
      for (const w of words.sort(order)) this.#tree.insert(w)
    }
  }

  /**
   * The words a prefix scans, in the order it scans them: from the first
   * node on the tree's search path that it begins, back while they begin
   * with it, then forward (`fts_cache_find_wildcard`). A row counts the
   * occurrences of the first of them it holds, so the order is the rank.
   */
  visits(prefix: string): readonly string[] {
    let out = this.#visits.get(prefix)
    if (out === undefined) {
      const p = this.#fold(prefix)
      const cut = (w: string) => [...w].slice(0, [...p].length).join('')
      out = this.#tree.scan((w) => order(p, cut(w)), (w) => this.starts(w, prefix))
      this.#visits.set(prefix, out)
    }
    return out
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

  /**
   * `idf²` for a word held by `count` rows. A word in every row has a small
   * weight rather than none; one counted more often than there are rows —
   * scanned twice, `'data* data'` — has a logarithm below zero, squared
   * (`fts_query_calculate_idf`).
   */
  weight(count: number): number {
    const idf = this.rows === count ? Math.log10(1.0001) : Math.log10(this.rows / count)
    return idf * idf
  }
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

type TreeNode = { readonly key: string; left: TreeNode | null; right: TreeNode | null; parent: TreeNode | null; red: boolean }

/** `ut0rbt.cc`'s red-black tree: a binary search tree balanced as CLRS balances one, with no deletion. */
class WordTree {
  #root: TreeNode | null = null
  readonly #keys = new Set<string>()

  insert(key: string): void {
    if (this.#keys.has(key)) return
    this.#keys.add(key)
    let parent: TreeNode | null = null
    let at = this.#root
    let left = false
    while (at !== null) {
      parent = at
      left = order(key, at.key) < 0
      at = left ? at.left : at.right
    }
    let node: TreeNode = { key, left: null, right: null, parent, red: true }
    if (parent === null) this.#root = node
    else if (left) parent.left = node
    else parent.right = node
    // `rbt_balance_tree`.
    while (node !== this.#root && node.parent?.red === true) {
      const p = node.parent
      const g = p.parent as TreeNode
      if (p === g.left) {
        const uncle = g.right
        if (uncle?.red === true) {
          uncle.red = false
          p.red = false
          g.red = true
          node = g
        } else {
          if (node === p.right) {
            node = p
            this.#rotateLeft(node)
          }
          const q = node.parent as TreeNode
          const gg = q.parent as TreeNode
          q.red = false
          gg.red = true
          this.#rotateRight(gg)
        }
      } else {
        const uncle = g.left
        if (uncle?.red === true) {
          uncle.red = false
          p.red = false
          g.red = true
          node = g
        } else {
          if (node === p.left) {
            node = p
            this.#rotateRight(node)
          }
          const q = node.parent as TreeNode
          const gg = q.parent as TreeNode
          q.red = false
          gg.red = true
          this.#rotateLeft(gg)
        }
      }
    }
    ;(this.#root as TreeNode).red = false
  }

  /** The keys `matches` holds for, from the first `compare` finds on the search path: back from it, then forward. */
  scan(compare: (key: string) => number, matches: (key: string) => boolean): string[] {
    let at = this.#root
    while (at !== null) {
      const c = compare(at.key)
      if (c === 0) break
      at = c > 0 ? at.right : at.left
    }
    if (at === null) return []
    const out: string[] = []
    for (let n: TreeNode | null = at; n !== null && matches(n.key); n = WordTree.#step(n, 'left')) out.push(n.key)
    for (let n = WordTree.#step(at, 'right'); n !== null && matches(n.key); n = WordTree.#step(n, 'right')) out.push(n.key)
    return out
  }

  /** A node's predecessor (`left`) or successor (`right`). */
  static #step(node: TreeNode, side: 'left' | 'right'): TreeNode | null {
    const other = side === 'left' ? 'right' : 'left'
    let n = node[side]
    if (n !== null) {
      while (n[other] !== null) n = n[other] as TreeNode
      return n
    }
    let child = node
    let p = node.parent
    while (p !== null && p[side] === child) {
      child = p
      p = p.parent
    }
    return p
  }

  #rotateLeft(x: TreeNode): void {
    const y = x.right as TreeNode
    x.right = y.left
    if (y.left !== null) y.left.parent = x
    y.parent = x.parent
    if (x.parent === null) this.#root = y
    else if (x === x.parent.left) x.parent.left = y
    else x.parent.right = y
    y.left = x
    x.parent = y
  }

  #rotateRight(x: TreeNode): void {
    const y = x.left as TreeNode
    x.left = y.right
    if (y.right !== null) y.right.parent = x
    y.parent = x.parent
    if (x.parent === null) this.#root = y
    else if (x === x.parent.right) x.parent.right = y
    else x.parent.left = y
    y.right = x
    x.parent = y
  }
}

const f32 = Math.fround

/** The occurrences of a word in a row's words, or a prefix's: those of the first word it scans that the row holds. */
function frequency(words: readonly string[], word: string, prefix: boolean, corpus?: Corpus): number {
  const count = (k: string) => words.reduce((n, w) => (w === k ? n + 1 : n), 0)
  if (!prefix || corpus === undefined) return count(word)
  for (const k of corpus.visits(word)) {
    const n = count(k)
    if (n > 0) return n
  }
  return 0
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
      // One entry, scanned once a time it was asked: the first scan to find the row sets its count.
      const scans = t.scans ?? [{ word: t.word, prefix: t.prefix }]
      let tf = 0
      for (const scan of scans) if ((tf = frequency(words, scan.word, scan.prefix, corpus)) > 0) break
      const holding = scans.reduce((n, scan) => n + corpus.holding(scan.word, scan.prefix), 0)
      return tf === 0 ? undefined : f32(tf * corpus.weight(holding))
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
