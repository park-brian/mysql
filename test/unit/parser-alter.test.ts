// M3.5's second half — ALTER TABLE, CREATE INDEX, CREATE DATABASE and
// PARTITION BY.
//
// Each refusal below is ER_PARSE_ERROR on a real 8.4.11, and each acceptance
// is SQL that server ran. The surprises are in the comments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError, STATEMENT, deparse, parseStatement, type AlterTableNode, type CreateTableNode } from '@myjs/parser'
import { roundTrip, withoutPositions } from '../../tools/lib/round-trip.mjs'

const parse = (sql: string) => {
  const node = parseStatement(sql)
  assert.equal(roundTrip(node), null, `${sql}\n${deparse(node)}`)
  return node
}
const alter = (sql: string): AlterTableNode => {
  const node = parse(sql)
  assert.equal(node.kind, STATEMENT.ALTER_TABLE, sql)
  return node as AlterTableNode
}
const actions = (sql: string) => alter(sql).actions.map((a) => a.type)
const same = (a: string, b: string) => assert.deepEqual(withoutPositions(parse(a)), withoutPositions(parse(b)), `${a}\n${b}`)
const refused = (...sqls: string[]) => {
  for (const sql of sqls) assert.throws(() => parseStatement(sql), (e: ParseError) => e.code === 'ER_PARSE_ERROR', sql)
}

test('M3.5: an ALTER TABLE is a list of actions, and may be empty', () => {
  assert.deepEqual(actions('ALTER TABLE a'), [])
  assert.deepEqual(actions('ALTER TABLE a ADD p INT FIRST, ADD q INT AFTER x, DROP y, DROP COLUMN z'), ['addColumn', 'addColumn', 'drop', 'drop'])
  assert.deepEqual(alter('ALTER TABLE a ADD q INT AFTER x').actions[0], {
    type: 'addColumn',
    column: (alter('ALTER TABLE a ADD q INT AFTER x').actions[0] as { column: unknown }).column,
    position: { after: 'x' },
  })
  // `ADD (…)` takes any table element, not only columns.
  assert.deepEqual(actions('ALTER TABLE a ADD (p INT, INDEX (p), CHECK (p > 0))'), ['addColumn', 'addKey', 'addCheck'])
  refused('ALTER TABLE a DROP y,', 'ALTER TABLE a, DROP y')
})

test('M3.5: the spellings of one change are one action', () => {
  same('ALTER TABLE a MODIFY y BIGINT FIRST', 'ALTER TABLE a CHANGE COLUMN y y BIGINT FIRST')
  same('ALTER TABLE a ADD COLUMN (p INT, q INT)', 'ALTER TABLE a ADD p INT, ADD COLUMN q INT')
  same('ALTER TABLE a DROP KEY k', 'ALTER TABLE a DROP INDEX k')
  same('ALTER TABLE a RENAME KEY k TO j', 'ALTER TABLE a RENAME INDEX k TO j')
  same('ALTER TABLE a RENAME b', 'ALTER TABLE a RENAME AS b')
  same('ALTER TABLE a CONVERT TO CHARSET latin1', 'ALTER TABLE a CONVERT TO CHARACTER SET latin1')
  // …but DROP CHECK and DROP CONSTRAINT are not: the second drops any kind.
  assert.notDeepEqual(alter('ALTER TABLE a DROP CHECK c').actions, alter('ALTER TABLE a DROP CONSTRAINT c').actions)
})

test('M3.5: ALTER COLUMN, ALTER INDEX and ALTER CHECK', () => {
  assert.deepEqual(actions('ALTER TABLE a ALTER COLUMN y SET DEFAULT 1, ALTER y SET DEFAULT (z + 1), ALTER y SET DEFAULT -1'), ['setDefault', 'setDefault', 'setDefault'])
  assert.deepEqual(alter('ALTER TABLE a ALTER y DROP DEFAULT').actions, [{ type: 'dropDefault', column: 'y' }])
  assert.deepEqual(alter('ALTER TABLE a ALTER y SET INVISIBLE').actions, [{ type: 'columnVisibility', column: 'y', visible: false }])
  assert.deepEqual(alter('ALTER TABLE a ALTER INDEX k VISIBLE').actions, [{ type: 'indexVisibility', index: 'k', visible: true }])
  assert.deepEqual(alter('ALTER TABLE a ALTER CHECK c NOT ENFORCED').actions, [{ type: 'enforce', what: 'CHECK', name: 'c', enforced: false }])
  // A default without parentheses must be a literal: this is ER_PARSE_ERROR.
  refused('ALTER TABLE a ALTER y SET DEFAULT z + 1')
})

