// M4.23 — the catalog: schemas and tables as rows, DDL as transactions, and
// the done-when — a catalog written by another version is migrated or refused,
// never misread.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import { loadCollation } from '@myjs/charsets'
import { errnoOf, sqlStateOf } from '@myjs/protocol'
import { encodeInt, decodeInt } from '@myjs/types'
import { MemoryVfs, type Vfs, type VfsFile } from '@myjs/vfs'
import { FaultInjectingVfs } from '@myjs/vfs/fault'
import { Catalog, EngineError, Store, decodeTableDef, resolveTable, encodeTableDef, verifyStore, type ColumnDef, type Migration, type TableSpec } from '@myjs/engine'

await loadCollation(255)

const PAGE = 1024
const crashedError = (e: unknown) => (e as { code?: string }).code === 'VFS_CRASHED'
const files = async (vfs: Vfs): Promise<[VfsFile, VfsFile]> => [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]
const int = (name: string, more: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: { type: FIELD_TYPE.LONG }, nullable: false, ...more })
const varchar = (name: string, length: number, nullable = true): ColumnDef => ({ name, type: { type: FIELD_TYPE.VAR_STRING, length, collationId: 255 }, nullable })
const i32 = (n: number) => encodeInt(BigInt(n), 4, false)
const utf8 = (s: string) => new TextEncoder().encode(s)

const spec = (name = 't'): TableSpec => ({
  name,
  columns: [int('id'), varchar('v', 20), { name: 'b', type: { type: FIELD_TYPE.BLOB, collationId: 63 }, nullable: true }],
  indexes: [
    { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] },
    { name: 'v', kind: 'unique', parts: [{ column: 'v' }] },
  ],
})

async function fresh(pageSize = PAGE) {
  const vfs = new MemoryVfs({ pageSize })
  const store = Store.create(...(await files(vfs)), { frames: 64 })
  const catalog = Catalog.open(store)
  return { vfs, store, catalog }
}

/** The error `fn` throws, which must carry MySQL's number and SQLSTATE for `code`. */
function refused(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof Error && 'code' in e, String(e))
    const err = e as EngineError
    assert.equal(err.code, code)
    assert.equal(err.errno, errnoOf(code as never), code)
    assert.equal(err.sqlState, sqlStateOf(code as never), code)
    return true
  })
}

test('M4.23: schemas and tables persist across a reopen, definitions and rows alike', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('app')
  const def = catalog.createTable('app', spec())
  const t = catalog.table('app', 't')
  t.insert([i32(1), utf8('one'), new Uint8Array(3000).fill(1)])
  verifyStore(store, catalog.verifyOptions())
  store.close()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  const again = Catalog.open(reopened)
  assert.deepEqual(again.definition('app', 't'), def)
  assert.deepEqual(again.schemas().map((s) => s.name), ['app'])
  assert.deepEqual(again.tables().map((d) => d.name), ['t'])
  assert.deepEqual(again.table('app', 't').get(i32(1))?.[2], new Uint8Array(3000).fill(1))
  verifyStore(reopened, again.verifyOptions())
})

