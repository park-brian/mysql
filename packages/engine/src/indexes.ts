// M4.11 — clustered and secondary indexes (doc 20, doc 23, D-42).
//
// The one module in this package that knows what a key means. Below it, the
// tree is an ordered map of `memcmp`-ordered bytes; here, `encodeKey` from
// `@myjs/types` turns a row's field bytes into those keys.
//
//   - The **clustered index** maps the primary key's sort key to the whole
//     record. Both are stored, because a sort key cannot be turned back into a
//     value: under a PAD SPACE collation `'a'` and `'a '` have one key.
//   - A **secondary index** maps *secondary key ++ primary key* to nothing.
//     Every key is unique, so a nullable `UNIQUE` index can hold many NULLs as
//     MySQL's does, and uniqueness is a prefix scan made before the insert. A
//     lookup reads the primary key off the entry's tail and makes exactly one
//     descent of the clustered index for the row — the test counts the pages.
//
// Concatenated keys are only unambiguous if every part but the last has a fixed
// length (D-35), and a secondary key's parts are never last once the primary
// key follows them. So every variable-length part must declare its width, and
// the longest key an index can make is checked against the page when the index
// is defined, as `ER_TOO_LONG_KEY` — never at insert.
import { encodeKey, type KeyPart } from '@myjs/types'
import { BTree, type TreeOptions } from './btree.ts'
import { duplicateKey, misuse } from './errors.ts'
import { maxCellSize } from './index-page.ts'
import { freeChain, readChain, writeChain } from './overflow.ts'
import { decodeRecord, encodeRecord, externalRefs, type FieldBytes, type RecordLayout } from './record.ts'
import type { Store } from './store.ts'

/** One key column: which field of the row, and how it is encoded. */
export interface KeyColumn {
  readonly field: number
  readonly part: KeyPart
}

/** A row's field bytes, by field number. */
export type Row = readonly FieldBytes[]

/** A key's values, one per key column, in column order. */
export type KeyValues = readonly FieldBytes[]

/** The longest key `columns` can produce, refusing a variable-length part with no declared width. */
function maxKeyLength(layout: RecordLayout, columns: readonly KeyColumn[]): number {
  let total = 0
  for (const { field, part } of columns) {
    const f = layout[field]
    if (f === undefined) throw misuse(`key column ${field} is not a field`)
    if (part.nullable !== f.nullable) throw misuse(`key column ${field}'s nullability differs from its field's`)
    let width: number
    if (part.kind === 'text') width = part.width as number
    else if (part.width !== undefined) width = part.width + 2
    else if (f.fixed !== undefined) width = Math.min(f.fixed, part.prefix ?? f.fixed)
    else throw misuse(`key column ${field} is variable-length and needs a declared width (D-35, D-42)`)
    if (part.kind === 'text' && part.width === undefined) throw misuse(`text key column ${field} needs a declared width (D-35)`)
    total += width + (part.nullable ? 1 : 0)
  }
  return total
}

/** A primary key's longest encoding, refused if the page cannot hold it. */
function primaryBound(layout: RecordLayout, primary: readonly KeyColumn[], pageSize: number): number {
  if (primary.length === 0) throw misuse('a clustered index needs a primary key')
  if (primary.some((c) => c.part.nullable)) throw misuse('a primary key part cannot be nullable')
  const max = maxKeyLength(layout, primary)
  BTree.checkKeyLength(max, pageSize)
  return max
}

/** A secondary entry's longest encoding — its own key and the primary key after it. */
function secondaryBound(clustered: ClusteredIndex, columns: readonly KeyColumn[], pageSize: number): void {
  BTree.checkKeyLength(maxKeyLength(clustered.layout, columns) + clustered.maxKey, pageSize)
}

const keyOf = (row: Row, columns: readonly KeyColumn[]): Uint8Array =>
  encodeKey(
    columns.map((c) => row[c.field] ?? null),
    columns.map((c) => c.part),
  )

/** The first byte string after every string that starts with `prefix`, or `undefined` if there is none. */
function prefixEnd(prefix: Uint8Array): Uint8Array | undefined {
  const out = prefix.slice()
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== 0xff) {
      out[i] = (out[i] as number) + 1
      return out.subarray(0, i + 1)
    }
  }
  return undefined
}

export class ClusteredIndex {
  readonly tree: BTree
  readonly layout: RecordLayout
  readonly primary: readonly KeyColumn[]
  /** The longest key this index can hold — what a secondary index appends. */
  readonly maxKey: number
  readonly #maxRecord: number

