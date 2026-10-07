// M3.3 — query expressions.
//
// The census says how much of MySQL's corpus parses and that all of it
// round-trips. Neither number can see a tree that parses, round-trips and
// *groups wrongly* — a join that took the wrong `ON`, a `LIMIT` that bound to a
// `UNION`'s last branch instead of the whole. Those are written out here as
// shapes, rendered by a function that knows nothing about precedence; M3.16
// checks the same groupings against a real server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NODE,
  ParseError,
  STATEMENT,
  parseExpression,
  parseStatement,
  type Expression,
  type QueryBody,
  type QueryExpression,
  type TableReference,
} from '@myjs/parser'
import { withoutPositions } from '../../tools/lib/round-trip.mjs'

const query = (sql: string): QueryExpression => {
  const node = parseStatement(sql)
  assert.equal(node.kind, STATEMENT.QUERY)
  return node as QueryExpression
}

/** A table reference as a bracketed shape: `(a JOIN (b JOIN c ON) ON)`. */
function ref(r: TableReference): string {
  switch (r.kind) {
    case 'table':
      return r.alias ?? r.table.name
    case 'derived':
      return `<${r.alias ?? '?'}>`
    case 'list':
      return `[${r.items.map(ref).join(', ')}]`
    case 'join': {
      const cond = r.on !== undefined ? ' ON' : r.using !== undefined ? ' USING' : ''
      return `(${ref(r.left)} ${r.natural === true ? 'NATURAL ' : ''}${r.type} ${ref(r.right)}${cond})`
    }
  }
}

/** A query body as a shape: selects by their first item, set operations bracketed. */
function body(b: QueryBody): string {
  switch (b.kind) {
    case 'select': {
      const first = b.items[0]!.expr
      return first.kind === NODE.LITERAL ? String(first.value) : first.kind === NODE.COLUMN ? first.parts.join('.') : '?'
    }
    case 'setOperation':
      return `(${body(b.left)} ${b.op}${b.all === true ? ' ALL' : ''} ${body(b.right)})`
    case 'query':
      return `{${body(b.body)}${b.orderBy === undefined ? '' : ' ORDER'}${b.limit === undefined ? '' : ' LIMIT'}}`
    case 'values':
      return `VALUES×${b.rows.length}`
    case 'tableStatement':
      return `TABLE ${b.table.name}`
  }
}

const from = (sql: string): string => {
  const q = query(sql)
  assert.equal(q.body.kind, 'select')
  return (q.body.kind === 'select' ? q.body.from ?? [] : []).map(ref).join(', ')
}

test('M3.3: a comma binds looser than any JOIN', () => {
  // So an `ON` after `b JOIN c` may name only b and c — MySQL 5.0.12's change,
  // and the one that breaks queries written for 4.1.
  assert.equal(from('SELECT 1 FROM a, b JOIN c ON 1'), 'a, (b INNER c ON)')
  assert.equal(from('SELECT 1 FROM (a, b) JOIN c ON 1'), '([a, b] INNER c ON)')
})

