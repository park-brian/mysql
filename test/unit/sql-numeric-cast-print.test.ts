import { viewUpdatable } from '../../packages/core/src/sql/view-text.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatement, parseExpression, NODE, quoteName } from '@myjs/parser'
import { printExpression, printString, Unprintable } from '../../packages/core/src/sql/print.ts'

const options = { column: (parts: readonly string[]) => parts.map(quoteName).join('.'), string: printString }
const print = (text: string) => printExpression(parseExpression(text), { ...options, source: text })

test('numeric CAST uses resolved type spelling and decimal defaults', () => {
  for (const [text, expected] of [
    ['CAST(a AS SIGNED INTEGER)', 'cast(`a` as signed)'],
    ['CAST(a AS UNSIGNED INTEGER)', 'cast(`a` as unsigned)'],
    ['CAST(a AS DECIMAL)', 'cast(`a` as decimal(10,0))'],
    ['CAST(a AS DECIMAL(0))', 'cast(`a` as decimal(10,0))'],
    ['CAST(a AS DECIMAL(0,0))', 'cast(`a` as decimal(10,0))'],
    ['CAST(a AS DECIMAL(8))', 'cast(`a` as decimal(8,0))'],
    ['CAST(a AS DECIMAL(8,2))', 'cast(`a` as decimal(8,2))'],
    ['CAST(CAST(a AS SIGNED) AS DECIMAL(8,2))', 'cast(cast(`a` as signed) as decimal(8,2))'],
  ]) assert.equal(print(text!), expected)
})

test('unsupported CAST and child expressions retain controlled refusal', () => {
  for (const text of ['CAST(a AS CHAR(3))', 'CAST(a AS FLOAT)', 'CAST(? AS DECIMAL)', '~a', 'a IN (SELECT 1)']) {
    assert.throws(() => print(text), Unprintable, text)
  }
  const cast = parseExpression('CAST(a AS SIGNED)')
  assert.equal(cast.kind, NODE.CAST)
  assert.throws(() => printExpression({ ...cast, array: true } as typeof cast, options), Unprintable)
  assert.throws(() => printExpression({ ...cast, timeZone: '' } as typeof cast, options), Unprintable)
})

test('connective aliases share flattening while mixed connectives retain grouping', () => {
  assert.equal(print('(a=1) AND ((b=2) && (a=3))'), '((`a` = 1) and (`b` = 2) and (`a` = 3))')
  assert.equal(print('((a=1) OR (b=2)) AND (a=3)'), '(((`a` = 1) or (`b` = 2)) and (`a` = 3))')
  assert.equal(print("a RLIKE '1'"), "regexp_like(`a`,'1')")
  assert.equal(print("a NOT REGEXP '1'"), "(not(regexp_like(`a`,'1')))")
  const text = 'CAST(1e2 AS SIGNED)', expression = parseExpression(text)
  assert.equal(print(text), 'cast(1e2 as signed)')
  assert.equal(printExpression(expression, options), printExpression(expression, { ...options, source: undefined }))
})

test('cold view-module imports retain the full aggregate and nested-query inventory', () => {
  for (const expression of ['STDDEV_POP(a)', 'stddev_samp(a)', 'VAR_POP(a)', 'var_samp(a)', 'SUM(a) OVER ()', '(SELECT COUNT(*) FROM t)']) {
    const statement = parseStatement('SELECT a,' + expression + ' AS x FROM t')
    assert.equal(viewUpdatable(statement as Parameters<typeof viewUpdatable>[0]), false, expression)
  }
  const statement = parseStatement('SELECT a,UPPER(a) AS x FROM t')
  assert.equal(viewUpdatable(statement as Parameters<typeof viewUpdatable>[0]), true)
})