test('M3.5: options and actions interleave, but only across a comma', () => {
  const node = alter("ALTER TABLE t1 DEFAULT CHARACTER SET utf8mb3, MODIFY s VARCHAR(5), ENGINE=InnoDB COMMENT='x'")
  assert.deepEqual(node.options, { 'CHARACTER SET': 'utf8mb3', ENGINE: 'InnoDB', COMMENT: 'x' })
  assert.deepEqual(node.actions.map((a) => a.type), ['changeColumn'])
  refused("ALTER TABLE a COMMENT='x' ADD INDEX (z)")
  // ALGORITHM and LOCK say how, not what, and are read and not kept.
  same('ALTER TABLE a ADD INDEX (z), ALGORITHM=INPLACE, LOCK NONE', 'ALTER TABLE a ADD INDEX (z)')
  assert.deepEqual(actions('ALTER TABLE a DISABLE KEYS, FORCE, DISCARD TABLESPACE, ORDER BY y DESC, z'), ['keys', 'force', 'tablespace', 'orderBy'])
  assert.throws(() => parseStatement('ALTER TABLE a ADD PARTITION (PARTITION p1)'), (e: ParseError) => e.code === 'ER_NOT_SUPPORTED_YET')
  assert.throws(() => parseStatement('ALTER TABLE a PARTITION BY HASH (x)'), (e: ParseError) => e.code === 'ER_NOT_SUPPORTED_YET')
})

test('M3.5: CREATE INDEX is ALTER TABLE … ADD INDEX, as MySQL executes it', () => {
  same('CREATE INDEX i USING BTREE ON t (a)', 'ALTER TABLE t ADD KEY i USING BTREE (a)')
  same("CREATE UNIQUE INDEX i ON t (a DESC, (b + 1)) COMMENT 'c' ALGORITHM=INPLACE LOCK=NONE", "ALTER TABLE t ADD UNIQUE KEY i (a DESC, (b + 1)) COMMENT 'c'")
  parse('CREATE FULLTEXT INDEX i ON t (a)')
  refused('CREATE INDEX ON t (a)')
})

test('M3.5: CREATE DATABASE and DROP TABLES', () => {
  assert.deepEqual(withoutPositions(parse('CREATE SCHEMA IF NOT EXISTS d DEFAULT CHARACTER SET = latin1 COLLATE latin1_german2_ci')), {
    kind: STATEMENT.CREATE_DATABASE,
    name: 'd',
    ifNotExists: true,
    options: { 'CHARACTER SET': 'latin1', COLLATE: 'latin1_german2_ci' },
  })
  same('CREATE DATABASE d CHARSET utf8mb4', 'CREATE DATABASE d CHARACTER SET utf8mb4')
  same('DROP TABLES a, b', 'DROP TABLE a, b')
})

