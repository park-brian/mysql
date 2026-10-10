// M4.24 — `StorageEngine` and `Table` (doc 30 §Our engines).
//
// The seam M5's executor talks to. A table takes and gives rows as field bytes
// in storage encoding (D-22, ground rule 2) — the executor converts values —
// and names a row by its `RowId`: the clustered key's bytes, the hidden row
// id's for a table with nothing to cluster by, as InnoDB's `position()` does.
// Ranges are given in key *values*, a prefix of an index's leading columns,
// and each engine works out what they mean, so the two have to agree on it.
//
// Two engines answer it:
//
//   - **native** — the B+tree engine: a `ClusteredIndex` and a `SecondaryIndex`
//     per other index, every one maintained inside the caller's transaction,
//     each row operation one write — one mini-transaction, so a duplicate in
//     the third index leaves nothing of the row in the first two.
//   - **memory** — rows in sorted arrays, no pages, no log; non-transactional,
//     as MySQL's MEMORY is, and gone when the process is. It is written to be
//     *independent* of native, not a copy of it: it orders rows by comparing
//     values — a collation's `compare`, a float's number — where native orders
//     encoded keys by `memcmp`. That is what makes the differential test an
//     instrument for the key encoding rather than an echo of it (D-58).
//
// What a caller may count on, and what it may not, is the capability flags:
// `transactional` (a rollback undoes the engine's writes) and
// `consistentReads` (a transaction's reads see its snapshot). Native has both;
// memory has neither. Everything else — results, errors, orders — is the same,
// which `tableConformanceCases` and the differential test hold both to.
import { equalBytes } from '@myjs/bytes'
import { decodeDouble, decodeFloat, decodeInt, compareFloat, encodeKey, type KeyPart } from '@myjs/types'
import { collation, memcmp } from '@myjs/charsets'
import type { Range } from './btree.ts'
import { duplicateKey, misuse, noSuchTable, tableDefChanged } from './errors.ts'
import { ClusteredIndex, SecondaryIndex, prefixEnd, type KeyColumn, type KeyValues, type ReadMode, type Row } from './indexes.ts'
import type { FieldBytes, RecordLayout } from './record.ts'
import { clusteredKeyOf, keyColumnsOf, layoutOf, secondariesOf, ROW_ID_BYTES, type EngineName, type IndexDef, type TableDef } from './schema.ts'
import type { Store } from './store.ts'
import type { Trx } from './trx.ts'

/** A row's name: its clustered key's bytes. */
export type RowId = Uint8Array

/** One end of a range: values for a prefix of the index's columns. */
export interface KeyBound {
  readonly values: KeyValues
  readonly inclusive: boolean
}

/** A range of an index, in index order — a `DESC` part's high values come first. */
export interface KeyRange {
  readonly from?: KeyBound
  readonly to?: KeyBound
  readonly reverse?: boolean
}

/** Planner estimates: never part of what the two engines must agree on. */
export interface TableStats {
  readonly rows: number
  readonly dataLength: number
  readonly indexLength: number
}

