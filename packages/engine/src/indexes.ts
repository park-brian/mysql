// M4.11 — clustered and secondary indexes (doc 20, doc 23, D-42).
//
// The one module in this package that knows what a key means. Below it, the
// tree is an ordered map of `memcmp`-ordered bytes; here, `encodeKey` from
// `@myjs/types` turns a row's field bytes into those keys.
//
//   - The **clustered index** maps the primary key's sort key to the whole
//     record. Both are stored, because a sort key cannot be turned back into a
//     value: under a PAD SPACE collation `'a'` and `'a '` have one key.
//   - A **secondary index** maps *secondary key ++ primary key* to a version
//     header: a delete-mark and the trx id that last changed the entry (M4.21).
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
//
// Every change is a transaction's (M4.20): a clustered value carries doc 25's
// hidden `DB_TRX_ID` and `DB_ROLL_PTR` ahead of its record, a delete marks
// rather than removes, and every change leaves an undo record — kept per index
// entry, so rollback and purge need no schema. What does need the schema, the
// overflow chains a version owns, is worked out here and carried in the undo
// record. An update writes every off-page field afresh, so a chain belongs to
// exactly one version and is freed exactly once. A change with no transaction
// is one of its own: autocommit.
import { encodeKey, keyPartLength, type KeyPart } from '@myjs/types'
import { BTree, type Range, type TreeOptions } from './btree.ts'
import { corrupt, duplicateKey, misuse, snapshotTooOld } from './errors.ts'
import { maxCellSize } from './index-page.ts'
import { readChain, writeChain } from './overflow.ts'
import { decodeRecord, encodeRecord, externalRefs, type FieldBytes, type RecordLayout } from './record.ts'
import type { Store } from './store.ts'
import { CLUSTERED_HEADER, SECONDARY_HEADER, clusteredValue, rollPtrOf, secondaryValue, versionOf, type ReadView, type Trx, type TrxSys } from './trx.ts'
import { readEntryUndo } from './undo.ts'

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
    if (part.kind === 'text' && part.width === undefined) throw misuse(`text key column ${field} needs a declared width, or a budget (D-35, D-55)`)
    let width: number
    // A NO PAD text key is variable-length, ended by two bytes (D-55); its
    // width is the budget it is sized by. A PAD SPACE one is exactly its width,
    // and the two bytes of slack cost it nothing that matters.
    if (part.kind === 'text') width = (part.width as number) + 2
    else if (part.kind === 'float') width = 8
    else if (part.width !== undefined) width = part.width + 2
    else if (f.fixed !== undefined) width = Math.min(f.fixed, part.prefix ?? f.fixed)
    else throw misuse(`key column ${field} is variable-length and needs a declared width (D-35, D-42)`)
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
  // `maxKey` allows a 4-byte child pointer beside the key; a secondary leaf
  // cell carries the version header beside it instead.
  BTree.checkKeyLength(maxKeyLength(clustered.layout, columns) + clustered.maxKey + SECONDARY_HEADER - 4, pageSize)
}

const keyOf = (row: Row, columns: readonly KeyColumn[]): Uint8Array =>
  encodeKey(
    columns.map((c) => row[c.field] ?? null),
    columns.map((c) => c.part),
  )

/** The first byte string after every string that starts with `prefix`, or `undefined` if there is none. */
export function prefixEnd(prefix: Uint8Array): Uint8Array | undefined {
  const out = prefix.slice()
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== 0xff) {
      out[i] = (out[i] as number) + 1
      return out.subarray(0, i + 1)
    }
  }
  return undefined
}

/**
 * How a read sees an index. `'consistent'` reads the snapshot: the
 * transaction's read view, or — with no transaction — a view of its own, as
 * an autocommit read takes. `'current'` reads the latest version, as
 * `SELECT … FOR UPDATE` and the reads inside `UPDATE` and `DELETE` do; it
 * needs a transaction, and takes the writer slot for it (doc 25).
 */
export type ReadMode = 'consistent' | 'current'

export class ClusteredIndex {
  readonly tree: BTree
  readonly layout: RecordLayout
  readonly primary: readonly KeyColumn[]
  /**
   * The longest key this index is sized for — what a secondary index budgets
   * for the primary key it appends. A NO PAD text key can exceed it (D-55); the
   * tree refuses a key too long for the page, and the record's budget is what
   * the cell has left beside the key it actually has.
   */
  readonly maxKey: number
  /** What ER_DUP_ENTRY names: `PRIMARY`, or the UNIQUE index InnoDB clusters by in its place. */
  readonly name: string

  constructor(tree: BTree, layout: RecordLayout, primary: readonly KeyColumn[], name = 'PRIMARY') {
    const pageSize = tree.space.pool.pageSize
    this.tree = tree
    this.layout = layout
    this.primary = primary
    this.name = name
    this.maxKey = primaryBound(layout, primary, pageSize)
  }

