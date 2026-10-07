// M3.6 — SET, USE, SHOW, EXPLAIN/DESCRIBE, transaction control, prepared
// statements and DO.
//
// Every refusal and every "these two are one tree" below was put to a real
// 8.4.11 before it was written down. The ones that matter most are the ones a
// reading of the manual gets wrong: a scope keyword is sticky across a `SET`
// list while `@@scope.` is not, and `SET NAMES` may sit anywhere in a list but
// never after a scope keyword.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NODE,
  ParseError,
  STATEMENT,
  deparse,
  parseStatement,
  type DoNode,
  type ExplainNode,
  type SetItem,
  type SetNode,
  type ShowNode,
} from '@myjs/parser'
import { roundTrip, withoutPositions } from '../../tools/lib/round-trip.mjs'

const parse = (sql: string) => {
  const node = parseStatement(sql)
  // Every statement here must survive the deparser, which is what the census
  // checks at corpus scale.
  assert.equal(roundTrip(node), null, `${sql}\n${deparse(node)}`)
  return node
}
const items = (sql: string): readonly SetItem[] => {
  const node = parse(sql)
  assert.equal(node.kind, STATEMENT.SET, sql)
  return (node as SetNode).items
}
const show = (sql: string): ShowNode => {
  const node = parse(sql)
  assert.equal(node.kind, STATEMENT.SHOW, sql)
  return node as ShowNode
}
const same = (a: string, b: string) => assert.deepEqual(withoutPositions(parse(a)), withoutPositions(parse(b)), `${a}\n${b}`)
const refused = (...sqls: string[]) => {
  for (const sql of sqls) assert.throws(() => parseStatement(sql), ParseError, sql)
}
/** Each item's target, as `scope:name` — `-` for no scope, `@` for a user variable. */
const targets = (sql: string) =>
  items(sql).map((i) => (i.type === 'user' ? `@${i.name}` : i.type === 'system' ? `${i.scope ?? '-'}:${i.name}` : i.type === 'name' ? `bare:${i.name}` : i.type))

test('M3.6: a scope keyword is sticky across a SET list, and @@scope. is not', () => {
  // On 8.4.11, `SET GLOBAL max_connections = 200, sort_buffer_size = 1000000`
  // changes the global sort_buffer_size and leaves the session's alone.
  assert.deepEqual(targets('SET GLOBAL a = 1, b = 2'), ['GLOBAL:a', 'GLOBAL:b'])
  // `@@b` does not inherit; neither does anything after `@@global.a`.
  assert.deepEqual(targets('SET GLOBAL a = 1, @@b = 2'), ['GLOBAL:a', '-:b'])
  assert.deepEqual(targets('SET @@global.a = 1, b = 2'), ['GLOBAL:a', 'bare:b'])
  assert.deepEqual(targets('SET a = 1, SESSION b = 2, c = 3'), ['bare:a', 'SESSION:b', 'SESSION:c'])
  // The deparser writes `@@global.b`, never `GLOBAL b`, so a later bare name
  // cannot pick up a scope it did not have.
  assert.equal(deparse(parseStatement('SET @@global.a = 1, b = 2')), 'SET @@global.a = 1, `b` = 2')
})

test('M3.6: the spellings of a system variable are one tree', () => {
  same('SET GLOBAL sql_mode = 1', 'SET @@global.sql_mode = 1')
  same('SET @@GLOBAL . sql_mode = 1', 'SET @@global.sql_mode = 1')
  same('SET LOCAL sql_mode = 1', 'SET @@session.sql_mode = 1')
  same('SET @@local.sql_mode = 1', 'SET SESSION sql_mode = 1')
  same('SET @@session.`sql_mode` = 1', 'SET @@session.sql_mode = 1')
  same('SET @a := 1', 'SET @a = 1')
  same('SET PERSIST_ONLY a = 1', 'SET @@persist_only.a = 1')
  // A two-part name: a key cache, or a component's variable.
  const [cache] = items('SET @@global.default.key_buffer_size = 1')
  assert.deepEqual(cache, { type: 'system', scope: 'GLOBAL', base: 'default', name: 'key_buffer_size', value: cache?.type === 'system' ? cache.value : null })
  same('SET GLOBAL default.key_buffer_size = 1', 'SET @@global.default.key_buffer_size = 1')
})