export interface Table {
  readonly def: TableDef
  /** Add a row; ER_DUP_ENTRY naming the index it collides in. Returns its id. */
  insert(row: Row, trx?: Trx): RowId
  /** Replace a row. A changed clustered key moves it, and the new id is returned; `undefined` if there is no row `id`. */
  update(id: RowId, row: Row, trx?: Trx): RowId | undefined
  delete(id: RowId, trx?: Trx): boolean
  /**
   * The row `row` would collide with in the UNIQUE (or primary) index `index`,
   * as the uniqueness check sees it: the latest version, which under the one
   * writer (D-53) is committed or the writer's own. `undefined` if none, and
   * always for a key with a NULL in it, since NULLs never collide. An upsert
   * and REPLACE need the row a 1062 means, and the error names only its index
   * (D-71).
   */
  duplicateOf(index: string, row: Row, trx?: Trx): RowId | undefined
  get(id: RowId, trx?: Trx, mode?: ReadMode): FieldBytes[] | undefined
  /** Rows in clustered order. Do not change the table while iterating; an executor that must, materializes first. */
  scan(range?: KeyRange, trx?: Trx, mode?: ReadMode): Generator<[RowId, FieldBytes[]]>
  /** Rows in an index's order. */
  indexScan(index: string, range?: KeyRange, trx?: Trx, mode?: ReadMode): Generator<[RowId, FieldBytes[]]>
  /** The next `count` AUTO_INCREMENT values, as the first of them: handed out for good, committed or not. */
  nextAutoIncrement(count?: number): bigint
  /** The value `nextAutoIncrement` would hand out next, taking nothing. */
  peekAutoIncrement(): bigint
  /** Move the next AUTO_INCREMENT value up to `next`, if it is not there already: a rebuilt table keeps its counter. */
  raiseAutoIncrement(next: bigint): void
  stats(): TableStats
}

/** What a table needs from the catalog that holds its definition. */
export interface TableHooks {
  /** Refuse a write to a table its catalog no longer holds (ER_NO_SUCH_TABLE). */
  alive(trx: Trx | undefined): void
  /** The transaction that last wrote the definition: a view that cannot see it reads ER_TABLE_DEF_CHANGED. */
  readonly definedBy: number
}

export interface StorageEngine {
  readonly name: EngineName
  readonly transactional: boolean
  readonly consistentReads: boolean
  /** Make a new table's storage inside the DDL transaction, and return its definition with that storage named. */
  create(def: TableDef, trx: Trx): TableDef
  open(def: TableDef, hooks: TableHooks): Table
  /** Retire a table's storage as part of the DDL transaction: what can wait for purge does. */
  drop(def: TableDef, trx: Trx): void
  /** After the DROP commits: what could not wait. */
  discard(def: TableDef): void
}

/** The hidden row id as stored: six bytes, big-endian. */
function rowIdBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(ROW_ID_BYTES)
  for (let i = ROW_ID_BYTES - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}

function checkRow(def: TableDef, row: Row): void {
  if (row.length !== def.columns.length) throw misuse(`${row.length} fields for a ${def.columns.length}-column table`)
}

/** The AUTO_INCREMENT column, and its value in `row` if it has one. */
function autoValue(def: TableDef, row: Row): bigint | undefined {
  const at = def.columns.findIndex((c) => c.autoIncrement === true)
  const v = at === -1 ? null : (row[at] ?? null)
  return v === null ? undefined : decodeInt(v, def.columns[at]?.type.unsigned === true)
}


// --- native -----------------------------------------------------------------

/** The B+tree engine: one clustered tree and one per other index, all MVCC. */
export class NativeEngine implements StorageEngine {
  readonly name = 'native'
  readonly transactional = true
  readonly consistentReads = true
  readonly store: Store

  constructor(store: Store) {
    this.store = store
  }

  /**
   * One tree per index, and the hidden row id's if there is no key to cluster
   * by — each made in its own write with the undo record that drops it on
   * rollback (`TreeUndo`), so a crash between two leaves nothing behind and no
   * one mini-transaction grows with the table's width. Every key is checked
   * against the page before the first tree is made.
   */
  create(def: TableDef, trx: Trx): TableDef {
    const layout = layoutOf(def)
    ClusteredIndex.check(this.store.pool.pageSize, layout, clusteredKeyOf(def), secondariesOf(def).map((i) => keyColumnsOf(def, i)))
    const tree = (clustered: boolean): number =>
      trx.write(() => {
        const t = this.store.createTree()
        trx.undo({ trees: { onRollback: [{ indexId: t.indexId, layout: clustered ? layout : null }], onPurge: [] } })
        return t.indexId
      })
    const rowIdIndexId = def.clustered === null ? tree(true) : undefined
    const indexes = def.indexes.map((i) => ({ ...i, indexId: tree(i.name === def.clustered) }))
    return { ...def, indexes, ...(rowIdIndexId === undefined ? {} : { rowIdIndexId }) }
  }

