// M3.3 — the deparser, and the round-trip it exists for.
//
// The census runs `parse(deparse(ast))` over every corpus statement that parses
// and gates at zero differences. That is the scale check; this file is the
// coverage check. The corpus's `CREATE`s happen not to exercise every node —
// planting a deparser that drops a key's `COMMENT`, an expression's `COLLATE`
// or a DOUBLE's exponent leaves the census green — so each form is written out
// here, and each of those three mutations fails a case below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deparse, parseExpression, parseSqlMode, parseStatement, quoteName } from '@myjs/parser'
import { roundTrip, withoutPositions } from '../../tools/lib/round-trip.mjs'

const expressionRoundTrips = (sql: string, mode?: string): void => {
  const options = mode === undefined ? {} : { sqlMode: parseSqlMode(mode) }
  const ast = parseExpression(sql, options)
  const text = deparse(ast, options)
  assert.deepEqual(withoutPositions(parseExpression(text, options)), withoutPositions(ast), `${sql}\n  -> ${text}`)
}

const statementRoundTrips = (sql: string, mode?: string): void => {
  const options = mode === undefined ? {} : { sqlMode: parseSqlMode(mode) }
  const broken = roundTrip(parseStatement(sql, options), options)
  assert.equal(broken, null, `${sql}\n  -> ${JSON.stringify(broken)}`)
}

test('M3.3: every expression node survives the deparser', () => {
  for (const sql of [
    // Literals, each of which is a different SQL type.
    '1', '1.50', '1.5e0', '2e308', "'it''s'", "'back\\\\slash'", "x'C3A6'", "b'101'", 'NULL', 'TRUE', 'FALSE',
    "DATE '2019-10-01'", "TIMESTAMP'2019-10-01 01:02:03'", "_latin1'x'", "'a' COLLATE utf8mb4_bin",
    // Names and variables.
    'a', 't.a', 'db.t.a', 't.*', '`we``ird`', 't.select', '@a', "@'a b'", '@@session.sql_mode', '?',
    // Operators — precedence, unary chains, predicates.
    '1 + 2 * 3', '(1 + 2) * 3', '- - 1', '!a', '~a', 'NOT a', 'BINARY a', 'a := 1',
    'a IS NOT NULL IS TRUE', 'a BETWEEN 1 AND 2', 'a NOT BETWEEN b AND c', 'a IN (1)', 'a NOT IN (1, 2)',
    "a LIKE 'x%' ESCAPE '!'", "a NOT REGEXP 'b'", 'a <=> b', 'a COLLATE latin1_bin', '(a, b) = (1, 2)',
    // Calls and the rest.
    'COUNT(*)', 'COUNT(DISTINCT a, b)', 'f()', 'IF(a, b, c)', 'CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP(6)',
    'CASE a WHEN 1 THEN 2 ELSE 3 END', 'CASE WHEN a THEN b END', 'a + INTERVAL 1 DAY',
  ]) {
    expressionRoundTrips(sql)
  }
})

test('M3.3: string literals are escaped for the mode they will be read in', () => {
  // Under NO_BACKSLASH_ESCAPES a backslash is an ordinary character, so the
  // deparser must not double it — and by default it must.
  assert.equal(deparse(parseExpression("'a\\\\b'")), "'a\\\\b'")
  assert.equal(deparse(parseExpression("'a\\b'", { sqlMode: parseSqlMode('NO_BACKSLASH_ESCAPES') }), { sqlMode: parseSqlMode('NO_BACKSLASH_ESCAPES') }), "'a\\b'")
  expressionRoundTrips("'a\\b'", 'NO_BACKSLASH_ESCAPES')
  // `"x"` is a string by default and a name under ANSI_QUOTES; the deparser
  // writes `'` and `` ` ``, which mean the same thing under both.
  expressionRoundTrips('"x"')
  expressionRoundTrips('"x"', 'ANSI_QUOTES')
  expressionRoundTrips('a || b', 'PIPES_AS_CONCAT')
  expressionRoundTrips('NOT a = b', 'HIGH_NOT_PRECEDENCE')
})

test('M3.3: a DOUBLE keeps its exponent, or it comes back a DECIMAL', () => {
  assert.match(deparse(parseExpression('1.5e0')), /e/)
})

