import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BINARY_DEPRECATION, Cursor, NATIONAL_DEPRECATION, NODE, NO_SQL_MODE, ParseError, lex, parseCreateTable, parseExpression, parseStatement, parseStatementBytes, parseStatementSequence } from '@myjs/parser'

const unknown = () => new ParseError('ER_UNKNOWN_COLLATION', "Unknown collation: 'missing'", { errno: 1273, sqlState: 'HY000' })
const overflow = () => new ParseError('ER_ILLEGAL_VALUE_FOR_TYPE', "Illegal double '1e309' value found during parsing", { errno: 1367, sqlState: '22007' })

test('grammar warnings precede a fatal error without replacing its identity or JSON', () => {
  const c = new Cursor(lex(''))
  const fatal = unknown(), json = JSON.stringify(fatal), keys = Object.keys(fatal)
  assert.throws(() => c.checked(() => {
    c.warn(3720, NATIONAL_DEPRECATION)
    throw fatal
  }), (error: unknown) => error === fatal)
  assert.equal(Object.getPrototypeOf(fatal), ParseError.prototype)
  assert.equal(JSON.stringify(fatal), json)
  assert.deepEqual(Object.keys(fatal), keys)
  assert.equal(Object.getOwnPropertyDescriptor(fatal, 'conditions')?.enumerable, false)
  assert.deepEqual(fatal.conditions, [
    { errno: 3720, message: NATIONAL_DEPRECATION, level: 'Warning' },
    { errno: 1273, message: fatal.message },
  ])
  assert.deepEqual(c.checked(() => ({ valid: true })), { valid: true })
  assert.throws(() => c.checked(() => { throw overflow() }), (error: unknown) => error instanceof ParseError && error.conditions === undefined)
})

test('warning collection is scoped, nested and never publishes successful or untyped results', () => {
  const c = new Cursor(lex(''))
  c.warn(3720, NATIONAL_DEPRECATION)
  const ast = { valid: true }
  assert.equal(c.checked(() => { c.warn(3720, NATIONAL_DEPRECATION); return ast }), ast)
  assert.deepEqual(Reflect.ownKeys(ast), ['valid'])
  const bug = new TypeError('test failure')
  assert.throws(() => c.checked(() => { c.warn(3720, NATIONAL_DEPRECATION); throw bug }), (error: unknown) => error === bug)
  const first = unknown(), later = overflow()
  assert.throws(() => c.checked(() => {
    c.warn(3720, NATIONAL_DEPRECATION)
    c.checked(() => { c.report(first); c.warn(3720, NATIONAL_DEPRECATION); return {} })
    throw later
  }), (error: unknown) => error === first)
  assert.deepEqual(first.conditions?.map(e => [e.errno, e.level ?? 'Error']), [[3720, 'Warning'], [1273, 'Error'], [3720, 'Warning'], [1367, 'Error']])
  assert.throws(() => c.report(later), (error: unknown) => error === later)
})

test('national CHAR warnings retain source order at checked roots and native reduction boundaries', () => {
  const sql = "SELECT CAST('x' AS NCHAR),1 COLLATE missing,CAST('x' AS NATIONAL CHAR),1e309"
  for (const parse of [() => parseStatement(sql), () => parseStatementBytes(new TextEncoder().encode(sql)), () => parseExpression("CAST('x' AS NCHAR)+(1 COLLATE missing)+CAST('x' AS NATIONAL CHAR)+1e309")]) {
    assert.throws(parse, (error: unknown) => error instanceof ParseError && error.errno === 1273 && String(error.conditions?.map(e => e.errno)) === '3720,1273,3720,1367')
  }
  for (const type of ['NCHAR VARCHAR(2)', 'NCHAR VARYING(2)', 'NATIONAL CHARACTER VARYING(2)']) {
    assert.throws(() => parseStatement("SELECT CAST('x' AS " + type + ')'), (error: unknown) => error instanceof ParseError && error.errno === 1064 && String(error.conditions?.map(e => e.errno)) === '3720,1064')
  }
  for (const type of ['NVARCHAR(2)', 'NATIONAL VARCHAR(2)', 'NCHAR(-1)', 'NCHAR(1e309)', 'NCHAR(2,3)']) {
    assert.throws(() => parseStatement("SELECT CAST('x' AS " + type + ')'), (error: unknown) => error instanceof ParseError && !error.conditions?.some(e => e.errno === 3720))
  }
  const source = 'CREATE TABLE t(v NCHAR(2) COLLATE missing)'
  assert.throws(() => parseCreateTable(new Cursor(lex(source), source), { sqlMode: NO_SQL_MODE }), (error: unknown) => error instanceof ParseError && error.errno === 1273 && error.conditions === undefined)
})