test('M3.3: a join absorbs the joins after it, then a condition-less one is re-hung', () => {
  // Two rules, and M3.16's corpus is what showed it was two. MySQL's grammar
  // gives a condition-less inner join the lowest precedence, so the right side
  // of a join keeps reading until a condition closes it — `a JOIN b JOIN c ON
  // 1 ON 2` is legal, and the first `ON` is the inner join's…
  assert.equal(from('SELECT 1 FROM a JOIN b JOIN c ON 1 ON 2'), '(a INNER (b INNER c ON) ON)')
  assert.equal(from('SELECT 1 FROM a LEFT JOIN b JOIN c ON 1 ON 2'), '(a LEFT (b INNER c ON) ON)')
  assert.equal(from('SELECT 1 FROM a STRAIGHT_JOIN b JOIN c ON 1 ON 2'), '(a STRAIGHT (b INNER c ON) ON)')
  // …but a join with no condition of its own is then attached to the leftmost
  // table of what it absorbed (`add_cross_join`), so its neighbour's `ON` can
  // see `a`. 8.4 answers `t1 CROSS JOIN t2 CROSS JOIN t3 ON t1.b < t1.a`.
  assert.equal(from('SELECT 1 FROM a JOIN b JOIN c ON 1'), '((a INNER b) INNER c ON)')
  assert.equal(from('SELECT 1 FROM a JOIN b LEFT JOIN c ON 1'), '((a INNER b) LEFT c ON)')
  assert.equal(from('SELECT 1 FROM a JOIN b JOIN c JOIN d ON 1 ON 2'), '((a INNER b) INNER (c INNER d ON) ON)')
  // Parentheses stop the walk.
  assert.equal(from('SELECT 1 FROM a JOIN (b JOIN c ON 1)'), '(a INNER [(b INNER c ON)])')
  // A condition closes a join, and what follows is left-associative.
  assert.equal(from('SELECT 1 FROM a JOIN b ON 1 JOIN c ON 2'), '((a INNER b ON) INNER c ON)')
  assert.equal(from('SELECT 1 FROM a LEFT JOIN b ON 1 RIGHT JOIN c USING (x)'), '((a LEFT b ON) RIGHT c USING)')
  // `NATURAL` takes only a table on its right.
  assert.equal(from('SELECT 1 FROM a NATURAL JOIN b JOIN c'), '((a NATURAL INNER b) INNER c)')
  assert.equal(from('SELECT 1 FROM a NATURAL LEFT OUTER JOIN b'), '(a NATURAL LEFT b)')
  // An outer join must say how.
  assert.throws(() => parseStatement('SELECT 1 FROM a LEFT JOIN b'), ParseError)
  assert.throws(() => parseStatement('SELECT 1 FROM a LEFT JOIN b JOIN c'), ParseError)
})

test('M3.3: aliases, and the reserved words that are not one', () => {
  assert.equal(from('SELECT 1 FROM t x JOIN u y ON 1'), '(x INNER y ON)')
  assert.equal(from('SELECT 1 FROM t AS `join`'), 'join')
  // `JOIN`, `WHERE`, `USE` are reserved, so none of them is `t`'s alias.
  assert.equal(from('SELECT 1 FROM t USE INDEX (i) WHERE 1'), 't')
  const q = query("SELECT a b, c AS 'd', e 'f' FROM t")
  assert.deepEqual(q.body.kind === 'select' && q.body.items.map((i) => i.alias), ['b', 'd', 'f'])
  // `t.*` names many columns and may not be aliased (alias.test).
  assert.throws(() => parseStatement("SELECT t1.* AS 'x' FROM t1"), ParseError)
})

test('M3.3: derived tables, however they are parenthesised', () => {
  assert.equal(from('SELECT 1 FROM (SELECT 1) AS d'), '<d>')
  assert.equal(from('SELECT 1 FROM ((SELECT 1)) AS d'), '<d>')
  assert.equal(from('SELECT 1 FROM ((SELECT 1) AS a JOIN t ON 1)'), '[(<a> INNER t ON)]')
  assert.equal(from('SELECT 1 FROM ((SELECT 1) UNION (SELECT 2)) AS d'), '<d>')
  assert.equal(from('SELECT 1 FROM t, LATERAL (SELECT t.a) AS l'), 't, <l>')
  assert.equal(from('SELECT 1 FROM { OJ a LEFT JOIN b ON 1 }'), '(a LEFT b ON)')
})

test('M3.3: INTERSECT binds tighter than UNION and EXCEPT, which associate left', () => {
  assert.equal(body(query('SELECT 1 UNION SELECT 2 INTERSECT SELECT 3').body), '(1 UNION (2 INTERSECT 3))')
  assert.equal(body(query('SELECT 1 INTERSECT SELECT 2 UNION SELECT 3').body), '((1 INTERSECT 2) UNION 3)')
  assert.equal(body(query('SELECT 1 EXCEPT SELECT 2 UNION ALL SELECT 3').body), '((1 EXCEPT 2) UNION ALL 3)')
  assert.equal(body(query('(SELECT 1 UNION SELECT 2) INTERSECT SELECT 3').body), '({(1 UNION 2)} INTERSECT 3)')
  // `DISTINCT` is the default and is not recorded.
  assert.deepEqual(withoutPositions(query('SELECT 1 UNION DISTINCT SELECT 2')), withoutPositions(query('SELECT 1 UNION SELECT 2')))
})

