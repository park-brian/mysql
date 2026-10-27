import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('DDL preloads lazy schema, table and column collations before their first write', () => {
  // Each declaration starts with a cold UCA 4.0 cache in its own process.
  const source = `
    import assert from 'node:assert/strict'
    import mysql from 'mysql2/promise'
    import { MySQL } from '@myjs/core'
    import { collationAvailability } from '@myjs/charsets'
    const scope = process.argv[1]
    const db = await MySQL.open(':memory:')
    const c = await mysql.createConnection({stream:db.createStream(),user:'root',rowsAsArray:true})
    try {
      assert.equal(collationAvailability(224),'loadable')
      await c.query('CREATE DATABASE preload_d' + (scope==='schema'?' COLLATE utf8mb4_unicode_ci':''))
      await c.query('CREATE TABLE preload_d.t(v VARCHAR(4)' + (scope==='column'?' COLLATE utf8mb4_unicode_ci':'') + ' UNIQUE)' + (scope==='table'?' COLLATE utf8mb4_unicode_ci':''))
      assert.equal(collationAvailability(224),'resident')
      await c.query("INSERT INTO preload_d.t VALUES('b'),('a')")
      assert.deepEqual((await c.query('SELECT v,COLLATION(v) FROM preload_d.t ORDER BY v'))[0],[['a','utf8mb4_unicode_ci'],['b','utf8mb4_unicode_ci']])
      await assert.rejects(c.query("INSERT INTO preload_d.t VALUES('A')"),{errno:1062})
    } finally { await c.end(); await db.end() }
  `
  for (const scope of ['schema', 'table', 'column']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, scope], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' })
    assert.equal(result.status, 0, scope + '\n' + result.stdout + result.stderr)
  }
})
