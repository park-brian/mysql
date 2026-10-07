// M4.24 — the `Table` interface, its two engines, and the done-when: the
// executor cannot tell them apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { FIELD_TYPE } from '@myjs/bytes'
import { loadCollation } from '@myjs/charsets'
import { encodeDouble, encodeInt } from '@myjs/types'
import { MemoryVfs } from '@myjs/vfs'
import { runTableConformance, tableConformanceCases, type TableFactory } from '@myjs/engine/conformance'
import { Catalog, Store, verifyStore, type EngineName, type KeyBound, type KeyRange, type Table, type TableSpec } from '@myjs/engine'

await loadCollation(255)

/** A factory for `engine`: each table in a fresh store, checked by `verifyStore` once the case is done. */
function factory(engine: EngineName, pageSize = 1024): { make: TableFactory; verify: () => void; catalog: () => Catalog } {
  const made: Catalog[] = []
  const make: TableFactory = async (spec) => {
    const vfs = new MemoryVfs({ pageSize })
    const store = Store.create(await vfs.open('data', { create: true }), await vfs.open('log', { create: true }), { frames: 64 })
    const catalog = Catalog.open(store)
    made.push(catalog)
    catalog.createSchema('s')
    catalog.createTable('s', { ...spec, engine })
    return catalog.table('s', spec.name)
  }
  return { make, verify: () => made.forEach((c) => verifyStore(c.store, c.verifyOptions())), catalog: () => made[made.length - 1] as Catalog }
}

for (const engine of ['native', 'memory'] as const) {
  for (const c of tableConformanceCases) {
    test(`${engine}: ${c.name}`, async () => {
      const f = factory(engine)
      await c.run(f.make)
      f.verify()
    })
  }
}

test('the suite has teeth — an engine that ignores a unique index fails it', async () => {
  const f = factory('memory')
  const failures = await runTableConformance(async (spec) => f.make({ ...spec, indexes: (spec.indexes ?? []).map((i) => (i.kind === 'unique' ? { ...i, kind: 'index' as const } : i)) }))
  assert.ok(failures.some((x) => x.name.includes('ER_DUP_ENTRY') || x.name.includes('duplicate')), failures.map((x) => x.name).join('; '))
})

// --- the differential test ----------------------------------------------------

const differentialSpec: TableSpec = {
  name: 'd',
  columns: [
    { name: 'id', type: { type: FIELD_TYPE.LONG }, nullable: false },
    { name: 'name', type: { type: FIELD_TYPE.VAR_STRING, length: 6, collationId: 255 }, nullable: true },
    { name: 'age', type: { type: FIELD_TYPE.LONG }, nullable: true },
    { name: 'd', type: { type: FIELD_TYPE.DOUBLE }, nullable: true },
    { name: 'c', type: { type: FIELD_TYPE.STRING, length: 3, collationId: 46 }, nullable: false },
  ],
  indexes: [
    { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] },
    { name: 'name', kind: 'unique', parts: [{ column: 'name' }] },
    { name: 'age_d', kind: 'index', parts: [{ column: 'age', descending: true }, { column: 'd' }] },
    { name: 'c', kind: 'unique', parts: [{ column: 'c', prefix: 2 }, { column: 'age' }] },
  ],
}

const NAMES = [null, 'a', 'A', 'ä', 'b', 'ss', 'ß', 'Straße', 'b ', 'æ', 'ae', '\u{1f600}']
const AGES = [null, -2, -1, 0, 1, 2]
const DOUBLES = [null, -0, 0, 1.5, -1, Infinity, -Infinity, 1e-300]
const CHARS = ['a', 'a ', 'ab', 'abc', 'b', 'é', 'E', 'A  ']

const arbRow = fc.record({
  id: fc.integer({ min: 0, max: 12 }),
  name: fc.constantFrom(...NAMES),
  age: fc.constantFrom(...AGES),
  d: fc.constantFrom(...DOUBLES),
  c: fc.constantFrom(...CHARS),
})
type Values = { id: number; name: string | null; age: number | null; d: number | null; c: string }
const rowOf = (v: Values) => [
  encodeInt(BigInt(v.id), 4, false),
  v.name === null ? null : new TextEncoder().encode(v.name),
  v.age === null ? null : encodeInt(BigInt(v.age), 4, false),
  v.d === null ? null : encodeDouble(v.d),
  new TextEncoder().encode(v.c),
]
const arbRange = fc.record({
  from: fc.option(fc.record({ values: fc.array(fc.constantFrom(...AGES.filter((a) => a !== null)), { maxLength: 1 }), inclusive: fc.boolean() }), { nil: undefined }),
  to: fc.option(fc.record({ values: fc.array(fc.constantFrom(...AGES.filter((a) => a !== null)), { maxLength: 1 }), inclusive: fc.boolean() }), { nil: undefined }),
  reverse: fc.boolean(),
})
const arbOp = fc.oneof(
  fc.record({ op: fc.constant('insert' as const), row: arbRow }),
  fc.record({ op: fc.constant('update' as const), id: fc.integer({ min: 0, max: 12 }), row: arbRow }),
  fc.record({ op: fc.constant('delete' as const), id: fc.integer({ min: 0, max: 12 }) }),
  fc.record({ op: fc.constant('range' as const), index: fc.constantFrom('PRIMARY', 'age_d'), range: arbRange }),
)

