// M3.8 — stored procedures, functions, triggers and events: accepted and
// stored, not executed. Each refusal is ER_PARSE_ERROR on a real 8.4.11.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session, capabilities } from '@myjs/protocol'
import { SqlExecutor, charsetTranscoder } from '@myjs/core'
import {
  ParseError,
  STATEMENT,
  parseStatement,
  parseStatements,
  type CallStatementNode,
  type CreateEventNode,
  type CreateRoutineNode,
  type CreateTriggerNode,
} from '@myjs/parser'
import { parsed as parse, refused, same, withoutPositions } from '../../tools/lib/round-trip.mjs'

const routine = (sql: string) => parse(sql) as CreateRoutineNode

test('M3.8: a procedure head is parsed in full, and its body kept as written', () => {
  const p = routine("CREATE DEFINER = 'u'@'h' PROCEDURE IF NOT EXISTS db.p(IN a INT, OUT b CHAR(3), INOUT c INT) COMMENT 'x' LANGUAGE SQL NOT DETERMINISTIC READS SQL DATA SQL SECURITY INVOKER SELECT a  +  1")
  assert.equal(p.object, 'PROCEDURE')
  assert.deepEqual(p.name, { schema: 'db', name: 'p' })
  assert.deepEqual(p.definer, { user: 'u', host: 'h' })
  assert.deepEqual(p.parameters.map((x) => [x.mode, x.name]), [[undefined, 'a'], ['OUT', 'b'], ['INOUT', 'c']])
  assert.equal(p.deterministic, false)
  assert.equal(p.dataAccess, 'READS SQL DATA')
  assert.equal(p.security, 'INVOKER')
  // As written, spacing included: the body is source text, not a tree.
  assert.equal(p.body, 'SELECT a  +  1')
  same('CREATE PROCEDURE p(IN a INT) SELECT 1', 'CREATE PROCEDURE p(a INT) SELECT 1')
  refused('CREATE PROCEDURE p SELECT 1', 'CREATE PROCEDURE p()', 'CREATE PROCEDURE p() SELECT')
})

test('M3.8: a single-statement body is parsed; a compound one is stored unread', () => {
  // `garbage` is ER_PARSE_ERROR on 8.4.11, so a plain body has to be checked.
  // An unknown leading word is refused as not implemented, which is how the
  // dispatcher answers any statement it has no grammar for.
  assert.throws(() => parseStatement('CREATE PROCEDURE p() garbage here'), ParseError)
  refused('CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SELECT 1 1 1')
  parse('CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW INSERT INTO b VALUES (NEW.x)')
  // The stored-program language is M8.5's. Its text survives exactly.
  const body = 'BEGIN DECLARE i INT DEFAULT 0; WHILE i < 3 DO SET i = i + 1; END WHILE; END'
  assert.equal(routine(`CREATE PROCEDURE p() ${body}`).body, body)
  assert.equal(routine(`CREATE PROCEDURE p() ${body};`).body, body, 'a trailing ; belongs to the statement')
  assert.equal(routine('CREATE PROCEDURE p() l1: LOOP LEAVE l1; END LOOP l1').body, 'l1: LOOP LEAVE l1; END LOOP l1')
})

test('M3.8: a function returns a type, and its parameters take no direction', () => {
  const f = routine('CREATE FUNCTION f(a INT) RETURNS VARCHAR(20) CHARSET latin1 DETERMINISTIC NO SQL RETURN CONCAT(a, 1)')
  assert.equal(f.object, 'FUNCTION')
  assert.equal(f.returns?.name, 'VARCHAR')
  assert.equal(f.body, 'RETURN CONCAT(a, 1)')
  refused('CREATE FUNCTION f(IN a INT) RETURNS INT RETURN 1', 'CREATE FUNCTION f(a INT) RETURN 1', 'CREATE FUNCTION f() RETURNS INT RETURN')
  assert.throws(() => parseStatement("CREATE FUNCTION f RETURNS INTEGER SONAME 'udf.so'"), (e: ParseError) => e.code === 'ER_NOT_SUPPORTED_YET')
})

test('M3.8: triggers and events', () => {
  const t = parse('CREATE TRIGGER IF NOT EXISTS tr AFTER UPDATE ON a FOR EACH ROW PRECEDES other SET @x = 1') as CreateTriggerNode
  assert.deepEqual([t.timing, t.event, t.table, t.order], ['AFTER', 'UPDATE', { name: 'a' }, { position: 'PRECEDES', trigger: 'other' }])
  const e = parse("CREATE EVENT e ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01' ENDS '2031-01-01' ON COMPLETION PRESERVE DISABLE ON SLAVE COMMENT 'c' DO SELECT 1") as CreateEventNode
  assert.equal('every' in e.schedule && e.schedule.unit, 'DAY')
  assert.equal(e.preserve, true)
  assert.equal(e.status, 'DISABLE ON REPLICA')
  parse("CREATE EVENT e ON SCHEDULE AT '2030-01-01' + INTERVAL 1 HOUR DO SELECT 1")
})