test('M3.3: a trailing ORDER BY and LIMIT belong to the whole query expression', () => {
  const q = query('SELECT a FROM t UNION SELECT b FROM u ORDER BY 1 LIMIT 2')
  assert.equal(body(q.body), '(a UNION b)')
  assert.ok(q.orderBy !== undefined && q.limit !== undefined)
  // A branch that limits itself is a parenthesised query with its own clause.
  assert.equal(body(query('(SELECT a FROM t LIMIT 1) UNION SELECT b FROM u').body), '({a LIMIT} UNION b)')
  // LIMIT's three spellings are one tree.
  const offset = (sql: string) => withoutPositions(query(sql).limit)
  assert.deepEqual(offset('SELECT 1 LIMIT 5, 10'), offset('SELECT 1 LIMIT 10 OFFSET 5'))
  assert.throws(() => parseStatement('SELECT 1 LIMIT 1 + 1'), ParseError)
  assert.equal(query('SELECT 1 LIMIT ?, ?').limit?.offset?.kind, NODE.PLACEHOLDER)
})

test('M3.3: INTO is one clause written in four places, and only in a statement', () => {
  const into = (sql: string) => withoutPositions(query(sql).into)
  const expected = into('SELECT a FROM t INTO @x')
  assert.deepEqual(into('SELECT a INTO @x FROM t'), expected)
  assert.deepEqual(into('SELECT a FROM t LIMIT 1 INTO @x'), { kind: 'variables', targets: [{ kind: 'variable', name: '@x' }] })
  assert.deepEqual(into('SELECT a FROM t FOR UPDATE INTO @x'), expected)
  // ER_MULTIPLE_INTO_CLAUSES and ER_MISPLACED_INTO, refused at parse.
  assert.throws(() => parseStatement('SELECT 1 INTO @a FROM DUAL INTO @b'), ParseError)
  assert.throws(() => parseStatement('SELECT 1 INTO @a UNION SELECT 2'), ParseError)
  assert.throws(() => parseStatement('SELECT (SELECT 1 INTO @b)'), ParseError)
  assert.throws(() => parseStatement('SELECT * FROM (SELECT 1 INTO @b) d'), ParseError)
  // The trailing form after a union is the union's.
  assert.equal(query('SELECT 1 UNION SELECT 2 INTO @a').into?.kind, 'variables')
  const outfile = query("SELECT a FROM t INTO OUTFILE '/f' CHARACTER SET latin1 FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' LINES TERMINATED BY '\\n'").into
  assert.deepEqual(outfile, {
    kind: 'outfile',
    file: '/f',
    charset: 'latin1',
    options: { 'FIELDS TERMINATED BY': ',', 'FIELDS OPTIONALLY ENCLOSED BY': '"', 'LINES TERMINATED BY': '\n' },
  })
})

test('M3.3: WITH, VALUES, TABLE, windows and locking', () => {
  const q = query('WITH RECURSIVE c (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3) SELECT n FROM c')
  assert.equal(q.with?.recursive, true)
  assert.deepEqual(q.with?.tables[0]!.columns, ['n'])
  assert.equal(body(query('VALUES ROW(1, 2), ROW(3, DEFAULT)').body), 'VALUES×2')
  assert.equal(body(query('TABLE t ORDER BY a').body), 'TABLE t')
  const w = query('SELECT RANK() OVER w, SUM(a) OVER (w ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM t WINDOW w AS (PARTITION BY b ORDER BY c DESC)')
  assert.equal(w.body.kind === 'select' && w.body.windows?.[0]!.name, 'w')
  const locks = query('SELECT 1 FROM t FOR UPDATE OF t NOWAIT LOCK IN SHARE MODE').locking
  assert.deepEqual(locks, [{ strength: 'UPDATE', of: [{ name: 't' }], wait: 'NOWAIT' }, { strength: 'SHARE', legacy: true }])
  // `FROM DUAL` is no FROM at all.
  assert.deepEqual(withoutPositions(query('SELECT 1 FROM DUAL')), withoutPositions(query('SELECT 1')))
})

