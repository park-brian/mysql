// M5.13 — doc 42's introspection methods, each a query through the client.
// The expected answers are 8.4.11's, from the same DDL, captured by running
// these methods' own queries against the server through mysql2.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'

const DDL = [
  'CREATE DATABASE intro',
  "CREATE TABLE intro.users (id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT, email VARCHAR(191) NOT NULL UNIQUE, name VARCHAR(50) DEFAULT 'anon' COMMENT 'display', created DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3), role ENUM('a','b') NOT NULL DEFAULT 'a', score DECIMAL(10,2), KEY (name)) COMMENT 'people'",
  'CREATE TABLE intro.posts (id BIGINT PRIMARY KEY, user_id INT UNSIGNED, body TEXT, total INT AS (id * 2) VIRTUAL, FOREIGN KEY (user_id) REFERENCES intro.users (id))',
  'CREATE TABLE intro.cache (k CHAR(10) PRIMARY KEY) ENGINE=MEMORY',
  'CREATE VIEW intro.active AS SELECT id, email FROM intro.users WHERE id > 0',
]

const col = (name: string, position: number, type: string, nullable: boolean, def: string | null, key: string, extra: string, collation: string | null, comment = '') => ({ name, position, type, nullable, default: def, key, extra, collation, comment })
const UCA = 'utf8mb4_0900_ai_ci'

test("schemas(), tables() and columns() answer what 8.4.11's INFORMATION_SCHEMA does", async () => {
  const db = await MySQL.open(':memory:')
  try {
    for (const sql of DDL) await db.query(sql)
    assert.ok((await db.schemas()).includes('intro'))
    assert.deepEqual(await db.tables('intro'), [
      { name: 'active', type: 'VIEW', engine: null, collation: null, comment: 'VIEW' },
      { name: 'cache', type: 'BASE TABLE', engine: 'MEMORY', collation: UCA, comment: '' },
      { name: 'posts', type: 'BASE TABLE', engine: 'InnoDB', collation: UCA, comment: '' },
      { name: 'users', type: 'BASE TABLE', engine: 'InnoDB', collation: UCA, comment: 'people' },
    ])
    assert.deepEqual(await db.columns('intro', 'users'), [
      col('id', 1, 'int unsigned', false, null, 'PRI', 'auto_increment', null),
      col('email', 2, 'varchar(191)', false, null, 'UNI', '', UCA),
      col('name', 3, 'varchar(50)', true, 'anon', 'MUL', '', UCA, 'display'),
      col('created', 4, 'datetime(3)', true, 'CURRENT_TIMESTAMP(3)', '', 'DEFAULT_GENERATED', null),
      col('role', 5, "enum('a','b')", false, 'a', '', '', UCA),
      col('score', 6, 'decimal(10,2)', true, null, '', '', null),
    ])
    assert.deepEqual(await db.columns('intro', 'posts'), [
      col('id', 1, 'bigint', false, null, 'PRI', '', null),
      col('user_id', 2, 'int unsigned', true, null, 'MUL', '', null),
      col('body', 3, 'text', true, null, '', '', UCA),
      col('total', 4, 'int', true, null, '', 'VIRTUAL GENERATED', null),
    ])
    // A view's columns: no key, and the default its source column's type gives.
    assert.deepEqual(await db.columns('intro', 'active'), [col('id', 1, 'int unsigned', false, '0', '', '', null), col('email', 2, 'varchar(191)', false, null, '', '', UCA)])
  } finally {
    await db.end()
  }
})

test('explain() is the plan EXPLAIN FORMAT=TREE prints, its skeleton the same as 8.4.11', async () => {
  const db = await MySQL.open(':memory:')
  try {
    for (const sql of DDL) await db.query(sql)
    // 8.4.11: "-> Index lookup on users using name (name='x')  (cost=0.35 rows=1)", whose skeleton this is (M5.44).
    assert.equal(await db.explain('SELECT email FROM intro.users WHERE name = ?', ['x']), '-> Index lookup on users using name\n')
  } finally {
    await db.end()
  }
})

test("stats() reads the buffer pool, the history list and the server's counters through SQL", async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE s')
    await db.query('CREATE TABLE s.t (a INT PRIMARY KEY)')
    await db.query('INSERT INTO s.t VALUES (1), (2), (3)')
    const stats = await db.stats()
    assert.equal(stats.pageSize, 16384)
    assert.ok(stats.bufferPool.pages > 0 && stats.bufferPool.dataPages > 0)
    assert.equal(stats.bufferPool.dataPages + stats.bufferPool.freePages, stats.bufferPool.pages)
    assert.ok(stats.bufferPool.readRequests > 0)
    assert.ok(stats.historyLength >= 0)
    assert.ok(stats.questions >= 3, 'the statements above, and its own two')
    assert.equal(stats.connections, 1, "query()'s one connection")
  } finally {
    await db.end()
  }
})