  static create(store: Store, layout: RecordLayout, primary: readonly KeyColumn[], options: TreeOptions & { readonly name?: string } = {}): ClusteredIndex {
    // Validated before a tree is created, so a refusal leaves nothing behind.
    primaryBound(layout, primary, store.pool.pageSize)
    return new ClusteredIndex(store.createTree(options), layout, primary, options.name)
  }

  /** Refuse, as ER_TOO_LONG_KEY, a primary key and secondary keys the page cannot hold — before any tree is made. */
  static check(pageSize: number, layout: RecordLayout, primary: readonly KeyColumn[], secondaries: readonly (readonly KeyColumn[])[]): void {
    const maxKey = primaryBound(layout, primary, pageSize)
    for (const columns of secondaries) BTree.checkKeyLength(maxKeyLength(layout, columns) + maxKey + SECONDARY_HEADER - 4, pageSize)
  }

  get #sys(): TrxSys {
    return this.tree.space.transactions
  }

  keyOf(row: Row): Uint8Array {
    return keyOf(row, this.primary)
  }

  /**
   * The overflow references a stored value owns — what `verifyStore` follows.
   * A delete-marked value owns none: its chains belong to the delete's undo
   * record, which frees them at purge, so each chain has one owner.
   */
  refsOf(value: Uint8Array): Uint8Array[] {
    if (versionOf(value).marked) return []
    return externalRefs(this.layout, value.subarray(CLUSTERED_HEADER))
  }

  /**
   * Insert a row; ER_DUP_ENTRY if its primary key is taken. Returns the key.
   * Re-inserting a key whose row is delete-marked is an update of the marked
   * version, not an insert (InnoDB's `TRX_UNDO_UPD_DEL_REC`): a view that
   * cannot see the delete must still find the row it deleted.
   */
  insert(row: Row, trx?: Trx): Uint8Array {
    const key = this.keyOf(row)
    return this.#change(trx, (t) => {
      const current = this.tree.get(key)
      if (current !== undefined && !versionOf(current).marked) throw duplicateKey(this.name)
      const record = this.#encode(key, row)
      const ptr = t.undo({ isInsert: current === undefined, purgeRemoves: false, indexId: this.tree.indexId, key, old: current ?? null, freeOnPurge: [], freeOnRollback: externalRefs(this.layout, record) })
      this.tree.put(key, clusteredValue(false, t.id, ptr, record))
      this.tree.space.journal.row(this.tree.indexId, t.id, null, row)
      return key
    })
  }

  /** Replace the row with `row`'s primary key. `false` if there is none. */
  update(row: Row, trx?: Trx): boolean {
    const key = this.keyOf(row)
    return this.#change(trx, (t) => {
      const current = this.tree.get(key)
      if (current === undefined || versionOf(current).marked) return false
      const before = this.#row(current.subarray(CLUSTERED_HEADER))
      const record = this.#encode(key, row)
      const ptr = t.undo({
        isInsert: false,
        purgeRemoves: false,
        indexId: this.tree.indexId,
        key,
        old: current,
        // The old version's chains are its own: freed when no view needs it.
        freeOnPurge: this.refsOf(current),
        freeOnRollback: externalRefs(this.layout, record),
      })
      this.tree.put(key, clusteredValue(false, t.id, ptr, record))
      this.tree.space.journal.row(this.tree.indexId, t.id, before, row)
      return true
    })
  }

  /** Delete-mark a row; purge removes it once no view can see it. `false` if there is none. */
  delete(key: Uint8Array, trx?: Trx): boolean {
    return this.#change(trx, (t) => {
      const current = this.tree.get(key)
      if (current === undefined || versionOf(current).marked) return false
      const record = current.subarray(CLUSTERED_HEADER)
      const before = this.#row(record)
      const ptr = t.undo({ isInsert: false, purgeRemoves: true, indexId: this.tree.indexId, key, old: current, freeOnPurge: this.refsOf(current), freeOnRollback: [] })
      this.tree.put(key, clusteredValue(true, t.id, ptr, record.slice()))
      this.tree.space.journal.row(this.tree.indexId, t.id, before, null)
      return true
    })
  }

  /** The row under a primary key as `trx` sees it, off-page fields read back in. */
  get(key: Uint8Array, trx?: Trx, mode: ReadMode = 'consistent'): FieldBytes[] | undefined {
    return this.read(trx, mode, (view) => {
      const record = this.recordAt(key, view)
      return record === undefined ? undefined : this.#row(record)
    })
  }

  /** Rows in key order within a range, as `trx` sees them. Do not change the index while iterating. */
  *scan(range: Range = {}, trx?: Trx, mode: ReadMode = 'consistent'): Generator<[Uint8Array, FieldBytes[]]> {
    const view = this.#open(trx, mode)
    try {
      for (const [key, value] of this.tree.entries(range)) {
        const record = this.#visible(value, view.view)
        if (record !== undefined) yield [key, this.#row(record)]
      }
    } catch (e) {
      // A view that expired mid-scan may have had its pages purged from under
      // it — even a dropped tree's. Whatever reading them did, the answer is
      // the one an expired view gets.
      if (view.view?.expired === true) throw snapshotTooOld()
      throw e
    } finally {
      view.close()
    }
  }

  /** Run `use` with the view a read in `mode` by `trx` takes; `null` is the latest version. */
  read<T>(trx: Trx | undefined, mode: ReadMode, use: (view: ReadView | null) => T): T {
    const v = this.#open(trx, mode)
    try {
      return use(v.view)
    } finally {
      v.close()
    }
  }

  /** The record of the version of `key` that `view` sees, or `undefined`. */
  recordAt(key: Uint8Array, view: ReadView | null): Uint8Array | undefined {
    const value = this.tree.get(key)
    return value === undefined ? undefined : this.#visible(value, view)
  }

  /** The row a stored record decodes to, its off-page fields read in. */
  rowOf(record: Uint8Array): FieldBytes[] {
    return this.#row(record)
  }

  /** The view a read in `mode` by `trx` takes, and how to let it go: for a reader that cannot use `read`'s callback, such as a generator. */
  openView(trx: Trx | undefined, mode: ReadMode): { view: ReadView | null; close: () => void } {
    return this.#open(trx, mode)
  }

  #open(trx: Trx | undefined, mode: ReadMode): { view: ReadView | null; close: () => void } {
    if (mode === 'current') {
      if (trx === undefined) throw misuse('a current read needs a transaction')
      trx.lock()
      return { view: null, close: () => {} }
    }
    if (trx !== undefined) return { view: trx.view, close: () => {} }
    const sys = this.#sys
    const view = sys.openView(undefined)
    return { view, close: () => sys.closeView(view) }
  }

  /**
   * Walk a version chain to the version `view` can see (doc 25): the stored
   * one if its trx is visible, else the old value its roll pointer names,
   * and so on. An insert's undo has nothing older; a delete-mark is absence.
   */
  #visible(value: Uint8Array, view: ReadView | null): Uint8Array | undefined {
    if (view?.expired === true) throw snapshotTooOld()
    let v = value
    for (let hops = 0; ; hops++) {
      const version = versionOf(v)
      if (view === null || view.isVisible(version.trxId)) return version.marked ? undefined : v.subarray(CLUSTERED_HEADER)
      const ptr = rollPtrOf(v)
      if (ptr === null || ptr.isInsert) return undefined
      if (hops > this.#sys.nextTrxId) throw corrupt(ptr.page, 'a version chain that does not end')
      const old = readEntryUndo(this.tree.space.pool, ptr).old
      if (old === null) return undefined
      v = old
    }
  }

  #change<T>(trx: Trx | undefined, change: (t: Trx) => T): T {
    if (trx !== undefined) return trx.write(() => change(trx))
    return this.#sys.autocommit((t) => t.write(() => change(t)))
  }

  #encode(key: Uint8Array, row: Row): Uint8Array {
    const pageSize = this.tree.space.pool.pageSize
    BTree.checkKeyLength(key.length, pageSize)
    const pages = this.tree.overflowPages()
    // A leaf cell is the key, the value and two length varints of up to three
    // bytes; the value is the version header, then the record.
    const maxSize = maxCellSize(pageSize) - Math.max(key.length, this.maxKey) - 6 - CLUSTERED_HEADER
    return encodeRecord(this.layout, row, { maxSize, storeExternal: (b) => writeChain(pages, b) })
  }

  #row(record: Uint8Array): FieldBytes[] {
    return decodeRecord(this.layout, record).map((v) => (v === null || v instanceof Uint8Array ? v : readChain(this.tree.space.pool, v.ref)))
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
   * refused if a live entry shares its secondary key; NULLs never collide,
   * and a delete-marked entry is a row already gone. An entry this row left
   * marked is taken back rather than added again, as the clustered insert does.
   */
  insert(row: Row, primaryKey: Uint8Array, trx?: Trx): void {
    const secondary = keyOf(row, this.columns)
    const key = concat(secondary, primaryKey)
    this.#change(trx, (t) => {
      if (this.unique && this.columns.every((c) => row[c.field] !== null)) {
        for (const [, value] of this.#entries(secondary)) if (!versionOf(value).marked) throw duplicateKey(this.name)
      }
      const current = this.tree.get(key)
      if (current !== undefined && !versionOf(current).marked) throw misuse(`the row is already in ${this.name}`)
      t.undo({ isInsert: current === undefined, purgeRemoves: false, indexId: this.tree.indexId, key, old: current ?? null, freeOnPurge: [], freeOnRollback: [] })
      this.tree.put(key, secondaryValue(false, t.id))
    })
  }

  /** Delete-mark a row's entry. `false` if it has none. */
  delete(row: Row, primaryKey: Uint8Array, trx?: Trx): boolean {
    const key = concat(keyOf(row, this.columns), primaryKey)
    return this.#change(trx, (t) => {
      const current = this.tree.get(key)
      if (current === undefined || versionOf(current).marked) return false
      t.undo({ isInsert: false, purgeRemoves: true, indexId: this.tree.indexId, key, old: current, freeOnPurge: [], freeOnRollback: [] })
      this.tree.put(key, secondaryValue(true, t.id))
      return true
    })
  }

  /**
   * The primary keys of the rows whose secondary key is `values`, as `trx`
   * sees them. An entry whose last change the view can see is accurate as it
   * stands — a covering read. One it cannot see may be marked for a row the
   * view still has, or live for a row the view does not: the clustered version
   * the view sees decides, by whether its key is this one.
   */
  primaryKeys(values: KeyValues, trx?: Trx, mode: ReadMode = 'consistent'): Uint8Array[] {
    const secondary = encodeKey(values, this.columns.map((c) => c.part))
    return this.clustered.read(trx, mode, (view) => this.#keys(secondary, view))
  }

  /** The rows whose secondary key is `values`: each one descent of the clustered index. */
  find(values: KeyValues, trx?: Trx, mode: ReadMode = 'consistent'): FieldBytes[][] {
    const secondary = encodeKey(values, this.columns.map((c) => c.part))
    return this.clustered.read(trx, mode, (view) => this.#keys(secondary, view).map((pk) => this.clustered.rowOf(this.clustered.recordAt(pk, view) as Uint8Array)))
  }

  /**
   * Rows in this index's order within a range of encoded keys, as `trx` sees
   * them, each with its primary key. An entry is split into its own key and
   * the primary key after it by the parts' encodings (`keyPartLength`); which
   * entries a view sees is decided as `primaryKeys` decides it. Do not change
   * the index while iterating.
   */
  *scan(range: Range = {}, trx?: Trx, mode: ReadMode = 'consistent'): Generator<[Uint8Array, FieldBytes[]]> {
    const v = this.clustered.openView(trx, mode)
    try {
      for (const [key, value] of this.tree.entries(range)) {
        const at = this.#ownLength(key)
        const secondary = key.subarray(0, at)
        const pk = key.subarray(at)
        const version = versionOf(value)
        let record: Uint8Array | undefined
        if (v.view === null || v.view.isVisible(version.trxId)) {
          if (version.marked) continue
          record = this.clustered.recordAt(pk, v.view)
        } else {
          record = this.clustered.recordAt(pk, v.view)
          if (record !== undefined && !equal(keyOf(this.clustered.rowOf(record), this.columns), secondary)) continue
        }
        if (record !== undefined) yield [pk.slice(), this.clustered.rowOf(record)]
      }
    } catch (e) {
      if (v.view?.expired === true) throw snapshotTooOld()
      throw e
    } finally {
      v.close()
    }
  }

  /** The length of an entry's own key, before the primary key. */
  #ownLength(key: Uint8Array): number {
    let at = 0
    try {
      for (const c of this.columns) at += keyPartLength(key, at, c.part, this.clustered.layout[c.field]?.fixed)
    } catch (e) {
      throw corrupt(this.tree.root, `an entry of ${this.name} does not split: ${e instanceof Error ? e.message : String(e)}`)
    }
    return at
  }

  #keys(secondary: Uint8Array, view: ReadView | null): Uint8Array[] {
    const out: Uint8Array[] = []
    for (const [key, value] of this.#entries(secondary)) {
      const pk = key.subarray(secondary.length)
      const v = versionOf(value)
      if (view === null || view.isVisible(v.trxId)) {
        if (!v.marked) out.push(pk)
        continue
      }
      const record = this.clustered.recordAt(pk, view)
      if (record !== undefined && equal(keyOf(this.clustered.rowOf(record), this.columns), secondary)) out.push(pk)
    }
    return out
  }

  *#entries(secondary: Uint8Array): Generator<[Uint8Array, Uint8Array]> {
    const end = prefixEnd(secondary)
    yield* this.tree.entries({ from: secondary, ...(end === undefined ? {} : { to: end }) })
  }

  #change<T>(trx: Trx | undefined, change: (t: Trx) => T): T {
    if (trx !== undefined) return trx.write(() => change(trx))
    return this.tree.space.transactions.autocommit((t) => t.write(() => change(t)))
  }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