test('checked parsing preserves the first error by identity and keeps history out of its JSON', () => {
  const c = new Cursor(lex(''))
  const first = unknown(), later = overflow()
  const json = JSON.stringify(first), keys = Object.keys(first)
  assert.throws(() => c.checked(() => {
    c.report(first)
    throw later
  }), (error: unknown) => error === first)
  assert.equal(Object.getPrototypeOf(first), ParseError.prototype)
  assert.equal(JSON.stringify(first), json)
  assert.deepEqual(Object.keys(first), keys)
  assert.equal(Object.getOwnPropertyDescriptor(first, 'conditions')?.enumerable, false)
  assert.deepEqual(first.conditions, [{ errno: 1273, message: first.message }, { errno: 1367, message: later.message }])
  const next = overflow()
  assert.throws(() => c.checked(() => { c.report(next); return {} }), (error: unknown) => error === next)
  assert.equal(next.conditions, undefined)
  assert.equal(first.conditions!.length, 2, 'later cursor use cannot mutate an earlier history')
  assert.deepEqual(c.checked(() => ({ valid: true })), { valid: true })
})

test('a checked parser scope never hides untyped bugs and always closes its collection', () => {
  const c = new Cursor(lex(''))
  const first = unknown(), bug = new TypeError('test failure')
  assert.throws(() => c.checked(() => { c.report(first); throw bug }), (error: unknown) => error === bug)
  assert.equal(first.conditions, undefined)
  const next = overflow()
  assert.throws(() => c.report(next), (error: unknown) => error === next, 'outside a checked root, refusal remains immediate')
  assert.deepEqual(c.checked(() => ({ valid: true })), { valid: true })
})

test('only the outermost checked boundary publishes nested grammar conditions', () => {
  const c = new Cursor(lex(''))
  const first = unknown(), later = overflow()
  let innerReturned = false
  assert.throws(() => c.checked(() => {
    c.checked(() => { c.report(first); return {} })
    innerReturned = true
    c.report(later)
    return {}
  }), (error: unknown) => error === first)
  assert.equal(innerReturned, true)
  assert.deepEqual(first.conditions?.map(e => e.errno), [1273, 1367])
})

test('statement, byte and expression roots retain recoverable conditions and stop at native fatal grammar', () => {
  const sql = 'SELECT 1e309,1 COLLATE missing'
  for (const parse of [() => parseStatement(sql), () => parseStatementBytes(new TextEncoder().encode(sql)), () => parseExpression('1e309 + (1 COLLATE missing)')]) {
    assert.throws(parse, (error: unknown) => {
      assert.ok(error instanceof ParseError)
      assert.equal(error.errno, 1367)
      assert.deepEqual(error.conditions?.map(e => e.errno), [1367, 1273])
      return true
    })
  }
  assert.throws(() => parseStatement("SELECT 1 COLLATE missing,CONVERT('x' USING unknown),1e309"), (error: unknown) => error instanceof ParseError && error.errno === 1273 && String(error.conditions?.map(e => e.errno)) === '1273,1115')
  assert.throws(() => parseStatement("SELECT CONVERT('x' USING unknown),1e309"), (error: unknown) => error instanceof ParseError && error.errno === 1115 && error.conditions === undefined)
  const source = 'CREATE TABLE t(v DOUBLE DEFAULT 1e309)'
  assert.throws(() => parseCreateTable(new Cursor(lex(source), source), { sqlMode: NO_SQL_MODE }), (error: unknown) => error instanceof ParseError && error.errno === 1367 && error.conditions === undefined)
})