test('M3.5: PARTITION BY, parsed and kept', () => {
  const p = (sql: string) => (parse(sql) as CreateTableNode).partition
  assert.deepEqual(p('CREATE TABLE t (x INT) PARTITION BY LINEAR KEY ALGORITHM=2 (x) PARTITIONS 4'), { linear: true, method: 'KEY', algorithm: 2, columns: ['x'], count: 4 })
  assert.deepEqual(p('CREATE TABLE t (x INT PRIMARY KEY) PARTITION BY KEY () PARTITIONS 2'), { method: 'KEY', columns: [], count: 2 })
  same(
    'CREATE TABLE t (x INT) PARTITION BY RANGE (x) (PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN MAXVALUE)',
    'CREATE TABLE t (x INT) PARTITION BY RANGE (x) (PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN (MAXVALUE))',
  )
  for (const sql of [
    'CREATE TABLE t (x INT, y INT) PARTITION BY RANGE COLUMNS (x, y) (PARTITION p0 VALUES LESS THAN (10, MAXVALUE))',
    "CREATE TABLE t (x INT) PARTITION BY LIST (x) (PARTITION p0 VALUES IN (1, 2) STORAGE ENGINE InnoDB COMMENT 'c', PARTITION p1 VALUES IN (3))",
    'CREATE TABLE t (x INT, y INT) PARTITION BY LIST COLUMNS (x, y) (PARTITION p0 VALUES IN ((1, 2), (3, 4)))',
    'CREATE TABLE t (x INT) PARTITION BY RANGE (x) SUBPARTITION BY KEY (x) (PARTITION p0 VALUES LESS THAN (10) (SUBPARTITION s0, SUBPARTITION s1))',
    'CREATE TABLE t (x INT) PARTITION BY HASH (x) PARTITIONS 2 (PARTITION p0, PARTITION p1)',
    'CREATE TABLE t (x INT) ENGINE=InnoDB PARTITION BY HASH (x) SELECT 1 AS x',
  ]) {
    assert.notEqual(p(sql), undefined, sql)
  }
  // KEY's algorithm is 1 or 2 in the grammar itself; PARTITIONS 0 and VALUES
  // IN under RANGE are refused later, by the server, with errors of their own.
  refused('CREATE TABLE t (x INT) PARTITION BY KEY ALGORITHM=3 (x)', 'CREATE TABLE t (x INT) PARTITION BY LINEAR RANGE (x)')
  p('CREATE TABLE t (x INT) PARTITION BY HASH (x) PARTITIONS 0')
})

test('M3.5: an unparenthesised DEFAULT is a literal or a signed number; ON UPDATE is NOW()', () => {
  // DEFAULT read any expression until ALTER's `SET DEFAULT z + 1` was probed;
  // the same rule governs CREATE TABLE, and each of these is ER_PARSE_ERROR.
  for (const def of ['-1', '+1', '- 1', "'a' 'b'", "_utf8mb4'a'", "'a' COLLATE utf8mb4_bin", "N'a'", 'NULL', 'TRUE', "x'41'", "b'101'", '-1.5e0', 'now()', 'CURRENT_TIMESTAMP(3)', 'LOCALTIME', '(1 + 1)']) {
    parse(`CREATE TABLE b (c INT DEFAULT ${def})`)
  }
  refused(
    'CREATE TABLE b (c INT DEFAULT 1 + 1)',
    'CREATE TABLE b (c INT DEFAULT --1)',
    'CREATE TABLE b (c INT, d INT DEFAULT c)',
    'CREATE TABLE b (c INT DEFAULT ~1)',
    'CREATE TABLE b (c INT DEFAULT -NULL)',
    "CREATE TABLE b (c INT DEFAULT -x'01')",
    'CREATE TABLE b (c DATE DEFAULT CURDATE())',
    'CREATE TABLE b (c DATETIME ON UPDATE 1)',
  )
  parse('CREATE TABLE b (c DATETIME ON UPDATE NOW())')
})

test('review: SET DEFAULT takes no NOW(); CREATE DATABASE takes no READ ONLY and no numeric charset', () => {
  refused('ALTER TABLE t ALTER a SET DEFAULT NOW()', 'CREATE DATABASE d READ ONLY = 1', 'CREATE DATABASE d CHARACTER SET 1')
})

test('review: DEFAULT the keyword and default the name are different trees, and both round-trip', () => {
  for (const sql of ["CREATE DATABASE d CHARACTER SET 'default'", 'CREATE DATABASE d CHARACTER SET `default`', 'CREATE DATABASE d CHARACTER SET DEFAULT', "CREATE TABLE t (a INT) CHARACTER SET 'default'", 'CREATE TABLE t (a INT) DEFAULT CHARSET = DEFAULT']) {
    parse(sql)
  }
  assert.notDeepEqual(withoutPositions(parse("CREATE DATABASE d CHARACTER SET 'default'")), withoutPositions(parse('CREATE DATABASE d CHARACTER SET DEFAULT')))
  refused('CREATE TABLE t (x INT) PARTITION BY HASH (x) PARTITIONS 1000000000000000000000')
})