  open(def: TableDef, hooks: TableHooks): Table {
    return new NativeTable(this.store, def, hooks)
  }

  /** The trees go when purge reaches the DROP: until then, a view older than it may still be reading them. */
  drop(def: TableDef, trx: Trx): void {
    const layout = layoutOf(def)
    const clustered = clusteredIdOf(def)
    const onPurge = [clustered, ...secondariesOf(def).map((i) => i.indexId as number)].map((indexId) => ({ indexId, layout: indexId === clustered ? layout : null }))
    trx.write(() => trx.undo({ trees: { onRollback: [], onPurge } }))
  }

  discard(): void {}
}

const clusteredIdOf = (def: TableDef): number => (def.clustered === null ? def.rowIdIndexId : def.indexes.find((i) => i.name === def.clustered)?.indexId) as number

class NativeTable implements Table {
  readonly def: TableDef
  readonly #store: Store
  readonly #hooks: TableHooks
  readonly #clustered: ClusteredIndex
  readonly #secondaries: SecondaryIndex[]
  readonly #hidden: boolean
  #checkedAt = -1

  constructor(store: Store, def: TableDef, hooks: TableHooks) {
    this.def = def
    this.#store = store
    this.#hooks = hooks
    this.#hidden = def.clustered === null
    this.#clustered = new ClusteredIndex(store.openTree(clusteredIdOf(def)), layoutOf(def), clusteredKeyOf(def), def.clustered ?? 'GEN_CLUST_INDEX')
    this.#secondaries = secondariesOf(def).map(
      (i) => new SecondaryIndex(store.openTree(i.indexId as number), this.#clustered, keyColumnsOf(def, i), { unique: i.kind !== 'index', name: i.name }),
    )
  }