test('incremental parsing publishes a completed prefix before a later invalid statement', () => {
  const statements = parseStatementSequence('SELECT 1; SELECT 1 COLLATE missing,1e309; SELECT 2')
  const first = statements.next()
  assert.equal(first.done, false)
  if (!first.done) assert.equal(first.value.more, true)
  assert.throws(() => statements.next(), (error: unknown) => error instanceof ParseError && error.errno === 1273 && String(error.conditions?.map(e => e.errno)) === '1273,1367')
  assert.equal(statements.next().done, true)
})

test('local structural limits preserve an existing native error and release their depth counter', () => {
  for (const suffix of ['('.repeat(120) + '1' + ')'.repeat(120), '1+'.repeat(1100) + '1']) {
    assert.throws(() => parseStatement('SELECT 1 COLLATE missing,' + suffix), (error: unknown) => error instanceof ParseError && error.errno === 1273 && error.conditions === undefined)
  }
  const c = new Cursor(lex(''))
  const descend = (depth: number): number => depth === 0 ? 1 : c.nested(() => descend(depth - 1))
  assert.throws(() => descend(101), { errno: 1436 })
  assert.equal(descend(100), 1)
  assert.equal(parseExpression('1').kind, NODE.LITERAL)
})

test('failed CAST shorthand warnings retain written order around BINARY', () => {
  for (const [modifier, names] of [
    ['ASCII', ['ASCII']], ['UNICODE', ['UNICODE']],
    ['BINARY ASCII', ['BINARY as attribute of a type', 'ASCII']],
    ['ASCII BINARY', ['ASCII', 'BINARY as attribute of a type']],
    ['BINARY UNICODE', ['BINARY as attribute of a type', 'UNICODE']],
  ] as const) for (const form of ['CAST', 'CONVERT']) {
    const expression = form === 'CAST' ? "CAST('x' AS CHAR " + modifier + ')' : "CONVERT('x', CHAR " + modifier + ')'
    assert.throws(() => parseStatement('SELECT ' + expression + ' FROM'), (error: unknown) => {
      assert.ok(error instanceof ParseError)
      assert.equal(error.errno, 1064)
      const warnings = error.conditions?.filter(e => e.level === 'Warning') ?? []
      assert.deepEqual(warnings.map(e => e.errno), names.map(() => 1287))
      assert.deepEqual(warnings.map(e => e.message.split("'")[1]), names)
      return true
    })
  }
})

test('charset values are not shorthand warnings and failed charset clauses suppress attributes', () => {
  for (const modifier of ['CHARACTER SET ascii', 'CHARSET "ascii"', 'CHARACTER SET binary']) {
    assert.throws(() => parseStatement("SELECT CAST('x' AS CHAR " + modifier + ') FROM'), (error: unknown) => error instanceof ParseError && error.errno === 1064 && !error.conditions?.some(e => e.errno === 1287))
  }
  for (const modifier of ['BINARY CHARACTER SET unknown', 'BINARY CHARACTER what', 'BINARY CHARACTER SET']) {
    assert.throws(() => parseStatement("SELECT CAST('x' AS CHAR " + modifier + ')'), (error: unknown) => error instanceof ParseError && !error.conditions?.some(e => e.errno === 1287))
  }
})


test('successful grammar warnings are readonly provenance outside AST serialization', () => {
  const ast = parseStatement("SELECT CAST('x' AS NCHAR),CAST('y' AS CHAR BINARY)")
  const history = Cursor.conditions(ast)
  assert.deepEqual(history?.map(c => [c.errno, c.level]), [[3720, 'Warning'], [1287, 'Warning']])
  assert.ok(Object.isFrozen(history))
  assert.equal(Cursor.conditions(ast), history, 'reading a cached root does not consume its provenance')
  assert.equal(Cursor.conditions({ ...ast }), undefined, 'a clone has no parser provenance')
  assert.equal(Cursor.conditions(JSON.parse(JSON.stringify(ast)) as object), undefined)
  assert.ok(Reflect.ownKeys(ast).every(key => typeof key === 'string' && !['conditions', 'warnings', 'grammarWarnings'].includes(key)))
  assert.equal(Cursor.conditions(parseStatement("SELECT 'plain'")), undefined)
})

