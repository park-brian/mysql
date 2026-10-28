import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Cursor, NATIONAL_DEPRECATION, NODE, NO_SQL_MODE, ParseError, lex, parseCreateTable, parseExpression, parseStatement, parseStatementBytes, parseStatementSequence } from '@myjs/parser'

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

test('warning collection is scoped, nested and discarded on success or an untyped failure', () => {
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