test('M4.23: every refusal carries MySQL\'s number', async () => {
  const { catalog } = await fresh()
  catalog.createSchema('app')
  catalog.createTable('app', spec())
  const t = (s: Partial<TableSpec>) => () => catalog.createTable('app', { ...spec('u'), ...s })
  refused(() => catalog.createSchema('app'), 'ER_DB_CREATE_EXISTS')
  refused(() => catalog.dropSchema('nope'), 'ER_DB_DROP_EXISTS')
  refused(() => catalog.createTable('nope', spec()), 'ER_BAD_DB_ERROR')
  refused(() => catalog.schema('nope'), 'ER_BAD_DB_ERROR')
  refused(() => catalog.createTable('app', spec()), 'ER_TABLE_EXISTS_ERROR')
  refused(() => catalog.dropTable('app', 'nope'), 'ER_BAD_TABLE_ERROR')
  refused(() => catalog.definition('app', 'nope'), 'ER_NO_SUCH_TABLE')
  refused(() => catalog.table('nope', 't'), 'ER_NO_SUCH_TABLE')
  refused(() => catalog.createSchema('x'.repeat(65)), 'ER_TOO_LONG_IDENT')
  refused(() => catalog.createSchema(''), 'ER_WRONG_DB_NAME')
  refused(() => catalog.createSchema('a '), 'ER_WRONG_DB_NAME')
  refused(() => catalog.createSchema('\u{1f600}'), 'ER_WRONG_DB_NAME')
  refused(t({ name: '' }), 'ER_WRONG_TABLE_NAME')
  refused(t({ columns: [] }), 'ER_TABLE_MUST_HAVE_COLUMNS')
  refused(t({ columns: [int('a'), int('A')], indexes: [] }), 'ER_DUP_FIELDNAME')
  refused(t({ indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'id' }, { column: 'ID' }] }] }), 'ER_DUP_FIELDNAME')
  refused(t({ engine: 'MyISAM' as never }), 'ER_UNKNOWN_STORAGE_ENGINE')
  refused(t({ columns: [int('')], indexes: [] }), 'ER_WRONG_COLUMN_NAME')
  refused(t({ indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'id' }] }, { name: 'K', kind: 'index', parts: [{ column: 'v' }] }] }), 'ER_DUP_KEYNAME')
  refused(t({ indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] }, { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'v' }] }] }), 'ER_MULTIPLE_PRI_KEY')
  refused(t({ indexes: [{ name: 'primary', kind: 'index', parts: [{ column: 'id' }] }] }), 'ER_WRONG_NAME_FOR_INDEX')
  refused(t({ indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'nope' }] }] }), 'ER_KEY_COLUMN_DOES_NOT_EXITS')
  refused(t({ indexes: Array.from({ length: 65 }, (_, i) => ({ name: `k${i}`, kind: 'index' as const, parts: [{ column: 'id' }] })) }), 'ER_TOO_MANY_KEYS')
  refused(t({ indexes: [{ name: 'k', kind: 'index', parts: Array.from({ length: 17 }, () => ({ column: 'id' })) }] }), 'ER_TOO_MANY_KEY_PARTS')
  refused(t({ columns: [int('a', { autoIncrement: true })], indexes: [] }), 'ER_WRONG_AUTO_KEY')
  refused(t({ columns: [int('a', { autoIncrement: true }), int('b', { autoIncrement: true })], indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'a' }] }] }), 'ER_WRONG_AUTO_KEY')
  refused(t({ columns: [{ ...varchar('a', 4, false), autoIncrement: true }], indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'a' }] }] }), 'ER_WRONG_FIELD_SPEC')
  refused(t({ indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'b' }] }] }), 'ER_BLOB_KEY_WITHOUT_LENGTH')
  refused(t({ columns: [varchar('a', 300)], indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'a' }] }] }), 'ER_TOO_LONG_KEY')
  refused(() => Catalog.open(catalog.store, { lowerCaseTableNames: 1 }), 'ER_NOT_SUPPORTED_YET')
  // A refusal leaves nothing behind: no tree, no row.
  assert.deepEqual(catalog.tables().map((d) => d.name), ['t'])
  verifyStore(catalog.store, catalog.verifyOptions())
})

