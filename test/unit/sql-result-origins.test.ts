import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { COLUMN_FLAG, FIELD_TYPE } from '@myjs/bytes'
import { MySQL } from '@myjs/core'
import { columnDefinition, columnResultType, decimalType, EMPTY_NAMES, type ResultType } from '../../packages/core/src/sql/meta.ts'

const headerKeys = ['schema', 'table', 'orgTable', 'orgName', 'name', 'characterSet', 'columnLength', 'type', 'flags', 'decimals'].sort()

test('source-backed headers keep their envelope and computed flags without mutating origin records', async () => {
  await loadCollation(255)
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE origin162')
    await db.query("CREATE TABLE origin162.a(id INT PRIMARY KEY,j JSON,e ENUM('x'),b BLOB)")
    const def = db.catalog!.table('origin162', 'a').def
    for (const column of def.columns) {
      const type = columnResultType(def, column, 'alias')
      assert.ok(type.column)
      const source = type.column
      assert.deepEqual(Object.keys(source).sort(), ['schema', 'table', 'orgTable', 'orgName', 'flags'].sort())
      const before = { ...source }
      Object.freeze(source)
      for (const temporary of [undefined, true, 'stream'] as const) {
        const header = columnDefinition('picked', { ...type, ...(temporary === undefined ? {} : { temporary }) }, 255)
        assert.deepEqual(Object.keys(header).sort(), headerKeys)
        assert.equal(header.schema, 'origin162')
        assert.equal(header.table, 'alias')
        assert.equal(header.orgName, column.name)
        assert.equal(header.name, 'picked')
      }
      const wire = { field: FIELD_TYPE.LONG, length: 11, flags: COLUMN_FLAG.NOT_NULL | COLUMN_FLAG.UNSIGNED, decimals: 0, text: false, streamed: [FIELD_TYPE.LONG, 12, COLUMN_FLAG.NOT_NULL | COLUMN_FLAG.BINARY, 0] as const }
      const captured = columnDefinition('picked', { ...type, wire, nullable: true }, 255)
      assert.deepEqual(Object.keys(captured).sort(), headerKeys)
      assert.equal(captured.flags, COLUMN_FLAG.UNSIGNED, 'captured flags override source flags, then lose NOT_NULL')
      assert.equal(captured.orgName, column.name)
      const copied = columnDefinition('picked', { ...type, wire, nullable: true, temporary: 'stream' }, 255)
      assert.deepEqual(Object.keys(copied).sort(), headerKeys)
      assert.equal(copied.flags, COLUMN_FLAG.BINARY)
      assert.equal(copied.orgName, 'picked')
      assert.deepEqual(source, before)
    }
  } finally { await db.end() }
})

test('explicit blank origins, absent origins and empty view schemas remain distinct', async () => {
  await loadCollation(255)
  const type: ResultType = { ...decimalType(16, 4, true), temporary: 'pinned' }
  assert.equal(columnDefinition('picked', type, 255).orgName, 'picked')
  assert.equal(columnDefinition('picked', { ...type, names: EMPTY_NAMES }, 255).orgName, '')
  const wire = { field: FIELD_TYPE.LONG, length: 11, flags: 0, decimals: 0, text: false, streamed: [FIELD_TYPE.LONG, 12, 0, 0] as const }
  assert.equal(columnDefinition('picked', { ...type, wire, temporary: 'stream' }, 255).orgName, '', 'a tuple alone does not supply an origin')
  assert.equal(columnDefinition('picked', { ...type, wire, names: EMPTY_NAMES, temporary: 'stream' }, 255).orgName, 'picked')
  const viewed = columnDefinition('picked', { ...type, names: { schema: 'raw', table: 'v', orgTable: 'base', orgName: 'vcol', viewSchema: '' } }, 255)
  assert.equal(viewed.schema, '')
  assert.equal(viewed.orgTable, '')
  assert.equal(viewed.orgName, 'vcol')
  assert.deepEqual(EMPTY_NAMES, { schema: '', table: '', orgTable: '', orgName: '' })
})