test('M3.3: subqueries in expressions', () => {
  const kinds = (e: Expression): string => (e.kind === NODE.BINARY ? `${e.op}:${e.right.kind}` : e.kind)
  assert.equal(kinds(parseExpression('a IN (SELECT b FROM t)')), 'IN:subquery')
  // One scalar subquery in a list is not an IN-subquery: it must return one row.
  assert.equal(kinds(parseExpression('a IN ((SELECT b FROM t))')), 'IN:row')
  const any = parseExpression('a > ANY (SELECT b FROM t)')
  assert.equal(any.kind === NODE.BINARY && any.right.kind === NODE.SUBQUERY && any.right.quantifier, 'ANY')
  const some = parseExpression('a > SOME (SELECT b FROM t)')
  assert.equal(some.kind === NODE.BINARY && some.right.kind === NODE.SUBQUERY && some.right.quantifier, 'ANY')
  const exists = parseExpression('NOT EXISTS (SELECT 1)')
  assert.equal(exists.kind === NODE.UNARY && exists.operand.kind === NODE.UNARY && exists.operand.op, 'EXISTS')
  // `((SELECT 1) UNION (SELECT 2))` only becomes a query at `UNION`;
  // `((SELECT 1) + 1)` stays arithmetic on a scalar subquery.
  assert.equal(parseExpression('((SELECT 1) UNION (SELECT 2))').kind, NODE.SUBQUERY)
  assert.equal(parseExpression('((SELECT 1) + 1)').kind, NODE.BINARY)
})

test('M3.3: special-syntax builtins parse to the call a plain form would', () => {
  const same = (a: string, b: string) => assert.deepEqual(withoutPositions(parseExpression(a)), withoutPositions(parseExpression(b)))
  same('SUBSTRING(s FROM 2 FOR 3)', 'SUBSTRING(s, 2, 3)')
  same('CONVERT(a, CHAR(3))', 'CAST(a AS CHAR(3))')
  same('CURRENT_DATE', 'CURRENT_DATE()')
  assert.equal(parseExpression('CONVERT(a USING utf8mb4)').kind, NODE.CONVERT)
  assert.equal(parseExpression('CAST(a AS UNSIGNED INTEGER)').kind, NODE.CAST)
  // A CAST target is narrower than a column type (cast.test).
  for (const bad of ['CAST(a AS INT)', 'CAST(a AS DOUBLE(52))', 'CAST(a AS FLOAT(7,4))', 'CAST(a AS REAL(3))']) {
    assert.throws(() => parseExpression(bad), ParseError, bad)
  }
  // `INTERVAL(n, …)` is a function; `INTERVAL (n) DAY` is an interval.
  assert.equal(parseExpression('INTERVAL(a, 1, 2)').kind, NODE.CALL)
  const interval = parseExpression('d + INTERVAL (1) DAY')
  assert.equal(interval.kind === NODE.BINARY && interval.right.kind, NODE.INTERVAL)
  assert.equal(parseExpression("j->>'$.a'").kind, NODE.BINARY)
  assert.equal(parseExpression('MATCH a AGAINST (\'x\' IN BOOLEAN MODE)').kind, NODE.MATCH)
})

test('M3.3: CREATE TABLE … SELECT and CREATE VIEW carry their query', () => {
  for (const sql of ['CREATE TABLE t SELECT 1', 'CREATE TABLE t (a INT) IGNORE AS SELECT 1', 'CREATE TABLE t (SELECT 1)']) {
    const node = parseStatement(sql)
    assert.equal(node.kind === STATEMENT.CREATE_TABLE && node.query?.kind, 'query', sql)
  }
  const view = parseStatement("CREATE OR REPLACE ALGORITHM = MERGE DEFINER = 'u'@'%' SQL SECURITY INVOKER VIEW v (a) AS SELECT 1 WITH CHECK OPTION")
  assert.equal(view.kind, STATEMENT.CREATE_VIEW)
  if (view.kind === STATEMENT.CREATE_VIEW) {
    assert.deepEqual(view.definer, { user: 'u', host: '%' })
    // A bare `WITH CHECK OPTION` is CASCADED, MySQL's default.
    assert.equal(view.checkOption, 'CASCADED')
  }
})

test('M3.15 / ground rule 5: nested subqueries share one depth limit', () => {
  // Every subquery starts a new expression parser, so a counter kept per parser
  // would restart at zero at each level and never trip. It lives on the cursor.
  for (const depth of [200, 5000]) {
    const sql = 'SELECT ' + '(SELECT '.repeat(depth) + '1' + ')'.repeat(depth)
    assert.throws(
      () => parseStatement(sql),
      (e: unknown) => e instanceof ParseError && e.errno === 1436,
      `depth ${depth} must be a typed refusal`,
    )
  }
  for (const sql of ['SELECT * FROM ' + '('.repeat(5000) + 't' + ')'.repeat(5000), 'SELECT 1 FROM ' + 't JOIN '.repeat(5000) + 't']) {
    assert.throws(() => parseStatement(sql), ParseError)
  }
})