test('M4.23: the clustered index is chosen by InnoDB\'s rule', async () => {
  const { catalog } = await fresh()
  catalog.createSchema('s')
  const c = (indexes: NonNullable<TableSpec['indexes']>, columns: ColumnDef[] = [int('a'), int('b', { nullable: true }), varchar('c', 8, false)]) =>
    catalog.createTable('s', { name: `t${catalog.tables().length}`, columns, indexes })
  assert.equal(c([{ name: 'u', kind: 'unique', parts: [{ column: 'a' }] }, { name: 'PRIMARY', kind: 'primary', parts: [{ column: 'c' }] }]).clustered, 'PRIMARY')
  // The first UNIQUE whose columns are all NOT NULL and which has no prefix.
  assert.equal(c([{ name: 'n', kind: 'unique', parts: [{ column: 'b' }] }, { name: 'p', kind: 'unique', parts: [{ column: 'c', prefix: 2 }] }, { name: 'u', kind: 'unique', parts: [{ column: 'a' }] }]).clustered, 'u')
  assert.equal(c([{ name: 'n', kind: 'unique', parts: [{ column: 'b' }] }, { name: 'i', kind: 'index', parts: [{ column: 'a' }] }]).clustered, null)
  // PRIMARY KEY columns become NOT NULL, as MySQL makes them.
  const def = c([{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'b' }] }])
  assert.equal(def.columns[1]?.nullable, false)

  // The order a scan returns follows from it.
  const promoted = catalog.table('s', 't1')
  for (const [a, cc] of [[3, 'x'], [1, 'z'], [2, 'y']] as const) promoted.insert([i32(a), null, utf8(cc)])
  assert.deepEqual([...promoted.scan()].map(([, r]) => decodeInt(r[0] as Uint8Array, false)), [1n, 2n, 3n])
  refused(() => promoted.insert([i32(1), null, utf8('w')]), 'ER_DUP_ENTRY')
  assert.match((() => { try { promoted.insert([i32(1), null, utf8('w')]) } catch (e) { return (e as Error).message } return '' })(), /'u'/)
  const hidden = catalog.table('s', 't2')
  const ids = [3, 1, 2].map((a) => hidden.insert([i32(a), null, utf8('x')]))
  assert.deepEqual([...hidden.scan()].map(([, r]) => decodeInt(r[0] as Uint8Array, false)), [3n, 1n, 2n], 'insertion order: the hidden row id')
  assert.deepEqual(ids.map((id) => id.length), [6, 6, 6])
})

test('M4.23: names of every length MySQL allows fit at 1 KiB pages', async () => {
  // The system tables' keys are sized for 64 BMP characters, and a long name
  // goes off-page like any long field: 1 KiB pages leave a record 98 bytes.
  const { store, catalog } = await fresh()
  for (const n of [15, 16, 40, 41, 64]) {
    const name = 'é'.repeat(n)
    catalog.createSchema(name)
    catalog.createTable(name, { ...spec(name), columns: [int('x'.repeat(64)), varchar('v', 20), spec().columns[2] as ColumnDef], indexes: [] })
    assert.equal(catalog.definition(name, name).name, name)
  }
  verifyStore(store, catalog.verifyOptions())
})

test('M4.23: DROP SCHEMA drops its tables, in one transaction', async () => {
  const { store, catalog } = await fresh()
  const baseline = store.alloc.usedPages().size
  catalog.createSchema('a')
  catalog.createSchema('b')
  for (const n of ['x', 'y', 'z']) catalog.createTable('a', spec(n))
  catalog.createTable('b', spec('x'))
  catalog.table('a', 'y').insert([i32(1), utf8('v'), new Uint8Array(2000)])
  assert.deepEqual(catalog.dropSchema('a'), ['x', 'y', 'z'])
  assert.deepEqual(catalog.tables().map((d) => `${d.schema}.${d.name}`), ['b.x'])
  catalog.dropSchema('b')
  store.purge()
  verifyStore(store, catalog.verifyOptions())
  assert.ok(store.alloc.usedPages().size <= baseline + 2, `${store.alloc.usedPages().size} pages in use against ${baseline} before`)
})