  insert(row: Row, trx?: Trx): RowId {
    checkRow(this.def, row)
    this.#present()
    this.#hooks.alive(trx)
    const full = this.#hidden ? [...row, rowIdBytes(this.#store.takeCounter(this.#clustered.tree.indexId, 1))] : row
    return this.#change(trx, (t) => {
      const id = this.#clustered.insert(full, t)
      for (const s of this.#secondaries) s.insert(full, id, t)
      this.#raise(row)
      return id
    })
  }

  update(id: RowId, row: Row, trx?: Trx): RowId | undefined {
    checkRow(this.def, row)
    this.#present()
    this.#hooks.alive(trx)
    return this.#change(trx, (t) => {
      const old = this.#clustered.get(id, t, 'current')
      if (old === undefined) return undefined
      const full = this.#hidden ? [...row, id] : row
      const next = this.#clustered.keyOf(full)
      if (equalBytes(next, id)) this.#clustered.update(full, t)
      else {
        this.#clustered.delete(id, t)
        this.#clustered.insert(full, t)
      }
      for (const s of this.#secondaries) {
        if (equalBytes(next, id) && equalBytes(encodeKey(s.columns.map((c) => old[c.field] ?? null), s.columns.map((c) => c.part)), encodeKey(s.columns.map((c) => full[c.field] ?? null), s.columns.map((c) => c.part)))) continue
        s.delete(old, id, t)
        s.insert(full, next, t)
      }
      this.#raise(row)
      return next
    })
  }

  delete(id: RowId, trx?: Trx): boolean {
    this.#present()
    this.#hooks.alive(trx)
    return this.#change(trx, (t) => {
      const old = this.#clustered.get(id, t, 'current')
      if (old === undefined) return false
      this.#clustered.delete(id, t)
      for (const s of this.#secondaries) s.delete(old, id, t)
      return true
    })
  }

  duplicateOf(index: string, row: Row, trx?: Trx): RowId | undefined {
    checkRow(this.def, row)
    this.#visible(trx, 'current')
    const name = indexOf(this.def, index).name
    if (name === this.def.clustered) return this.#clustered.duplicateOf(row)
    return this.#secondaries.find((s) => s.name === name)?.duplicateOf(row)
  }

  get(id: RowId, trx?: Trx, mode: ReadMode = 'consistent'): FieldBytes[] | undefined {
    this.#visible(trx, mode)
    return this.#strip(this.#clustered.get(id, trx, mode))
  }

  *scan(range: KeyRange = {}, trx?: Trx, mode: ReadMode = 'consistent'): Generator<[RowId, FieldBytes[]]> {
    this.#visible(trx, mode)
    const r = encodeRange(range, this.#clustered.primary)
    if (r === undefined) return
    for (const [id, row] of this.#clustered.scan(r, trx, mode)) yield [id, this.#strip(row) as FieldBytes[]]
  }

  *indexScan(index: string, range: KeyRange = {}, trx?: Trx, mode: ReadMode = 'consistent'): Generator<[RowId, FieldBytes[]]> {
    const name = indexOf(this.def, index).name
    if (name === this.def.clustered) {
      yield* this.scan(range, trx, mode)
      return
    }
    this.#visible(trx, mode)
    const s = this.#secondaries.find((x) => x.name === name) as SecondaryIndex
    const r = encodeRange(range, s.columns)
    if (r === undefined) return
    for (const [id, row] of s.scan(r, trx, mode)) yield [id, this.#strip(row) as FieldBytes[]]
  }

  nextAutoIncrement(count = 1): bigint {
    return this.#store.takeCounter(this.#clustered.tree.indexId, 0, count)
  }

  peekAutoIncrement(): bigint {
    return this.#store.counter(this.#clustered.tree.indexId, 0)
  }

  raiseAutoIncrement(next: bigint): void {
    if (next > 1n) this.#store.raiseCounter(this.#clustered.tree.indexId, 0, next - 1n)
  }

  stats(): TableStats {
    let rows = 0
    const pageSize = this.#store.pool.pageSize
    const data = this.#clustered.tree.nodePages(() => rows++).length * pageSize
    let index = 0
    for (const s of this.#secondaries) index += s.tree.nodePages().length * pageSize
    return { rows, dataLength: data, indexLength: index }
  }

  #raise(row: Row): void {
    const v = autoValue(this.def, row)
    if (v !== undefined && v > 0n) this.#store.raiseCounter(this.#clustered.tree.indexId, 0, v)
  }

  /**
   * The table's trees are still there. A handle kept past a DROP that purge
   * has since finished would otherwise read pages that are free, or someone
   * else's now; a DROP purge has not reached leaves them readable, as it should.
   */
  #present(): void {
    if (this.#checkedAt === this.#store.drops) return
    for (const tree of [this.#clustered.tree, ...this.#secondaries.map((s) => s.tree)]) {
      if (!this.#store.hasTree(tree.indexId)) throw noSuchTable(this.def.schema, this.def.name)
    }
    this.#checkedAt = this.#store.drops
  }

  /** A consistent read through a view older than the definition is InnoDB's 1412, not an empty table. */
  #visible(trx: Trx | undefined, mode: ReadMode): void {
    this.#present()
    if (trx !== undefined && mode === 'consistent' && !trx.view.isVisible(this.#hooks.definedBy)) throw tableDefChanged()
  }

  #strip(row: FieldBytes[] | undefined): FieldBytes[] | undefined {
    return row !== undefined && this.#hidden ? row.slice(0, -1) : row
  }

  #change<T>(trx: Trx | undefined, change: (t: Trx) => T): T {
    if (trx !== undefined) return trx.write(() => change(trx))
    return this.#store.transactions.autocommit((t) => t.write(() => change(t)))
  }
}

function indexOf(def: TableDef, name: string): IndexDef {
  const i = def.indexes.find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (i === undefined) throw misuse(`table ${def.name} has no index ${name}`)
  return i
}

/** A range of values as a range of encoded keys; `undefined` when it is empty. Every part encodes prefix-free, so a prefix's keys are contiguous. */
function encodeRange(range: KeyRange, columns: readonly KeyColumn[]): Range | undefined {
  const enc = (b: KeyBound): Uint8Array => {
    if (b.values.length > columns.length) throw misuse(`a bound of ${b.values.length} values on a ${columns.length}-column index`)
    return encodeKey(b.values, columns.slice(0, b.values.length).map((c) => c.part))
  }
  let from: Uint8Array | undefined
  let to: Uint8Array | undefined
  if (range.from !== undefined) {
    const k = enc(range.from)
    from = range.from.inclusive ? k : prefixEnd(k)
    if (from === undefined) return undefined
  }
  if (range.to !== undefined) {
    const k = enc(range.to)
    to = range.to.inclusive ? prefixEnd(k) : k
  }
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }), ...(range.reverse === true ? { reverse: true } : {}) }
}