test('M3.6: DEFAULT, ON and their siblings are keywords only for a system variable', () => {
  for (const word of ['DEFAULT', 'ON', 'ALL', 'BINARY', 'ROW', 'SYSTEM']) {
    const [item] = items(`SET sql_safe_updates = ${word}`)
    assert.equal(item?.type === 'name' ? item.value.kind : null, NODE.KEYWORD, word)
  }
  // …and only where the item ends: these are expressions.
  const [binary] = items("SET @@x = BINARY 'a'")
  assert.equal(binary?.type === 'system' ? binary.value.kind : null, NODE.UNARY)
  // `SET @a = ON` and `SET @a = DEFAULT` are ER_PARSE_ERROR on 8.4.11.
  refused('SET @a = ON', 'SET @a = DEFAULT')
  // A bare word is an expression that names a value: `SET sql_mode = ANSI`.
  const [ansi] = items('SET sql_mode = ANSI')
  assert.equal(ansi?.type === 'name' ? ansi.value.kind : null, NODE.COLUMN)
})

test('M3.6: SET NAMES and SET CHARACTER SET, anywhere in a list but never scoped', () => {
  assert.deepEqual(items("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_bin'"), [{ type: 'names', charset: 'utf8mb4', collation: 'utf8mb4_bin' }])
  same('SET NAMES utf8mb4 COLLATE utf8mb4_bin', "SET NAMES 'utf8mb4' COLLATE 'utf8mb4_bin'")
  assert.deepEqual(items('SET NAMES DEFAULT'), [{ type: 'names' }])
  assert.deepEqual(items('SET NAMES BINARY'), [{ type: 'names', charset: 'binary' }])
  same('SET CHARSET latin1', 'SET CHARACTER SET latin1')
  assert.deepEqual(items('SET CHARACTER SET DEFAULT'), [{ type: 'charset' }])
  assert.deepEqual(targets('SET @a = 1, NAMES latin1, @b = 2'), ['@a', 'names', '@b'])
  refused('SET GLOBAL NAMES utf8mb4', 'SET SESSION NAMES utf8mb4', 'SET NAMES = utf8mb4', 'SET NAMES utf8mb4 COLLATE DEFAULT')
})

test('M3.6: SET TRANSACTION stands alone, with each characteristic once', () => {
  assert.deepEqual(withoutPositions(parse('SET PERSIST TRANSACTION READ ONLY, ISOLATION LEVEL READ COMMITTED')), {
    kind: STATEMENT.SET_TRANSACTION,
    scope: 'PERSIST',
    isolation: 'READ COMMITTED',
    access: 'READ ONLY',
  })
  same('SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE', 'SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  same('SET TRANSACTION READ WRITE, ISOLATION LEVEL READ UNCOMMITTED', 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED, READ WRITE')
  refused(
    'SET TRANSACTION READ ONLY, READ WRITE',
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED, ISOLATION LEVEL SERIALIZABLE',
    'SET TRANSACTION ISOLATION LEVEL READ COMMITTED, @a = 1',
    'SET @a = 1, TRANSACTION READ ONLY',
  )
})

test('M3.6: the SET statements that are not assignments are named, not misparsed', () => {
  for (const sql of ["SET PASSWORD = 'x'", 'SET ROLE r', 'SET DEFAULT ROLE r TO u', 'SET RESOURCE GROUP g']) {
    assert.throws(() => parseStatement(sql), (e: ParseError) => e.code === 'ER_NOT_SUPPORTED_YET', sql)
  }
})