test('M4.23: a DROP under an older view leaves its trees until purge, but no way to write to them', async () => {
  const { store, catalog } = await fresh()
  catalog.createSchema('s')
  catalog.createTable('s', spec())
  const before = store.alloc.usedPages().size
  const t = catalog.table('s', 't')
  for (let i = 0; i < 20; i++) t.insert([i32(i), utf8(`v${i}`), new Uint8Array(1500).fill(i)])
  const reader = store.begin()
  assert.equal([...t.scan(undefined, reader)].length, 20)
  const trees = t.def.indexes.map((i) => i.indexId as number)
  catalog.dropTable('s', 't')
  assert.ok(trees.every((id) => store.hasTree(id)), 'the trees wait for purge')
  // Pages the DROP freed would be reused by this; none must have been.
  catalog.createTable('s', spec('other'))
  for (let i = 0; i < 20; i++) catalog.table('s', 'other').insert([i32(i), utf8(`w${i}`), new Uint8Array(1500).fill(0xee)])
  refused(() => catalog.table('s', 't'), 'ER_NO_SUCH_TABLE')
  // The old handle reads on through its view; a write through it is refused.
  assert.equal([...t.scan(undefined, reader)].length, 20)
  refused(() => t.insert([i32(99), utf8('late'), null]), 'ER_NO_SUCH_TABLE')
  refused(() => t.insert([i32(99), utf8('late'), null], reader), 'ER_NO_SUCH_TABLE')
  verifyStore(store, catalog.verifyOptions())
  assert.deepEqual([...t.scan(undefined, reader)].map(([, r]) => r[2]?.[0]), Array.from({ length: 20 }, (_, i) => i))
  reader.commit()
  store.purge()
  assert.ok(trees.every((id) => !store.hasTree(id)), 'purge drops them')
  verifyStore(store, catalog.verifyOptions())
  catalog.dropTable('s', 'other')
  store.purge()
  assert.ok(store.alloc.usedPages().size < before, 'the rows, chains and trees are gone')
  // A new table of the same name is a new table — and the old handle, kept
  // past the purge that freed its trees, reads nothing of it, or of them.
  catalog.createTable('s', spec())
  assert.equal([...catalog.table('s', 't').scan()].length, 0)
  refused(() => [...t.scan()], 'ER_NO_SUCH_TABLE')
  refused(() => t.get(i32(1)), 'ER_NO_SUCH_TABLE')
  refused(() => t.delete(i32(1)), 'ER_NO_SUCH_TABLE')
})

test('M4.23: a definition that is not JSON is refused, and its rollback leaves nothing behind', async () => {
  const { catalog } = await fresh()
  catalog.createSchema('s')
  assert.throws(() => catalog.createTable('s', { ...spec(), options: { big: 1n } }), (e: EngineError) => e.code === 'ENGINE_MISUSE')
  assert.deepEqual(catalog.tables(), [])
  verifyStore(catalog.store, catalog.verifyOptions())
})

test('M4.23: a name dropped and created again while history is pinned: both generations verify, and purge frees the old', async () => {
  // The crash suite found this: CREATE re-inserts over the dropped row's
  // delete-mark, so the old definition is only in undo — and the undo record
  // that drops the old trees is what describes them until it does.
  const { store, catalog } = await fresh()
  catalog.createSchema('s')
  catalog.createTable('s', spec())
  const before = store.alloc.usedPages().size
  const pin = store.begin()
  pin.view
  for (let gen = 0; gen < 3; gen++) {
    const t = catalog.table('s', 't')
    for (let i = 0; i < 6; i++) t.insert([i32(i), utf8(`${gen}.${i}`), new Uint8Array(1500).fill(gen)])
    catalog.dropTable('s', 't')
    catalog.createTable('s', spec())
    verifyStore(store, catalog.verifyOptions())
  }
  pin.commit()
  store.purge()
  verifyStore(store, catalog.verifyOptions())
  assert.ok(store.alloc.usedPages().size <= before + 4, `${store.alloc.usedPages().size} pages against ${before}`)
})

test('M4.23: a view older than a table reads ER_TABLE_DEF_CHANGED, and may still write to it', async () => {
  const { catalog, store } = await fresh()
  catalog.createSchema('s')
  const old = store.begin()
  old.view
  catalog.createTable('s', spec())
  const t = catalog.table('s', 't')
  t.insert([i32(1), utf8('a'), null])
  refused(() => t.get(i32(1), old), 'ER_TABLE_DEF_CHANGED')
  refused(() => [...t.scan(undefined, old)], 'ER_TABLE_DEF_CHANGED')
  // As in MySQL, the write succeeds: it reads the current version.
  t.insert([i32(2), utf8('b'), null], old)
  assert.ok(t.get(i32(2), old, 'current') !== undefined)
  old.commit()
  assert.equal([...t.scan()].length, 2)
})