test('M3.3: the deparser is fully parenthesised, so it carries no precedence of its own', () => {
  assert.equal(deparse(parseExpression('1 + 2 * 3')), '(1 + (2 * 3))')
  assert.equal(deparse(parseExpression('a OR b AND c')), '(`a` OR (`b` AND `c`))')
  assert.equal(quoteName('a`b'), '`a``b`')
})

test('M3.3: CREATE TABLE and DROP survive the deparser', () => {
  for (const sql of [
    'CREATE TEMPORARY TABLE IF NOT EXISTS db.t LIKE db.u',
    'CREATE TABLE t (a INT)',
    'CREATE TABLE t (a INT(4) UNSIGNED ZEROFILL NOT NULL DEFAULT 0 AUTO_INCREMENT PRIMARY KEY COMMENT "x")',
    'CREATE TABLE t (a SERIAL, b DECIMAL(10,2) SIGNED NULL, c DOUBLE PRECISION, d FLOAT(30), e REAL)',
    "CREATE TABLE t (a VARCHAR(10) CHARACTER SET latin1 COLLATE latin1_bin BINARY, b ENUM('x', 0xc3a6, b'1') DEFAULT 'x')",
    'CREATE TABLE t (a VARCHAR(5) NOT NULL COLLATE utf8mb4_bin)',
    'CREATE TABLE t (a TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE now(6), b INT DEFAULT -1, c INT DEFAULT (a + 1))',
    'CREATE TABLE t (a INT GENERATED ALWAYS AS (b * 2) STORED INVISIBLE, b INT AS (1) VIRTUAL VISIBLE, g POINT SRID 4326, c INT CHECK (c > 0))',
    'CREATE TABLE t (a INT, b TEXT, PRIMARY KEY (a), UNIQUE KEY u (a DESC) USING HASH COMMENT "c", KEY (b(10)), FULLTEXT (b), KEY ((UPPER(b))))',
    'CREATE TABLE t (a INT, CONSTRAINT fk FOREIGN KEY (a) REFERENCES p (id) MATCH FULL ON DELETE SET NULL ON UPDATE CASCADE)',
    'CREATE TABLE t (a INT, CONSTRAINT c CHECK (a > 0) NOT ENFORCED, CHECK (a < 9))',
    "CREATE TABLE t (a INT) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='it''s' ROW_FORMAT=DYNAMIC",
    "CREATE TABLE t (a INT) DATA DIRECTORY = '/tmp' UNION = (a, b) START TRANSACTION",
    'DROP TEMPORARY TABLE IF EXISTS a, db.b RESTRICT',
    'DROP INDEX i ON t',
    'DROP DATABASE d',
  ]) {
    statementRoundTrips(sql)
  }
})

test('M3.3: two spellings of one column are one tree', () => {
  // A late `COLLATE` is the type's collation written late. Recording it on the
  // column made these two trees, and the round-trip is what said so.
  const late = parseStatement('CREATE TABLE t (a VARCHAR(5) NOT NULL COLLATE utf8mb4_bin)')
  const early = parseStatement('CREATE TABLE t (a VARCHAR(5) COLLATE utf8mb4_bin NOT NULL)')
  assert.deepEqual(withoutPositions(late), withoutPositions(early))
})