// --- memory -----------------------------------------------------------------

/**
 * Compare two values of one key part the way MySQL does: NULL first, a string
 * by its collation after a CHAR's trailing spaces and any prefix are cut, a
 * float by its number, anything else by its bytes — which `@myjs/types`
 * already writes in order. Nothing from the key encoder is used.
 */
function comparePart(a: FieldBytes, b: FieldBytes, part: KeyPart): number {
  let out: number
  if (a === null || b === null) out = a === null ? (b === null ? 0 : -1) : 1
  else if (part.kind === 'float') out = compareFloat(number(a), number(b))
  else if (part.kind === 'text') {
    const c = collation(part.collationId as number)
    out = c.compare(cut(a, part, c.mbmaxlen), cut(b, part, c.mbmaxlen))
  } else out = memcmp(cut(a, part, 1), cut(b, part, 1))
  return part.descending === true ? -out : out
}

const number = (v: Uint8Array): number => (v.length === 4 ? decodeFloat(v) : decodeDouble(v))

function cut(v: Uint8Array, part: KeyPart, mbmaxlen: number): Uint8Array {
  let end = v.length
  if (part.trimSpaces === true) while (end > 0 && v[end - 1] === 0x20) end--
  if (part.prefix === undefined) return v.subarray(0, end)
  if (mbmaxlen === 1) return v.subarray(0, Math.min(end, part.prefix))
  // Characters, not bytes: a UTF-8 lead byte says how long its character is.
  let at = 0
  for (let chars = 0; at < end && chars < part.prefix; chars++) {
    const lead = v[at] as number
    at += lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
  }
  return v.subarray(0, Math.min(at, end))
}

function compareKey(a: readonly FieldBytes[], b: readonly FieldBytes[], columns: readonly KeyColumn[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = comparePart(a[i] ?? null, b[i] ?? null, (columns[i] as KeyColumn).part)
    if (c !== 0) return c
  }
  return 0
}

const valuesOf = (row: Row, columns: readonly KeyColumn[]): FieldBytes[] => columns.map((c) => row[c.field] ?? null)

interface MemoryRow {
  readonly id: RowId
  readonly key: FieldBytes[]
  row: FieldBytes[]
}

interface MemoryData {
  rows: MemoryRow[]
  nextAuto: bigint
  nextRowId: bigint
}

/** An in-memory, non-transactional engine: sorted arrays and binary search. */
export class MemoryEngine implements StorageEngine {
  readonly name = 'memory'
  readonly transactional = false
  readonly consistentReads = false
  readonly #data = new Map<number, MemoryData>()

  create(def: TableDef): TableDef {
    this.#data.set(def.id, { rows: [], nextAuto: 1n, nextRowId: 1n })
    return def
  }

  /** A memory table's rows do not outlive the process: one opened after a restart is empty, as MySQL's are. */
  open(def: TableDef, hooks: TableHooks): Table {
    let data = this.#data.get(def.id)
    if (data === undefined) this.#data.set(def.id, (data = { rows: [], nextAuto: 1n, nextRowId: 1n }))
    return new MemoryTable(def, data, hooks)
  }