/** Run DDL on a fault-injecting VFS armed to crash at `crashAt`; return the VFS, and the writes the DDL made. */
async function crashing(crashAt: number | undefined, ddl: (c: Catalog) => void, setup: (c: Catalog) => void = () => {}) {
  const vfs = new FaultInjectingVfs({ pageSize: PAGE, seed: crashAt ?? 7, ...(crashAt === undefined ? {} : { crashAt }) })
  let start = 0
  let end = 0
  try {
    const store = Store.create(...(await files(vfs)), { frames: 64 })
    const c = Catalog.open(store)
    setup(c)
    store.sync()
    store.checkpoint()
    start = vfs.operations
    ddl(c)
    store.sync()
    store.checkpoint()
    end = vfs.operations
  } catch (e) {
    if (!crashedError(e)) throw e
  }
  return { vfs, start, end }
}

const shape = (c: Catalog) => c.tables().map((d) => `${d.schema}.${d.name}:${[...c.table(d.schema, d.name).scan()].length}`)

/** A table with a tree per column: enough log that its first trees are on disk before its commit is. */
const wide: TableSpec = {
  name: 't',
  columns: [int('id'), ...Array.from({ length: 8 }, (_, i) => varchar(`c${i}`, 8))],
  indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] }, ...Array.from({ length: 8 }, (_, i) => ({ name: `k${i}`, kind: 'index' as const, parts: [{ column: `c${i}` }] }))],
}

for (const [name, setup, ddl, before, after] of [
  ['CREATE TABLE', (c: Catalog) => c.createSchema('s'), (c: Catalog) => c.createTable('s', wide), [], ['s.t:0']],
  [
    'DROP TABLE',
    (c: Catalog) => {
      c.createSchema('s')
      c.createTable('s', spec())
      for (let i = 0; i < 5; i++) c.table('s', 't').insert([i32(i), utf8(`${i}`), new Uint8Array(1200).fill(i)])
    },
    (c: Catalog) => c.dropTable('s', 't'),
    ['s.t:5'],
    [],
  ],
] as const) {
  test(`M4.23: a crash at every write of ${name} recovers to before it or after it, with no orphan tree`, async () => {
    const clean = await crashing(undefined, ddl, setup)
    assert.ok(clean.end - clean.start > 5, `${clean.end - clean.start} writes`)
    for (let k = clean.start + 1; k <= clean.end; k++) {
      for (const kind of ['process', 'power'] as const) {
      const { vfs } = await crashing(k, ddl, setup)
      const store = Store.open(...(await files(vfs.afterCrash({ kind, seed: k }))), { frames: 64 })
      const c = Catalog.open(store)
      store.purge()
      verifyStore(store, c.verifyOptions())
      const got = shape(c)
      assert.ok([before, after].some((s) => JSON.stringify(s) === JSON.stringify(got)), `crash at write ${k}: ${JSON.stringify(got)}`)
      // Every tree in the store belongs to the catalog or the store.
      const owned = new Set([1, 2, 3, 4, ...c.tables().flatMap((d) => [...d.indexes.map((i) => i.indexId), d.rowIdIndexId])])
      for (const t of store.trees()) assert.ok(owned.has(t.indexId), `crash at write ${k} (${kind}): index ${t.indexId} is an orphan`)
      }
    }
  })
}

test('M4.23: a CREATE a crash interrupts before its commit leaves no tree behind', async () => {
  // The crash loops above cannot always split a CREATE from its commit — a
  // small one fits one log block — so this leaves one open on purpose: its
  // trees made and durable, its transaction never committed.
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('s')
  const trx = store.begin()
  const def = catalog.engines.native.create(resolveTable(99, 's', wide), trx)
  assert.equal(def.indexes.filter((i) => store.hasTree(i.indexId as number)).length, 9)
  store.sync()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  assert.equal(reopened.recovered.rolledBack, 1)
  assert.deepEqual([...reopened.trees()].map((t) => t.indexId), [1, 2, 3, 4])
  verifyStore(reopened, Catalog.open(reopened).verifyOptions())
})

// --- the done-when ------------------------------------------------------------

const addFlag: Migration = {
  from: 1,
  migrate(m) {
    for (const t of m.tables()) {
      const d = t.definition as { options: Record<string, unknown> }
      m.rewrite(t.schemaId, t.name, { ...d, options: { ...d.options, migrated: true } })
    }
  },
}

