import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE, ParseError, deparse, parseExpression, parseSqlMode } from '@myjs/parser'
import { withoutPositions } from '../../tools/lib/round-trip.mjs'

test('system-variable components and quoted user names retain their identity when deparsed', () => {
  for (const mode of ['', 'ANSI_QUOTES']) for (const sql of [
    '@@sql_mode', '@@session.`sql_mode`', '@@`session.sql_mode`', "@@local.'sql_mode'",
    '@`@x`', '@`@@x`', '@`a.b`', "@'a b'", '@`a``b`',
  ]) {
    const options = { sqlMode: parseSqlMode(mode) }
    const ast = parseExpression(sql, options)
    assert.deepEqual(withoutPositions(parseExpression(deparse(ast, options), options)), withoutPositions(ast), sql)
  }
  assert.equal(deparse({ kind: NODE.VARIABLE, name: '@@session.sql_mode', at: 0 }), '@@session.sql_mode')
  assert.equal(deparse({ kind: NODE.VARIABLE, name: '@a b', at: 0 }), '@`a b`')
  const scoped = parseExpression('@@session.`sql_mode`')
  const literal = parseExpression('@@`session.sql_mode`')
  assert.equal(scoped.kind, NODE.VARIABLE)
  assert.equal(literal.kind, NODE.VARIABLE)
  if (scoped.kind === NODE.VARIABLE && literal.kind === NODE.VARIABLE) {
    assert.equal(scoped.name, literal.name)
    assert.deepEqual(scoped.parts, ['session', 'sql_mode'])
    assert.deepEqual(literal.parts, ['session.sql_mode'])
  }
})

test('whole string-quoted system variables and a quoted scope fail at the original delimiter', () => {
  for (const mode of ['', 'ANSI_QUOTES']) for (const sql of ["@@'sql_mode'", '@@"sql_mode"', '@@`session`.sql_mode']) {
    assert.throws(() => parseExpression(sql, { sqlMode: parseSqlMode(mode) }), (e: unknown) => e instanceof ParseError && e.offset === 2)
  }
})