test('statement sequences retain independent warning snapshots when their cursor advances', () => {
  const sequence = parseStatementSequence("SELECT CAST('x' AS NCHAR); SELECT 'plain'; SELECT CAST('y' AS CHAR BINARY)")
  const first = sequence.next()
  assert.equal(first.done, false)
  if (first.done) throw new Error('expected first statement')
  const history = Cursor.conditions(first.value.statement)
  assert.deepEqual(history?.map(c => c.errno), [3720])
  const second = sequence.next()
  assert.equal(second.done, false)
  if (second.done) throw new Error('expected second statement')
  assert.equal(Cursor.conditions(second.value.statement), undefined)
  const third = sequence.next()
  assert.equal(third.done, false)
  if (third.done) throw new Error('expected third statement')
  assert.deepEqual(Cursor.conditions(third.value.statement)?.map(c => c.errno), [1287])
  assert.equal(sequence.next().done, true)
  assert.equal(Cursor.conditions(first.value.statement), history)
  assert.deepEqual(history?.map(c => c.errno), [3720], 'later parsing cannot append to an earlier history')
})

test('runtime-owned warnings enter failure history without changing successful root provenance', () => {
  const c = new Cursor(lex(''))
  c.warn(1287, 'outside checked parsing', true)
  const root = c.checked(() => {
    c.warn(3720, NATIONAL_DEPRECATION)
    c.checked(() => { c.warn(1287, 'runtime only', true); return {} })
    return {}
  })
  const history = Cursor.conditions(root)
  assert.deepEqual(history, [{ errno: 3720, message: NATIONAL_DEPRECATION, level: 'Warning' }])
  assert.ok(Object.isFrozen(history))
  assert.equal(Cursor.conditions(c.checked(() => { c.warn(1287, 'runtime only', true); return {} })), undefined)
  const fatal = unknown()
  assert.throws(() => c.checked(() => {
    c.warn(1287, 'runtime only', true)
    c.report(fatal)
    c.warn(3720, NATIONAL_DEPRECATION)
    throw overflow()
  }), (error: unknown) => error === fatal)
  assert.deepEqual(fatal.conditions?.map(e => e.errno), [1287, 1273, 3720, 1367])
  assert.equal(Cursor.conditions(c.checked(() => ({}))), undefined)
  assert.equal(Cursor.conditions(root), history, 'later success and failure do not consume cached provenance')

  for (const expression of ["N'x'", "N'x' 'y'", '@x:=1', '@x:=@y:=1', "@x:=N'x'"]) {
    assert.equal(Cursor.conditions(parseStatement('SELECT ' + expression)), undefined, expression)
    assert.equal(Cursor.conditions(parseExpression(expression)), undefined, expression)
    const mixed = parseStatement("SELECT CAST('x' AS CHAR BINARY)," + expression + ",CAST('y' AS NCHAR)")
    assert.deepEqual(Cursor.conditions(mixed)?.map(e => e.errno), [1287, 3720], expression)
    assert.throws(() => parseExpression(expression + '+CAST(1 AS DATETIME(7))'), (error: unknown) => {
      assert.ok(error instanceof ParseError)
      assert.equal(error.errno, 1426)
      const warnings = error.conditions?.filter(e => e.level === 'Warning') ?? []
      assert.deepEqual(warnings.map(e => e.errno), expression.includes("N'") ? [3720] : [], 'assignment warns only after its RHS completes')
      return true
    })
  }
  const sequence = parseStatementSequence("SELECT N'x'; SELECT @x:=1,CAST('x' AS CHAR BINARY); SELECT @x:=N'x',CAST(1 AS TIME(7))")
  const first = sequence.next(), second = sequence.next()
  assert.equal(first.done, false)
  assert.equal(second.done, false)
  if (first.done || second.done) throw new Error('expected completed prefix')
  assert.equal(Cursor.conditions(first.value.statement), undefined)
  assert.deepEqual(Cursor.conditions(second.value.statement)?.map(e => e.errno), [1287])
  assert.throws(() => sequence.next(), (error: unknown) => error instanceof ParseError && String(error.conditions?.map(e => e.errno)) === '3720,1287,1426')
  assert.deepEqual(Cursor.conditions(second.value.statement)?.map(e => e.errno), [1287])
})