test('M3.6: USE, DO, and the transaction statements', () => {
  assert.deepEqual(withoutPositions(parse('USE `test`')), { kind: STATEMENT.USE, database: 'test' })
  refused("USE 'test'", 'USE test extra')
  assert.equal((parse('DO 1, 2, @a := 3') as DoNode).exprs.length, 3)
  refused('DO')

  same('BEGIN WORK', 'START TRANSACTION')
  same('START TRANSACTION READ ONLY, READ ONLY', 'START TRANSACTION READ ONLY')
  same('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
  refused('START TRANSACTION READ ONLY, READ WRITE', 'BEGIN READ ONLY')

  // `chain` and `release` are tri-state: absent leaves it to completion_type.
  assert.deepEqual(withoutPositions(parse('COMMIT WORK')), { kind: STATEMENT.COMMIT })
  assert.deepEqual(withoutPositions(parse('COMMIT AND NO CHAIN NO RELEASE')), { kind: STATEMENT.COMMIT, chain: false, release: false })
  assert.deepEqual(withoutPositions(parse('ROLLBACK AND CHAIN')), { kind: STATEMENT.ROLLBACK, chain: true })
  same('ROLLBACK WORK TO SAVEPOINT sp', 'ROLLBACK TO sp')
  same('RELEASE SAVEPOINT sp', 'RELEASE SAVEPOINT `sp`')
  parse('SAVEPOINT `select`')
  refused('COMMIT AND CHAIN RELEASE', 'ROLLBACK TO SAVEPOINT sp AND CHAIN', 'RELEASE sp', 'SAVEPOINT select')
})

test('M3.6: PREPARE takes one string or one user variable; EXECUTE passes user variables', () => {
  assert.deepEqual(withoutPositions(parse('PREPARE s FROM "SELECT 2"')), { kind: STATEMENT.PREPARE, name: 's', text: 'SELECT 2' })
  assert.deepEqual(withoutPositions(parse('PREPARE s FROM @q')), { kind: STATEMENT.PREPARE, name: 's', variable: 'q' })
  assert.deepEqual(withoutPositions(parse('EXECUTE s USING @a, @`b c`')), { kind: STATEMENT.EXECUTE, name: 's', using: ['a', 'b c'] })
  same('DROP PREPARE s', 'DEALLOCATE PREPARE s')
  refused(
    "PREPARE s FROM 'SELECT ' 'a'",
    "PREPARE s FROM _utf8mb4'SELECT 1'",
    "PREPARE s FROM CONCAT('SELECT', ' 1')",
    'PREPARE s FROM @@sql_mode',
    "PREPARE select FROM 'SELECT 1'",
    'EXECUTE s USING 1',
  )
})

test('M3.6: EXPLAIN, DESCRIBE and DESC are one statement, with options in one order', () => {
  same('DESC SELECT 1', 'EXPLAIN SELECT 1')
  same("EXPLAIN FORMAT='TREE' SELECT 1", 'DESCRIBE FORMAT = tree SELECT 1')
  same('EXPLAIN FOR DATABASE test SELECT 1', 'EXPLAIN FOR SCHEMA test SELECT 1')
  const full = parse("EXPLAIN FORMAT=JSON INTO @j FOR SCHEMA test WITH c AS (SELECT 1) DELETE FROM t WHERE a IN (SELECT * FROM c)") as ExplainNode
  assert.equal(full.format, 'JSON')
  assert.equal(full.into, 'j')
  assert.equal(full.schema, 'test')
  assert.equal(full.statement?.kind, STATEMENT.DELETE)
  for (const sql of ['EXPLAIN ANALYZE INSERT INTO t VALUES (1)', 'EXPLAIN REPLACE INTO t VALUES (1)', 'EXPLAIN TABLE t', 'EXPLAIN VALUES ROW(1)', 'EXPLAIN (SELECT 1) UNION (SELECT 2)', 'EXPLAIN SELECT 1 INTO @x']) {
    assert.equal(parse(sql).kind, STATEMENT.EXPLAIN, sql)
  }
  assert.equal((parse('EXPLAIN FOR CONNECTION 18446744073709551615') as ExplainNode).connection, 18446744073709551615n)
  // Accepted here and refused by the server *after* parsing — ER 6006, 6007
  // and 1235 rather than 1064 — so they are not the parser's to refuse.
  parse('EXPLAIN INTO @j SELECT 1')
  parse('EXPLAIN ANALYZE FORMAT=JSON SELECT 1')
  refused(
    'EXPLAIN FORMAT=JSON ANALYZE SELECT 1',
    'EXPLAIN FOR SCHEMA test FORMAT=TREE SELECT 1',
    'EXPLAIN FOR SCHEMA test INTO @j SELECT 1',
    'EXPLAIN ANALYZE FORMAT=TREE INTO @j SELECT 1',
    'EXPLAIN FORMAT=TREE t',
    'EXPLAIN FOR SCHEMA test FOR CONNECTION 5',
    'EXPLAIN EXTENDED SELECT 1',
    'EXPLAIN DO 1',
  )
})

test('M3.6: DESCRIBE a table, whose column is a pattern however it is written', () => {
  assert.deepEqual(withoutPositions(parse('DESC test.t1')), { kind: STATEMENT.DESCRIBE, table: { schema: 'test', name: 't1' } })
  same('DESCRIBE t1 b', "EXPLAIN t1 'b'")
  same('DESCRIBE t1 `b`', 'DESC t1 b')
  // `format` is not reserved, so without `=` it is a table.
  assert.equal(parse('EXPLAIN format').kind, STATEMENT.DESCRIBE)
  refused('DESCRIBE t1 a b')
})

test('M3.6: SHOW forms, and the synonyms that are one tree', () => {
  same('SHOW FIELDS FROM t1', 'SHOW COLUMNS IN t1')
  same('SHOW KEYS IN t1', 'SHOW INDEX FROM t1')
  same('SHOW INDEXES FROM t1', 'SHOW INDEX FROM t1')
  same('SHOW SCHEMAS', 'SHOW DATABASES')
  same('SHOW CHARSET', 'SHOW CHARACTER SET')
  same('SHOW STORAGE ENGINES', 'SHOW ENGINES')
  same('SHOW CREATE SCHEMA d', 'SHOW CREATE DATABASE d')
  same('SHOW LOCAL STATUS', 'SHOW SESSION STATUS')
  // `FROM t FROM db` is `FROM db.t`, and the second `FROM` wins when both name
  // a schema: on 8.4.11, `SHOW COLUMNS FROM mysql.t1 FROM test` lists test.t1.
  same('SHOW COLUMNS FROM t1 FROM test', 'SHOW COLUMNS FROM test.t1')
  same('SHOW COLUMNS FROM mysql.t1 FROM test', 'SHOW COLUMNS FROM test.t1')

  assert.deepEqual(withoutPositions(show("SHOW EXTENDED FULL TABLES IN test LIKE 't%'")), {
    kind: STATEMENT.SHOW,
    what: 'TABLES',
    full: true,
    extended: true,
    database: 'test',
    like: 't%',
  })
  assert.equal(show("SHOW GLOBAL VARIABLES WHERE Variable_name = 'sql_mode'").scope, 'GLOBAL')
  assert.equal(show('SHOW CREATE DATABASE IF NOT EXISTS test').ifNotExists, true)
  assert.deepEqual(show("SHOW GRANTS FOR 'root'@'%'").user, { user: 'root', host: '%' })
  assert.equal(show('SHOW GRANTS FOR CURRENT_USER()').user, 'CURRENT_USER')
  assert.deepEqual(show('SHOW CREATE USER root@localhost').user, { user: 'root', host: 'localhost' })
  same('SHOW WARNINGS LIMIT 1, 2', 'SHOW WARNINGS LIMIT 2 OFFSET 1')
  assert.deepEqual(withoutPositions(show('SHOW COUNT( * ) ERRORS')), { kind: STATEMENT.SHOW, what: 'ERRORS', count: true })
  for (const sql of ['SHOW BINARY LOGS', 'SHOW BINARY LOG STATUS', 'SHOW FULL PROCESSLIST', 'SHOW PRIVILEGES', 'SHOW PLUGINS', 'SHOW OPEN TABLES FROM test', 'SHOW FUNCTION STATUS WHERE 1', 'SHOW TABLE STATUS LIKE "t%"']) {
    show(sql)
  }
  // Each of these is ER_PARSE_ERROR on 8.4.11. `SHOW MASTER STATUS` was
  // removed in 8.4, and `SHOW PERSIST VARIABLES` was never a form.
  refused(
    'SHOW FULL EXTENDED TABLES',
    'SHOW TABLES FROM test FROM test',
    "SHOW INDEXES FROM t1 LIKE 'x'",
    'SHOW CREATE TABLE IF NOT EXISTS t1',
    'SHOW PERSIST VARIABLES',
    "SHOW ENGINES LIKE 'x'",
    "SHOW TABLES LIKE 't%' WHERE 1",
    'SHOW WARNINGS WHERE 1',
    'SHOW FULL VARIABLES',
  )
  assert.throws(() => parseStatement('SHOW MASTER STATUS'), (e: ParseError) => e.code === 'ER_NOT_SUPPORTED_YET')
})

test('M3.6: FORCE INDEX () and IGNORE INDEX () are refused; USE INDEX () is not', () => {
  // Found by the census once EXPLAIN parsed: `group_by.test` asserts the two
  // refusals under `EXPLAIN`, so they were invisible while EXPLAIN was not.
  parse('SELECT a FROM t1 USE INDEX ()')
  parse('SELECT a FROM t1 USE KEY FOR JOIN ()')
  refused('SELECT a FROM t1 FORCE INDEX ()', 'SELECT a FROM t1 IGNORE KEY FOR GROUP BY ()')
})

test('review: a system variable whose base needs quoting round-trips', () => {
  parse('SET GLOBAL `a b`.x = 1')
  parse('SET @@global.`my base`.x = 1')
  same('SET @@global.`my base`.x = 1', 'SET GLOBAL `my base`.x = 1')
})