test('M4.23 done-when: an older catalog is migrated, in one transaction with its new version', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('s')
  catalog.createTable('s', spec('a'))
  catalog.createTable('s', spec('b'))
  catalog.table('s', 'a').insert([i32(1), utf8('x'), null])
  store.close()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  const v2 = Catalog.open(reopened, { version: 2, migrations: [addFlag] })
  assert.equal(v2.version, 2)
  assert.deepEqual(v2.tables().map((d) => d.options['migrated']), [true, true])
  assert.equal([...v2.table('s', 'a').scan()].length, 1, 'rows are untouched')
  // Opened again by the same build: already at 2, nothing runs.
  const again = Catalog.open(reopened, { version: 2, migrations: [] })
  assert.equal(again.version, 2)
  verifyStore(reopened, again.verifyOptions())
})

test('M4.23 done-when: a catalog this build cannot migrate is refused, naming both versions', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('s')
  catalog.createTable('s', spec())
  // Older, with a step missing: refused, and nothing changed.
  assert.throws(() => Catalog.open(store, { version: 3, migrations: [addFlag] }), (e: EngineError) => e.code === 'ENGINE_BAD_FORMAT' && /version 1/.test(e.message) && /reads 3/.test(e.message) && /from 2/.test(e.message))
  assert.equal(Catalog.open(store).definition('s', 't').options['migrated'], undefined)
  // Newer than this build: refused, never read.
  Catalog.open(store, { version: 2, migrations: [addFlag] })
  store.close()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  assert.throws(() => Catalog.open(reopened), (e: EngineError) => e.code === 'ENGINE_BAD_FORMAT' && /version 2/.test(e.message) && /reads 1/.test(e.message))
})

test('M4.23 done-when: a crash at every write of a migration leaves it unmigrated, and the next open migrates it', async () => {
  const setup = (c: Catalog) => {
    c.createSchema('s')
    for (const n of ['a', 'b', 'c']) c.createTable('s', spec(n))
  }
  const migrate = (c: Catalog) => Catalog.open(c.store, { version: 2, migrations: [addFlag] })
  const clean = await crashing(undefined, migrate, setup)
  assert.ok(clean.end - clean.start > 3)
  for (let k = clean.start + 1; k <= clean.end; k++) {
    const { vfs } = await crashing(k, migrate, setup)
    const store = Store.open(...(await files(vfs.afterCrash({ kind: 'power', seed: k }))), { frames: 64 })
    // Either it committed — and a build at 1 must refuse it — or it did not,
    // and every definition is as it was.
    let flags: unknown[]
    try {
      flags = Catalog.open(store).tables().map((d) => d.options['migrated'])
      assert.deepEqual(flags, [undefined, undefined, undefined], `crash at write ${k}`)
    } catch (e) {
      assert.equal((e as EngineError).code, 'ENGINE_BAD_FORMAT', `crash at write ${k}: ${String(e)}`)
    }
    const v2 = Catalog.open(store, { version: 2, migrations: [addFlag] })
    assert.deepEqual(v2.tables().map((d) => d.options['migrated']), [true, true, true], `crash at write ${k}`)
    verifyStore(store, v2.verifyOptions())
  }
})

test('M4.23: a stored definition that does not decode is ENGINE_CORRUPT_CATALOG, never a misread', async () => {
  const { catalog } = await fresh()
  catalog.createSchema('s')
  const def = catalog.createTable('s', spec())
  const bytes = encodeTableDef(def)
  assert.deepEqual(decodeTableDef(bytes), def)
  const json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  const variants: unknown[] = [
    null,
    [],
    { ...json, id: -1 },
    { ...json, engine: 'innodb' },
    { ...json, columns: 'x' },
    { ...json, clustered: 'nope' },
    { ...json, indexes: [{ name: 'k', kind: 'index', parts: [{ column: 'nope' }], indexId: 9 }] },
    { ...json, indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] }] },
    { ...json, columns: [{ name: 'id', type: { type: 'int' }, nullable: false }] },
  ]
  for (const v of variants) assert.throws(() => decodeTableDef(new TextEncoder().encode(JSON.stringify(v))), (e: EngineError) => e.code === 'ENGINE_CORRUPT_CATALOG', JSON.stringify(v))
  assert.throws(() => decodeTableDef(Uint8Array.of(0xff, 0x7b)), (e: EngineError) => e.code === 'ENGINE_CORRUPT_CATALOG')
  for (let cut = 0; cut < bytes.length; cut += 7) assert.throws(() => decodeTableDef(bytes.subarray(0, cut)), (e: EngineError) => e.code === 'ENGINE_CORRUPT_CATALOG')
})