/** An outcome both engines must agree on: a result, or an error's code and message. */
function outcome(fn: () => unknown): string {
  try {
    return JSON.stringify(fn(), (_, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : typeof v === 'bigint' ? `${v}` : v))
  } catch (e) {
    return `error ${(e as { code?: string }).code}: ${(e as Error).message}`
  }
}

test('M4.24 done-when: random operations on native and memory give the same answers, step for step', async () => {
  const native = factory('native')
  const memory = factory('memory')
  await fc.assert(
    fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 40 }), async (ops) => {
      const [n, m] = [await native.make(differentialSpec), await memory.make(differentialSpec)]
      for (const [step, o] of ops.entries()) {
        const run = (t: Table) => {
          const i32 = (x: number) => encodeInt(BigInt(x), 4, false)
          if (o.op === 'insert') return t.insert(rowOf(o.row))
          if (o.op === 'update') return t.update(i32(o.id), rowOf({ ...o.row }))
          if (o.op === 'delete') return t.delete(i32(o.id))
          const bound = (b: { values: number[]; inclusive: boolean } | undefined) => (b === undefined ? {} : { values: b.values.map(i32), inclusive: b.inclusive })
          const range: KeyRange = {
            reverse: o.range.reverse,
            ...(o.range.from === undefined ? {} : { from: bound(o.range.from) as KeyBound }),
            ...(o.range.to === undefined ? {} : { to: bound(o.range.to) as KeyBound }),
          }
          return [...t.indexScan(o.index, range)]
        }
        assert.equal(outcome(() => run(n)), outcome(() => run(m)), `step ${step}: ${JSON.stringify(o)}`)
        for (const index of ['PRIMARY', 'name', 'age_d', 'c']) assert.equal(outcome(() => [...n.indexScan(index)]), outcome(() => [...m.indexScan(index)]), `step ${step}: index ${index}`)
      }
    }),
    { numRuns: 150 },
  )
  native.verify()
})

// --- what only native does: its declared capabilities -------------------------

const people: TableSpec = {
  name: 'p',
  columns: [
    { name: 'id', type: { type: FIELD_TYPE.LONG }, nullable: false },
    { name: 'name', type: { type: FIELD_TYPE.VAR_STRING, length: 8, collationId: 255 }, nullable: true },
    { name: 'blob', type: { type: FIELD_TYPE.BLOB, collationId: 63 }, nullable: true },
  ],
  indexes: [
    { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] },
    { name: 'name', kind: 'unique', parts: [{ column: 'name' }] },
  ],
}
const i32 = (n: number) => encodeInt(BigInt(n), 4, false)
const row = (id: number, name: string, blob: Uint8Array | null = null) => [i32(id), new TextEncoder().encode(name), blob]

test('native is transactional: a rollback undoes a row in every index; memory declares it is not', async () => {
  const vfs = new MemoryVfs({ pageSize: 1024 })
  const store = Store.create(await vfs.open('d', { create: true }), await vfs.open('l', { create: true }), { frames: 64 })
  const catalog = Catalog.open(store)
  catalog.createSchema('s')
  catalog.createTable('s', people)
  catalog.createTable('s', { ...people, name: 'm', engine: 'memory' })
  assert.deepEqual([catalog.engines.native.transactional, catalog.engines.native.consistentReads], [true, true])
  assert.deepEqual([catalog.engines.memory.transactional, catalog.engines.memory.consistentReads], [false, false])
  const [n, m] = [catalog.table('s', 'p'), catalog.table('s', 'm')]
  const trx = store.begin()
  for (const t of [n, m]) {
    t.insert(row(1, 'a', new Uint8Array(3000).fill(1)), trx)
    t.update(i32(1), row(2, 'b'), trx)
  }
  trx.rollback()
  assert.equal([...n.scan()].length + [...n.indexScan('name')].length, 0)
  assert.equal([...m.scan()].length, 1, 'memory keeps what a rollback would undo, as MySQL\'s MEMORY does')
  store.purge()
  verifyStore(store, catalog.verifyOptions())
})

test('native: a row is one write — a refusal in its second index leaves no trace inside a transaction', async () => {
  const f = factory('native')
  const t = await f.make(people)
  t.insert(row(1, 'a'))
  const trx = f.catalog().store.begin()
  t.insert(row(2, 'b'), trx)
  assert.throws(() => t.insert(row(3, 'a'), trx), /Duplicate entry/)
  assert.deepEqual([...t.scan(undefined, trx)].map(([id]) => [...id]), [[...i32(1)], [...i32(2)]], 'no row 3 in the clustered index')
  trx.commit()
  assert.equal([...t.indexScan('name')].length, 2)
  f.verify()
})

test('native: a transaction reads its snapshot through the table, in every index', async () => {
  const f = factory('native')
  const t = await f.make(people)
  const store = f.catalog().store
  t.insert(row(1, 'a'))
  const reader = store.begin()
  assert.equal([...t.scan(undefined, reader)].length, 1)
  t.insert(row(2, 'b'))
  t.update(i32(1), row(1, 'z'))
  t.delete(i32(2))
  t.insert(row(3, 'c'))
  assert.deepEqual([...t.indexScan('name', undefined, reader)].map(([, r]) => new TextDecoder().decode(r[1] as Uint8Array)), ['a'])
  assert.deepEqual([...t.indexScan('name')].map(([, r]) => new TextDecoder().decode(r[1] as Uint8Array)), ['c', 'z'])
  reader.commit()
  store.purge()
  f.verify()
})