test('unary BINARY warns after operand construction and preserves legacy successful provenance', () => {
  for (const expression of ["BINARY 'x'", "BINARY N'x'", 'BINARY (@x:=1)', "BINARY BINARY 'x'"]) {
    assert.equal(Cursor.conditions(parseStatement('SELECT ' + expression)), undefined, expression)
    const mixed = parseStatement("SELECT CAST('x' AS CHAR BINARY)," + expression + ",CAST('y' AS NCHAR)")
    assert.deepEqual(Cursor.conditions(mixed)?.map(e => e.errno), [1287, 3720], expression)
  }
  for (const expression of ['BINARY CAST(1 AS TIME(7))', 'BINARY (@x:=CAST(1 AS TIME(7)))']) {
    assert.throws(() => parseExpression(expression), (error: unknown) => error instanceof ParseError && error.errno === 1426 && error.conditions === undefined)
  }
  assert.throws(() => parseStatement("SELECT BINARY N'x' COLLATE missing,CAST(1 AS TIME(7))"), (error: unknown) => {
    assert.ok(error instanceof ParseError)
    assert.equal(error.errno, 1273)
    assert.deepEqual(error.conditions?.map(e => [e.errno, e.level ?? 'Error']), [[3720, 'Warning'], [1273, 'Error'], [1287, 'Warning'], [1426, 'Error']])
    return true
  })
})

test('explicit utf8mb3 warnings belong to expression construction, not successful provenance or charset resolution', () => {
  const expressions = ["_Utf8mb3'1'", "_utf8mb3 X'31'", "_utf8mb3 B'1'", "CONVERT('1' USING `Utf8mb3`)", "CAST('1' AS CHAR CHARSET 'UTF8MB3')"]
  for (const expression of expressions) {
    assert.equal(Cursor.conditions(parseStatement('SELECT ' + expression)), undefined, expression)
    const mixed = parseStatement("SELECT CAST('x' AS CHAR BINARY)," + expression + ",CAST('y' AS NCHAR)")
    assert.deepEqual(Cursor.conditions(mixed)?.map(e => e.message), [BINARY_DEPRECATION, NATIONAL_DEPRECATION], expression)
    assert.throws(() => parseExpression(expression + '+CAST(1 AS TIME(7))'), (error: unknown) => {
      assert.ok(error instanceof ParseError)
      assert.equal(error.errno, 1426)
      assert.deepEqual(error.conditions?.map(e => e.errno), [1287, 1426])
      assert.match(error.conditions![0]!.message, /^'utf8mb3' is deprecated/)
      return true
    })
  }
  for (const sql of ['CREATE TABLE t(v CHAR CHARSET utf8mb3)', 'SET NAMES utf8mb3']) {
    assert.equal(Cursor.conditions(parseStatement(sql)), undefined, 'independent charset owner: ' + sql)
  }
  for (const sql of ["SELECT _utf8'1',CAST(1 AS TIME(7))", "SELECT CONVERT('1' USING utf8),CAST(1 AS TIME(7))", "SELECT CAST('1' AS CHAR CHARSET utf8),CAST(1 AS TIME(7))"]) {
    assert.throws(() => parseStatement(sql), (error: unknown) => error instanceof ParseError && !error.conditions?.some(e => e.errno === 1287 && e.message.startsWith("'utf8mb3'")), 'written utf8 remains distinct')
  }
  assert.throws(() => parseStatement("SELECT _utf8mb3'1',CAST('1' AS CHAR BINARY CHARSET missing)"), (error: unknown) => {
    assert.ok(error instanceof ParseError)
    assert.equal(error.errno, 1115)
    assert.deepEqual(error.conditions?.map(e => e.errno), [1287, 1115], 'unknown charset suppresses its BINARY attribute warning')
    return true
  })
})