test('M3.3: every query form survives the deparser', () => {
  for (const sql of [
    // Bodies and set operations.
    'SELECT 1',
    'SELECT DISTINCT HIGH_PRIORITY SQL_CALC_FOUND_ROWS a, b AS x, t.* FROM t',
    'SELECT 1 UNION SELECT 2 INTERSECT SELECT 3 EXCEPT ALL SELECT 4',
    '(SELECT 1 LIMIT 1) UNION ALL (SELECT 2 ORDER BY 1) ORDER BY 1 DESC LIMIT 2 OFFSET 1',
    '((SELECT 1))',
    'VALUES ROW(1, DEFAULT), ROW(2, 3) ORDER BY 1',
    'TABLE db.t LIMIT 1',
    'WITH RECURSIVE c (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c) SELECT * FROM c',
    // Clauses.
    'SELECT a, COUNT(*) FROM t WHERE a > 1 GROUP BY a, b WITH ROLLUP HAVING COUNT(*) > 1',
    'SELECT RANK() OVER w, SUM(a) OVER (w ORDER BY b ROWS BETWEEN UNBOUNDED PRECEDING AND 1 FOLLOWING) FROM t WINDOW w AS (PARTITION BY c)',
    'SELECT SUM(a) OVER (RANGE BETWEEN INTERVAL 1 DAY PRECEDING AND CURRENT ROW) FROM t',
    'SELECT a FROM t INTO @x, @y',
    "SELECT a FROM t INTO OUTFILE '/f' CHARACTER SET latin1 FIELDS TERMINATED BY ',' ESCAPED BY '\\\\' LINES STARTING BY '>' TERMINATED BY '\\n'",
    "SELECT a FROM t INTO DUMPFILE '/f'",
    'SELECT a FROM t FOR UPDATE OF t, u SKIP LOCKED FOR SHARE LOCK IN SHARE MODE',
    // Table references.
    'SELECT 1 FROM t PARTITION (p0, p1) AS x USE INDEX FOR JOIN (i) IGNORE KEY (PRIMARY) FORCE INDEX FOR ORDER BY ()',
    'SELECT 1 FROM a, b JOIN c ON 1 LEFT JOIN d USING (x, y) NATURAL RIGHT JOIN e STRAIGHT_JOIN f ON 2',
    'SELECT 1 FROM a JOIN b JOIN c ON 1 ON 2',
    'SELECT 1 FROM (a, b) CROSS JOIN c',
    'SELECT 1 FROM t, LATERAL (SELECT t.a) AS d (x)',
    'SELECT 1 FROM (SELECT 1) d, ((SELECT 1) AS e JOIN f ON 1)',
    // Expressions only a query can hold.
    'SELECT (SELECT 1), a IN (SELECT b FROM u), a > ALL (SELECT 1), a = SOME (SELECT 1), EXISTS (SELECT 1)',
    "SELECT CAST(a AS CHAR(3) CHARACTER SET latin1), CAST(a AS SIGNED), CAST(a AT TIME ZONE '+00:00' AS DATETIME(6)), CAST(j AS UNSIGNED ARRAY)",
    'SELECT CONVERT(a USING utf8mb4), CONVERT(a, DECIMAL(5, 2))',
    "SELECT EXTRACT(YEAR FROM d), TIMESTAMPADD(SQL_TSI_DAY, 1, d), GET_FORMAT(DATE, 'USA'), POSITION('a' IN b)",
    "SELECT TRIM(a), TRIM('x' FROM a), TRIM(LEADING FROM a), TRIM(BOTH 'x' FROM a), SUBSTRING(a FROM 2 FOR 3)",
    'SELECT WEIGHT_STRING(a AS CHAR(3)), WEIGHT_STRING(a AS BINARY(2)), WEIGHT_STRING(a)',
    "SELECT GROUP_CONCAT(DISTINCT a ORDER BY b DESC SEPARATOR ';'), CHAR(77, 78 USING utf8mb4), SUM(ALL a)",
    "SELECT MATCH (a, b) AGAINST ('x' IN BOOLEAN MODE), MATCH a AGAINST ('y' WITH QUERY EXPANSION)",
    "SELECT ROW(1), ROW(1, 2), a MEMBER OF ('[1]'), a SOUNDS LIKE b, j->'$.a', j->>'$.b', INTERVAL(a, 1, 2)",
    "SELECT N'x', _binary 0x41, _utf8mb4 b'1', _latin1 'a' 'b'",
    'SELECT ((SELECT 1) UNION (SELECT 2)), ((SELECT 1) + 1)',
    // Statements that carry a query.
    'CREATE TABLE t (a INT) REPLACE AS SELECT 1',
    'CREATE TABLE t SELECT 1 FROM u',
    "CREATE OR REPLACE ALGORITHM = TEMPTABLE DEFINER = 'u'@'h' SQL SECURITY DEFINER VIEW db.v (a, b) AS SELECT 1, 2 WITH LOCAL CHECK OPTION",
    'CREATE DEFINER = CURRENT_USER VIEW v AS SELECT 1 WITH CHECK OPTION',
    'CREATE TABLE t (a INT DEFAULT (SELECT 1))',
  ]) {
    statementRoundTrips(sql)
  }
})