test('M5.8\'s ground: AUTO_INCREMENT values are never handed out twice — not after a rollback, not after a crash', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('s')
  catalog.createTable('s', { name: 'a', columns: [int('id', { autoIncrement: true }), varchar('v', 4)], indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] }] })
  const t = catalog.table('s', 'a')
  assert.equal(t.nextAutoIncrement(), 1n)
  const trx = store.begin()
  const n = t.nextAutoIncrement()
  t.insert([i32(Number(n)), utf8('x')], trx)
  trx.rollback()
  assert.equal(t.nextAutoIncrement(), 3n, 'a rolled-back insert does not give its value back')
  t.insert([i32(100), utf8('y')])
  assert.equal(t.nextAutoIncrement(), 101n, 'an explicit value moves the counter past it')
  // A failed insert's explicit value does not.
  refused(() => t.insert([i32(100), utf8('z')]), 'ER_DUP_ENTRY')
  store.sync()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  assert.equal(Catalog.open(reopened).table('s', 'a').nextAutoIncrement(), 102n)
})

test('TRUNCATE TABLE: the same definition, no rows, AUTO_INCREMENT from 1, and a store that verifies across a reopen', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('app')
  const before = catalog.createTable('app', { ...spec(), columns: [int('id', { autoIncrement: true }), varchar('v', 20), { name: 'b', type: { type: FIELD_TYPE.BLOB, collationId: 63 }, nullable: true }] })
  const t = catalog.table('app', 't')
  assert.equal(t.nextAutoIncrement(5), 1n)
  t.insert([i32(1), utf8('one'), null])
  const after = catalog.truncateTable('app', 't')
  assert.deepEqual(after.columns, before.columns)
  // The same indexes, on new trees: their ids are the only difference.
  const shape = (d: typeof before) => d.indexes.map(({ indexId: _id, ...rest }) => rest)
  assert.deepEqual(shape(after), shape(before))
  assert.notDeepEqual(after.indexes.map((i) => i.indexId), before.indexes.map((i) => i.indexId))
  const fresh2 = catalog.table('app', 't')
  assert.equal([...fresh2.scan()].length, 0)
  assert.equal(fresh2.nextAutoIncrement(), 1n)
  refused(() => catalog.truncateTable('app', 'nope'), 'ER_NO_SUCH_TABLE')
  verifyStore(store, catalog.verifyOptions())
  store.close()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  const again = Catalog.open(reopened)
  assert.deepEqual(again.definition('app', 't').columns, before.columns)
  verifyStore(reopened, again.verifyOptions())
})

