import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LITERAL, NODE, ParseError, parseExpression, parseStatement, type QueryExpression, type SelectNode } from '@myjs/parser'
import { roundTrip } from '../../tools/lib/round-trip.mjs'

test('DATETIME is an identifier with a quoted alias; temporal literal keywords retain their ASTs', () => {
  for (const name of ['DATETIME', 'datetime', '`DATETIME`', 't.datetime']) {
    const sql = 'SELECT ' + name + " 'label' FROM t"
    const statement = parseStatement(sql) as QueryExpression
    const select = statement.body as SelectNode
    assert.deepEqual(select.items[0], { expr: { kind: NODE.COLUMN, parts: name === 't.datetime' ? ['t', 'datetime'] : [name.replaceAll('`', '')], at: 7 }, alias: 'label' })
    assert.equal(roundTrip(statement), null, sql)
  }
  for (const [unit, value] of [['DATE', '2026-10-11'], ['TIME', '01:02:03.123456'], ['TIMESTAMP', '2026-10-11 01:02:03.123456']]) {
    assert.deepEqual(parseExpression(unit + " '" + value + "'"), { kind: NODE.LITERAL, type: LITERAL.TEMPORAL, unit, value, at: 0 })
    assert.equal(roundTrip(parseStatement('SELECT ' + unit + " '" + value + "' AS x")), null)
  }
  assert.equal(roundTrip(parseStatement("SELECT CAST('2026-10-11 01:02:03.123456' AS DATETIME(6)) AS x")), null)
  for (const sql of ["SELECT DATETIME '2026-10-11' AS x", "SELECT datetime'2026-10-11' AS x FROM t LIMIT 0"]) {
    assert.throws(() => parseStatement(sql), error => error instanceof ParseError && error.code === 'ER_PARSE_ERROR', sql)
  }
})