  constructor(tree: BTree, layout: RecordLayout, primary: readonly KeyColumn[]) {
    const pageSize = tree.space.pool.pageSize
    this.tree = tree
    this.layout = layout
    this.primary = primary
    this.maxKey = primaryBound(layout, primary, pageSize)
    // A leaf cell is the key, the record and two length varints of up to three bytes.
    this.#maxRecord = maxCellSize(pageSize) - this.maxKey - 6
  }

  static create(store: Store, layout: RecordLayout, primary: readonly KeyColumn[], options: TreeOptions = {}): ClusteredIndex {
    // Validated before a tree is created, so a refusal leaves nothing behind.
    primaryBound(layout, primary, store.pool.pageSize)
    return new ClusteredIndex(store.createTree(options), layout, primary)
  }

  keyOf(row: Row): Uint8Array {
    return keyOf(row, this.primary)
  }

  /**
   * Insert a row; ER_DUP_ENTRY if its primary key is taken. Returns the key.
   * One mini-transaction, or part of the caller's, logging the row's image
   * (D-25) — so a value too big for any page leaves no overflow page behind.
   */
  insert(row: Row): Uint8Array {
    const key = this.keyOf(row)
    const journal = this.tree.space.journal
    return journal.atomically(() => {
      if (this.tree.get(key) !== undefined) throw duplicateKey('PRIMARY')
      const pages = this.tree.overflowPages()
      this.tree.put(key, encodeRecord(this.layout, row, { maxSize: this.#maxRecord, storeExternal: (b) => writeChain(pages, b) }))
      journal.row(this.tree.indexId, null, row)
      return key
    })
  }

  /** The row under a primary key, off-page fields read back in. One descent. */
  get(key: Uint8Array): FieldBytes[] | undefined {
    const record = this.tree.get(key)
    if (record === undefined) return undefined
    return decodeRecord(this.layout, record).map((v) => (v === null || v instanceof Uint8Array ? v : readChain(this.tree.space.pool, v.ref)))
  }

  /** Remove a row, and free its off-page fields. Logs the row as it was. */
  delete(key: Uint8Array): boolean {
    const journal = this.tree.space.journal
    return journal.atomically(() => {
      const record = this.tree.get(key)
      if (record === undefined) return false
      journal.row(this.tree.indexId, this.get(key) as FieldBytes[], null)
      const pages = this.tree.overflowPages()
      for (const ref of externalRefs(this.layout, record)) freeChain(pages, ref)
      return this.tree.delete(key)
    })
  }
}

export class SecondaryIndex {
  readonly tree: BTree
  readonly clustered: ClusteredIndex
  readonly columns: readonly KeyColumn[]
  readonly unique: boolean
  readonly name: string

  constructor(tree: BTree, clustered: ClusteredIndex, columns: readonly KeyColumn[], options: { unique?: boolean; name?: string } = {}) {
    secondaryBound(clustered, columns, tree.space.pool.pageSize)
    this.tree = tree
    this.clustered = clustered
    this.columns = columns
    this.unique = options.unique === true
    this.name = options.name ?? `index ${tree.indexId}`
  }

  static create(store: Store, clustered: ClusteredIndex, columns: readonly KeyColumn[], options: { unique?: boolean; name?: string } = {}): SecondaryIndex {
    secondaryBound(clustered, columns, store.pool.pageSize)
    return new SecondaryIndex(store.createTree(), clustered, columns, options)
  }

  /**
   * Add a row's entry. In a unique index a row with no NULL in the key is
   * refused if any entry shares its secondary key; NULLs never collide.
   */
  insert(row: Row, primaryKey: Uint8Array): void {
    const secondary = keyOf(row, this.columns)
    if (this.unique && this.columns.every((c) => row[c.field] !== null) && this.#keys(secondary).next().done !== true) {
      throw duplicateKey(this.name)
    }
    this.tree.put(concat(secondary, primaryKey), new Uint8Array(0))
  }

  delete(row: Row, primaryKey: Uint8Array): boolean {
    return this.tree.delete(concat(keyOf(row, this.columns), primaryKey))
  }

  /** The primary keys of the rows whose secondary key is `values` — a covering read, the clustered index untouched. */
  primaryKeys(values: KeyValues): Uint8Array[] {
    return [...this.#keys(encodeKey(values, this.columns.map((c) => c.part)))]
  }

  /** The rows whose secondary key is `values`: each one descent of the clustered index. */
  find(values: KeyValues): FieldBytes[][] {
    return this.primaryKeys(values).map((pk) => this.clustered.get(pk) as FieldBytes[])
  }

  *#keys(secondary: Uint8Array): Generator<Uint8Array> {
    const end = prefixEnd(secondary)
    for (const [key] of this.tree.entries({ from: secondary, ...(end === undefined ? {} : { to: end }) })) yield key.subarray(secondary.length)
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