test('ALTER by copy: every row mapped into the new definition, the counter kept, and a refused row leaving the old table whole', async () => {
  for (const engine of ['native', 'memory'] as const) {
    const { vfs, store, catalog } = await fresh()
    catalog.createSchema('app')
    catalog.createTable('app', { ...spec(), engine, columns: [int('id', { autoIncrement: true }), varchar('v', 20), { name: 'b', type: { type: FIELD_TYPE.BLOB, collationId: 63 }, nullable: true }], indexes: [{ name: 'PRIMARY', kind: 'primary', parts: [{ column: 'id' }] }] })
    const t = catalog.table('app', 't')
    t.insert([i32(1), utf8('one'), null])
    t.insert([i32(2), utf8('one'), null])
    assert.equal(t.nextAutoIncrement(10), 3n, 'values handed out and never used')
    const before = catalog.definition('app', 't')
    // A UNIQUE key the rows break: 1062, and nothing changed.
    refused(() => catalog.rebuildTable('app', 't', { ...before, indexes: [...before.indexes, { name: 'v', kind: 'unique', parts: [{ column: 'v' }] }] }, (row) => row), 'ER_DUP_ENTRY')
    assert.deepEqual(catalog.definition('app', 't'), before)
    assert.equal([...catalog.table('app', 't').scan()].length, 2)
    // A column added at the end, filled for every row.
    const after = catalog.rebuildTable('app', 't', { ...before, columns: [...before.columns, int('n', { nullable: true })], indexes: [...before.indexes, { name: 'v', kind: 'index', parts: [{ column: 'v' }] }] }, (row) => [...row, i32(7)])
    assert.deepEqual(after.indexes.map((i) => i.name), ['PRIMARY', 'v'])
    const rebuilt = catalog.table('app', 't')
    assert.deepEqual([...rebuilt.scan()].map(([, r]) => [decodeInt(r[0] as Uint8Array, false), decodeInt(r[3] as Uint8Array, false)]), [[1n, 7n], [2n, 7n]])
    assert.deepEqual([...rebuilt.indexScan('v')].length, 2)
    assert.equal(rebuilt.nextAutoIncrement(), 13n, 'the counter is the old table\'s, not one past its largest row')
    if (engine === 'memory') continue
    verifyStore(store, catalog.verifyOptions())
    store.close()
    const reopened = Store.open(...(await files(vfs)), { frames: 64 })
    const again = Catalog.open(reopened)
    assert.deepEqual(again.definition('app', 't').columns.map((c) => c.name), ['id', 'v', 'b', 'n'])
    verifyStore(reopened, again.verifyOptions())
  }
})

test('views: one namespace with tables, all-or-nothing DROP, dropped with their schema, and kept across a reopen', async () => {
  const { vfs, store, catalog } = await fresh()
  catalog.createSchema('app')
  catalog.createTable('app', spec())
  const v = { schema: 'app', name: 'v', query: 'SELECT a FROM t', columns: ['x'] }
  catalog.createView(v)
  assert.deepEqual(catalog.view('app', 'v'), v)
  assert.equal(catalog.view('app', 't'), undefined)
  // The names are shared: neither kind may take the other's (8.4.11: 1050), and OR REPLACE over a table is 1347.
  refused(() => catalog.createView({ ...v, name: 't' }), 'ER_TABLE_EXISTS_ERROR')
  refused(() => catalog.createTable('app', spec('v')), 'ER_TABLE_EXISTS_ERROR')
  refused(() => catalog.createView({ ...v, name: 't' }, { orReplace: true }), 'ER_WRONG_OBJECT')
  refused(() => catalog.createView({ ...v, schema: 'nope' }), 'ER_BAD_DB_ERROR')
  catalog.createView({ ...v, query: 'SELECT 1' }, { orReplace: true })
  assert.equal(catalog.view('app', 'v')?.query, 'SELECT 1')
  // A view is not a table to anything that reads tables.
  assert.deepEqual(catalog.tables('app').map((t) => t.name), ['t'])
  refused(() => catalog.definition('app', 'v'), 'ER_NO_SUCH_TABLE')
  refused(() => catalog.truncateTable('app', 'v'), 'ER_NO_SUCH_TABLE')
  assert.equal(catalog.dropTable('app', 'v', { ifExists: true }), false)
  // DROP VIEW checks every name before it drops any.
  refused(() => catalog.dropViews('app', ['v', 't']), 'ER_WRONG_OBJECT')
  refused(() => catalog.dropViews('app', ['v', 'n1', 'n2']), 'ER_BAD_TABLE_ERROR')
  assert.notEqual(catalog.view('app', 'v'), undefined)
  assert.deepEqual(catalog.dropViews('app', ['n1', 'v'], { ifExists: true }), ['n1'])
  assert.equal(catalog.view('app', 'v'), undefined)
  catalog.createView(v)
  verifyStore(store, catalog.verifyOptions())
  store.close()
  const reopened = Store.open(...(await files(vfs)), { frames: 64 })
  const again = Catalog.open(reopened)
  assert.deepEqual(again.views('app'), [v])
  assert.deepEqual(again.dropSchema('app').sort(), ['t', 'v'])
  verifyStore(reopened, again.verifyOptions())
})
