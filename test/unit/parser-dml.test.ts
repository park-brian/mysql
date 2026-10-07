// M3.4 — INSERT, REPLACE, UPDATE, DELETE.
//
// Almost all of it is M3.3's grammar reused; what is here is the clause order
// each statement fixes and the facts a real 8.4 settled when probed: `UPDATE`
// and `DELETE` take `LIMIT n` and nothing else, an `INSERT` column list may be
// qualified, and `WITH` opens an `UPDATE` or a `DELETE` as it opens a query.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE, ParseError, STATEMENT, parseStatement, type DeleteNode, type InsertNode, type UpdateNode } from '@myjs/parser'
import { withoutPositions } from '../../tools/lib/round-trip.mjs'

const insert = (sql: string): InsertNode => {
  const node = parseStatement(sql)
  assert.equal(node.kind, STATEMENT.INSERT, sql)
  return node as InsertNode
}
const update = (sql: string): UpdateNode => {
  const node = parseStatement(sql)
  assert.equal(node.kind, STATEMENT.UPDATE, sql)
  return node as UpdateNode
}
const del = (sql: string): DeleteNode => {
  const node = parseStatement(sql)
  assert.equal(node.kind, STATEMENT.DELETE, sql)
  return node as DeleteNode
}
const same = (a: string, b: string) => assert.deepEqual(withoutPositions(parseStatement(a)), withoutPositions(parseStatement(b)), `${a}\n${b}`)

test('M3.4: the spellings of a row list are one shape', () => {
  same('INSERT INTO t VALUES (1, 2), (3, 4)', 'INSERT t VALUE (1, 2), (3, 4)')
  same('INSERT INTO t VALUES (1, 2)', 'INSERT INTO t VALUES ROW(1, 2)')
  assert.deepEqual(insert('INSERT INTO t () VALUES ()').values, [[]])
  assert.deepEqual(insert('INSERT INTO t () VALUES ()').columns, [])
  // `DEFAULT` in a row is the keyword; `DEFAULT(b)` is the function.
  const [row] = insert('INSERT INTO t VALUES (DEFAULT, DEFAULT(b))').values ?? []
  assert.equal(row?.[0]?.kind, NODE.KEYWORD)
  assert.equal(row?.[1]?.kind, NODE.CALL)
})

test('M3.4: INSERT from a query, a SET list, or TABLE', () => {
  for (const sql of ['INSERT INTO t SELECT * FROM u', 'INSERT INTO t (a) (SELECT 1)', 'INSERT INTO t TABLE u', 'INSERT INTO t WITH c AS (SELECT 1) SELECT * FROM c']) {
    assert.equal(insert(sql).query?.kind, 'query', sql)
  }
  assert.equal(insert('INSERT INTO t SET a = 1, b = DEFAULT').set?.length, 2)
  // A column list may be qualified (probed against 8.4.11).
  assert.deepEqual(insert('INSERT INTO t (t.a, b) VALUES (1, 2)').columns?.map((c) => c.parts), [['t', 'a'], ['b']])
})

test('M3.4: ON DUPLICATE KEY UPDATE and the row alias it may name', () => {
  const node = insert('INSERT INTO t VALUES (1, 2) AS new (x, y) ON DUPLICATE KEY UPDATE b = new.y + VALUES(b)')
  assert.deepEqual(node.rowAlias, { name: 'new', columns: ['x', 'y'] })
  assert.equal(node.onDuplicate?.length, 1)
  assert.equal(insert('INSERT INTO t SELECT 1 FROM u ON DUPLICATE KEY UPDATE b = 1').onDuplicate?.length, 1)
  // `REPLACE` has no duplicate clause — a duplicate *is* what it handles.
  assert.throws(() => parseStatement('REPLACE INTO t VALUES (1) ON DUPLICATE KEY UPDATE b = 1'), ParseError)
  assert.equal(insert('REPLACE LOW_PRIORITY INTO t (a) VALUES (1)').replace, true)
  assert.equal(insert('INSERT HIGH_PRIORITY IGNORE INTO t VALUES (1)').ignore, true)
})

test('M3.4: UPDATE and DELETE take LIMIT n, never an offset', () => {
  assert.equal(update('UPDATE t SET b = 1 WHERE a = 1 ORDER BY a LIMIT 1').limit?.kind, NODE.LITERAL)
  assert.equal(del('DELETE FROM t ORDER BY a DESC LIMIT ?').limit?.kind, NODE.PLACEHOLDER)
  for (const sql of ['UPDATE t SET a = 1 LIMIT 1, 2', 'UPDATE t SET a = 1 LIMIT 1 OFFSET 0', 'DELETE FROM t LIMIT 1, 2']) {
    assert.throws(() => parseStatement(sql), ParseError, sql)
  }
})

test('M3.4: multi-table UPDATE is table references', () => {
  const node = update('UPDATE LOW_PRIORITY IGNORE t JOIN u USING (a), (SELECT 1 AS a) d SET t.b = u.b, c := DEFAULT')
  assert.equal(node.tables.length, 2)
  assert.equal(node.tables[0]?.kind, 'join')
  assert.equal(node.set[1]?.value.kind, NODE.KEYWORD)
})

test('M3.4: DELETE’s two multi-table spellings are one statement', () => {
  same('DELETE t1, t2.* FROM t1 JOIN t2 ON t1.a = t2.a', 'DELETE FROM t1, t2 USING t1 JOIN t2 ON t1.a = t2.a')
  const single = del('DELETE LOW_PRIORITY QUICK IGNORE FROM db.t AS x PARTITION (p0) WHERE x.a = 1')
  assert.equal(single.targets, undefined)
  assert.deepEqual(single.tables.map((t) => t.kind === 'table' && [t.table.schema, t.table.name, t.alias, t.partitions]), [['db', 't', 'x', ['p0']]])
  // A derived table cannot be deleted from (derived.test, `-- error 1064`).
  assert.throws(() => parseStatement('DELETE FROM (SELECT * FROM t1)'), ParseError)
})

test('M3.4: WITH opens an UPDATE or a DELETE as well as a query', () => {
  assert.equal(update('WITH c AS (SELECT 1 AS a) UPDATE t JOIN c USING (a) SET t.b = 3').with?.tables.length, 1)
  assert.equal(del('WITH c AS (SELECT 1 AS a) DELETE t FROM t JOIN c USING (a)').with?.tables.length, 1)
  assert.equal(parseStatement('WITH c AS (SELECT 1) SELECT * FROM c').kind, STATEMENT.QUERY)
})
