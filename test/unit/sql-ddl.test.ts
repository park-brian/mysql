// M5.9 — CREATE TABLE's resolution and its refusals, each as a real 8.4.11
// gives it, and the regression the executor fuzzer found on its first run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { Catalog, Store } from '@myjs/engine'
import { parseStatement, type CreateTableNode } from '@myjs/parser'
import { MemoryVfs } from '@myjs/vfs'
import { createTableSpec } from '../../packages/core/src/sql/ddl.ts'

const spec = (sql: string, schemaCollation = 255) => createTableSpec(parseStatement(sql) as CreateTableNode, schemaCollation)
const errno = (fn: () => unknown): number | undefined => {
  try {
    fn()
  } catch (e) {
    return (e as MyjsError).errno
  }
  return undefined
}

test('M5.9: a string column inherits its collation from the table, then the schema, then the server', () => {
  const t = spec('CREATE TABLE t (a VARCHAR(5), b VARCHAR(5) CHARACTER SET latin1, c VARCHAR(5) COLLATE utf8mb4_bin, d VARCHAR(5) BINARY, e TEXT, f VARBINARY(4)) DEFAULT CHARSET=latin1')
  const ids = t.columns.map((c) => c.type.collationId)
  // latin1_swedish_ci (8) is the table's; latin1_bin (47) is `BINARY` on it.
  assert.deepEqual(ids, [8, 8, 46, 47, 8, 63])
  assert.equal(spec('CREATE TABLE t (a CHAR(2))', 46).columns[0]?.type.collationId, 46)
  assert.equal(spec('CREATE TABLE t (a CHAR(2))').columns[0]?.type.collationId, 255)
  // CHARACTER SET binary turns text into bytes.
  assert.deepEqual(spec('CREATE TABLE t (a VARCHAR(3) CHARACTER SET binary)').columns[0]?.type, { type: FIELD_TYPE.VAR_STRING, length: 3, collationId: 63 })
})

test('M5.9: keys — a primary key is NOT NULL, an unnamed index takes its column name, SERIAL is a unique BIGINT UNSIGNED', () => {
  const t = spec('CREATE TABLE t (a INT, b INT UNIQUE, c SERIAL, KEY (a), KEY (a, b), PRIMARY KEY (a))')
  assert.equal(t.columns[0]?.nullable, false)
  assert.deepEqual(
    t.indexes?.map((i) => [i.name, i.kind]),
    [
      ['PRIMARY', 'primary'],
      ['a', 'index'],
      ['a_2', 'index'],
      ['b', 'unique'],
      ['c', 'unique'],
    ],
  )
  assert.deepEqual(t.columns[2]?.type, { type: FIELD_TYPE.LONGLONG, unsigned: true })
  assert.equal(t.columns[2]?.autoIncrement, true)
})

test('M5.9: the refusals, with 8.4.11s numbers', () => {
  assert.equal(errno(() => spec('CREATE TABLE t (b VARCHAR(99999999999))')), 1439)
  assert.equal(errno(() => spec('CREATE TABLE t (b VARCHAR(70000))')), 1074)
  assert.equal(errno(() => spec('CREATE TABLE t (b CHAR(256))')), 1074)
  assert.equal(errno(() => spec('CREATE TABLE t (b VARBINARY(70000))')), 1074)
  assert.equal(errno(() => spec('CREATE TABLE t (b DECIMAL(66,2))')), 1426)
  assert.equal(errno(() => spec('CREATE TABLE t (b INT(300))')), 1439)
  assert.equal(errno(() => spec('CREATE TABLE t (a INT, a INT)')), 1060)
  assert.equal(errno(() => spec('CREATE TABLE t (a INT PRIMARY KEY, b INT PRIMARY KEY)')), 1068)
  assert.equal(errno(() => spec('CREATE TABLE t (a INT) ENGINE=nosuch')), 1286)
  // A divergence, not a fact: 8.4.11 has ARCHIVE and we do not (D-24), so we
  // answer as a server built without it does under NO_ENGINE_SUBSTITUTION.
  assert.equal(errno(() => spec('CREATE TABLE t (a INT) ENGINE=ARCHIVE')), 1286)
  // A CHECK we would not enforce is refused rather than accepted (M8.7).
  assert.equal(errno(() => spec('CREATE TABLE t (a INT CHECK (a > 0))')), 1235)
})

test('M5.9: the catalog never stores a definition it cannot read back (the executor fuzzer)', async () => {
  // Before the fix, a type length past 2^53 passed CREATE TABLE and was
  // stored, and every later statement on the table was "corrupt catalog".
  const vfs = new MemoryVfs()
  const store = Store.create(await vfs.open('d', { create: true }), await vfs.open('l', { create: true }))
  const catalog = Catalog.open(store)
  catalog.createSchema('s')
  const bad = { name: 't', columns: [{ name: 'b', type: { type: FIELD_TYPE.VAR_STRING, length: 2 ** 64, collationId: 255 }, nullable: true }] }
  assert.equal(errno(() => catalog.createTable('s', bad)), 1063)
  assert.deepEqual(catalog.tables('s'), [])
  store.close()
})