  drop(): void {}

  discard(def: TableDef): void {
    this.#data.delete(def.id)
  }
}

class MemoryTable implements Table {
  readonly def: TableDef
  readonly #data: MemoryData
  readonly #hooks: TableHooks
  readonly #clustered: KeyColumn[]
  readonly #secondaries: { readonly index: IndexDef; readonly columns: KeyColumn[] }[]
  readonly #layout: RecordLayout

  constructor(def: TableDef, data: MemoryData, hooks: TableHooks) {
    this.def = def
    this.#data = data
    this.#hooks = hooks
    this.#clustered = clusteredKeyOf(def)
    this.#secondaries = secondariesOf(def).map((index) => ({ index, columns: keyColumnsOf(def, index) }))
    this.#layout = layoutOf(def)
  }

  insert(row: Row, trx?: Trx): RowId {
    checkRow(this.def, row)
    this.#hooks.alive(trx)
    const full = this.def.clustered === null ? [...row, rowIdBytes(this.#data.nextRowId++)] : [...row]
    this.#check(full)
    const key = valuesOf(full, this.#clustered)
    this.#unique(key, full, undefined)
    const id = encodeKey(key, this.#clustered.map((c) => c.part))
    this.#data.rows.splice(this.#position(key), 0, { id, key, row: full })
    this.#raise(row)
    return id
  }

  update(id: RowId, row: Row, trx?: Trx): RowId | undefined {
    checkRow(this.def, row)
    this.#hooks.alive(trx)
    const at = this.#find(id)
    if (at === -1) return undefined
    const current = this.#data.rows[at] as MemoryRow
    const full = this.def.clustered === null ? [...row, id] : [...row]
    this.#check(full)
    const key = valuesOf(full, this.#clustered)
    this.#unique(key, full, current)
    this.#data.rows.splice(at, 1)
    const next = encodeKey(key, this.#clustered.map((c) => c.part))
    this.#data.rows.splice(this.#position(key), 0, { id: next, key, row: full })
    this.#raise(row)
    return next
  }

  delete(id: RowId, trx?: Trx): boolean {
    this.#hooks.alive(trx)
    const at = this.#find(id)
    if (at === -1) return false
    this.#data.rows.splice(at, 1)
    return true
  }

  get(id: RowId): FieldBytes[] | undefined {
    const r = this.#data.rows[this.#find(id)]
    return r === undefined ? undefined : this.#strip(r.row)
  }

  *scan(range: KeyRange = {}): Generator<[RowId, FieldBytes[]]> {
    yield* this.#ranged(
      this.#data.rows.map((r) => ({ key: r.key, r })),
      this.#clustered,
      range,
    )
  }

  *indexScan(index: string, range: KeyRange = {}): Generator<[RowId, FieldBytes[]]> {
    const name = indexOf(this.def, index).name
    if (name === this.def.clustered) {
      yield* this.scan(range)
      return
    }
    const s = this.#secondaries.find((x) => x.index.name === name) as { columns: KeyColumn[] }
    // An index's order is its own key, then the clustered key, as native's entries are.
    const entries = this.#data.rows.map((r) => ({ key: valuesOf(r.row, s.columns), r }))
    entries.sort((a, b) => compareKey(a.key, b.key, s.columns) || compareKey(a.r.key, b.r.key, this.#clustered))
    yield* this.#ranged(entries, s.columns, range)
  }

  nextAutoIncrement(count = 1): bigint {
    if (!Number.isInteger(count) || count < 1) throw misuse(`a count of ${count}`)
    const first = this.#data.nextAuto
    this.#data.nextAuto += BigInt(count)
    return first
  }

  peekAutoIncrement(): bigint {
    return this.#data.nextAuto
  }

  raiseAutoIncrement(next: bigint): void {
    if (next > this.#data.nextAuto) this.#data.nextAuto = next
  }

  stats(): TableStats {
    let bytes = 0
    for (const r of this.#data.rows) for (const f of r.row) bytes += f?.length ?? 0
    return { rows: this.#data.rows.length, dataLength: bytes, indexLength: 0 }
  }

  /** A snapshot of `entries` in range — a copy, so a write while iterating cannot move what is left. */
  *#ranged(entries: { key: FieldBytes[]; r: MemoryRow }[], columns: readonly KeyColumn[], range: KeyRange): Generator<[RowId, FieldBytes[]]> {
    const inside = entries.filter(({ key }) => {
      if (range.from !== undefined) {
        const c = compareKey(key, range.from.values, columns)
        if (c < 0 || (c === 0 && !range.from.inclusive)) return false
      }
      if (range.to !== undefined) {
        const c = compareKey(key, range.to.values, columns)
        if (c > 0 || (c === 0 && !range.to.inclusive)) return false
      }
      return true
    })
    if (range.reverse === true) inside.reverse()
    for (const { r } of inside) yield [r.id, this.#strip(r.row) as FieldBytes[]]
  }

  duplicateOf(index: string, row: Row): RowId | undefined {
    checkRow(this.def, row)
    const name = indexOf(this.def, index).name
    if (name === this.def.clustered) {
      const key = valuesOf(row, this.#clustered)
      return this.#data.rows.find((r) => compareKey(r.key, key, this.#clustered) === 0)?.id
    }
    const s = this.#secondaries.find((x) => x.index.name === name)
    if (s === undefined || s.index.kind === 'index') return undefined
    const values = valuesOf(row, s.columns)
    if (values.some((v) => v === null)) return undefined
    return this.#data.rows.find((r) => compareKey(valuesOf(r.row, s.columns), values, s.columns) === 0)?.id
  }

  /** What native's record and key encoders would refuse, refused alike: a field's width, a NOT NULL, a value that cannot be keyed. */
  #check(full: FieldBytes[]): void {
    for (let i = 0; i < this.#layout.length; i++) {
      const f = this.#layout[i] as { nullable: boolean; fixed?: number }
      const v = full[i] ?? null
      if (v === null && !f.nullable) throw misuse(`field ${i} is NOT NULL`)
      if (v !== null && f.fixed !== undefined && v.length !== f.fixed) throw misuse(`field ${i} is ${f.fixed} bytes wide, given ${v.length}`)
    }
    for (const columns of [this.#clustered, ...this.#secondaries.map((s) => s.columns)]) encodeKey(valuesOf(full, columns), columns.map((c) => c.part))
  }

  /** ER_DUP_ENTRY in the clustered index, then in each UNIQUE index in order — the order native inserts them. */
  #unique(key: FieldBytes[], full: FieldBytes[], self: MemoryRow | undefined): void {
    const clash = this.#data.rows.find((r) => r !== self && compareKey(r.key, key, this.#clustered) === 0)
    if (clash !== undefined) throw duplicateKey(this.def.clustered ?? 'GEN_CLUST_INDEX')
    for (const s of this.#secondaries) {
      if (s.index.kind === 'index') continue
      const values = valuesOf(full, s.columns)
      if (values.some((v) => v === null)) continue
      if (this.#data.rows.some((r) => r !== self && compareKey(valuesOf(r.row, s.columns), values, s.columns) === 0)) throw duplicateKey(s.index.name)
    }
  }

  #position(key: FieldBytes[]): number {
    let lo = 0
    let hi = this.#data.rows.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (compareKey((this.#data.rows[mid] as MemoryRow).key, key, this.#clustered) < 0) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  #find(id: RowId): number {
    return this.#data.rows.findIndex((r) => equalBytes(r.id, id))
  }

  #raise(row: Row): void {
    const v = autoValue(this.def, row)
    if (v !== undefined && v >= this.#data.nextAuto) this.#data.nextAuto = v + 1n
  }

  #strip(row: FieldBytes[]): FieldBytes[] {
    return this.def.clustered === null ? row.slice(0, -1) : row.slice()
  }
}