test('M3.8: CALL and DROP', () => {
  same('CALL p', 'CALL p()')
  assert.equal((parse('CALL test.p(1, @a)') as CallStatementNode).args.length, 2)
  for (const object of ['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']) {
    assert.deepEqual(withoutPositions(parse(`DROP ${object} IF EXISTS d.x`)), { kind: STATEMENT.DROP, object, names: [{ schema: 'd', name: 'x' }], ifExists: true })
  }
  refused('DROP PROCEDURE a, b')
})

test('parseStatements splits a multi-statement text where the parser says, not at every ;', () => {
  const nodes = parseStatements('DROP FUNCTION IF EXISTS f; CREATE FUNCTION f() RETURNS INT BEGIN DO 1; RETURN 2; END;')
  assert.deepEqual(nodes.map((n) => n.kind), [STATEMENT.DROP, STATEMENT.CREATE_ROUTINE])
  assert.throws(() => parseStatements(''), ParseError)
  assert.throws(() => parseStatement('SELECT 1; SELECT 2'), ParseError, 'one statement only, as D-13 requires')
})

test('M3.8: CREATE PROCEDURE stores; CALL errors with a clear "not yet supported"', async () => {
  const s = new Session({ connectionId: 1, capabilities: capabilities(0), transcoder: charsetTranscoder })
  s.database = 'test'
  const stub = new SqlExecutor()
  const run = (sql: string) => stub.query(s, sql)
  const errno = (n: number) => (e: Error & { errno?: number }) => e.errno === n

  await assert.rejects(run('CALL p()'), errno(1305), 'an unknown procedure is ER_SP_DOES_NOT_EXIST')
  await run('CREATE PROCEDURE p() BEGIN SELECT 1; END')
  await assert.rejects(run('CREATE PROCEDURE P() SELECT 2'), errno(1304), 'names are case-insensitive')
  await run('CREATE PROCEDURE IF NOT EXISTS p() SELECT 2')
  await assert.rejects(run('CALL test.p'), (e: Error & { errno?: number; message: string }) => e.errno === 1235 && /CALL/.test(e.message))
  await run('DROP PROCEDURE p')
  await assert.rejects(run('DROP PROCEDURE p'), errno(1305))
  await run('DROP PROCEDURE IF EXISTS p')
  await run('CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SET @x = 1')
  await assert.rejects(run('CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW SET @x = 1'), errno(1359))
})

test('review: a compound body ends at its matching END, so the next statement is not swallowed', () => {
  const kinds = (sql: string) => parseStatements(sql).map((n) => n.kind)
  assert.deepEqual(kinds('CREATE PROCEDURE p() BEGIN END; SELECT 1'), [STATEMENT.CREATE_ROUTINE, STATEMENT.QUERY])
  // Nested blocks, a CASE expression's END, the IF function and an IF statement.
  const nested = 'CREATE PROCEDURE p() BEGIN SET @x = CASE WHEN 1 THEN IF(1, 2, 3) ELSE 0 END; IF @x THEN BEGIN SELECT 1; END; END IF; END'
  assert.deepEqual(kinds(`${nested}; SELECT 2`), [STATEMENT.CREATE_ROUTINE, STATEMENT.QUERY])
  assert.equal((parseStatements(`${nested}; SELECT 2`)[0] as CreateRoutineNode).body, nested.slice('CREATE PROCEDURE p() '.length))
  assert.deepEqual(kinds('CREATE PROCEDURE p() l1: LOOP LEAVE l1; END LOOP l1; DO 1'), [STATEMENT.CREATE_ROUTINE, STATEMENT.DO])
  assert.deepEqual(kinds('CREATE PROCEDURE p() REPEAT SET @a = REPEAT(\'x\', 2); UNTIL 1 END REPEAT; DO 1'), [STATEMENT.CREATE_ROUTINE, STATEMENT.DO])
  refused('CREATE PROCEDURE p() BEGIN SELECT 1;', 'CREATE PROCEDURE p() BEGIN END IF')
})

test('review: a body inside /*! */ keeps its comment whole, and round-trips', () => {
  assert.equal(routine('CREATE PROCEDURE p() /*!50001 SELECT */ 1').body, '/*!50001 SELECT */ 1')
  assert.equal(routine('CREATE PROCEDURE p() SELECT /*!50001 1 */').body, 'SELECT /*!50001 1 */')
})

test('review: what 8.4.11 refuses in a stored program head, and the units an event accepts', () => {
  refused('CREATE PROCEDURE p() RETURN 1', 'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW RETURN 1', 'DROP PROCEDURE p RESTRICT', 'CREATE EVENT e ON SCHEDULE EVERY 1 foo DO SELECT 1')
  for (const unit of ['HOUR_MINUTE', 'DAY_HOUR', 'YEAR_MONTH']) parse(`CREATE EVENT e ON SCHEDULE EVERY '1:2' ${unit} DO SELECT 1`)
})
