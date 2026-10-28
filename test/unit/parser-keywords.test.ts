import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Cursor, NODE, NO_SQL_MODE, ParseError, atDataType, lex, parseDataType, parseExpression, parseStatement } from '@myjs/parser'

test('ASCII keywords and Unicode identifiers keep distinct identities', () => {
  for (const word of ['ſelect', 'ıf', 'falſe', 'caſe', 'unıcode', 'bıNARY']) {
    const c = new Cursor(lex(word))
    assert.equal(c.atWord(word.toUpperCase()), false)
    assert.equal(c.atIdentifier(), true)
    assert.equal(c.expectIdentifier(), word)
  }
  const keyword = new Cursor(lex('sElEcT'))
  assert.equal(keyword.atWord('SELECT'), true)
  assert.equal(keyword.atIdentifier(), false)
  const quoted = new Cursor(lex('`SELECT`'))
  assert.equal(quoted.atWord('SELECT'), false)
  assert.equal(quoted.expectIdentifier(), 'SELECT')
  assert.equal(quoted.atWord(''), false)
})

test('Unicode command and object lookalikes cannot publish a writable AST', () => {
  for (const [sql, word] of [['ſET @x=1', 'ſET'], ['ıNSERT INTO t VALUES(7)', 'ıNSERT'], ['DROP ſCHEMA victim', 'ſCHEMA'], ['CREATE VıEW w AS SELECT 1', 'VıEW']] as const) {
    assert.throws(() => parseStatement(sql), (error: unknown) => error instanceof ParseError && error.errno === 1064 && error.offset === sql.indexOf(word))
  }
})

test('Unicode literal and operator lookalikes remain names', () => {
  assert.equal(parseExpression('falſe').kind, NODE.COLUMN)
  assert.equal(parseExpression('caſe').kind, NODE.COLUMN)
  assert.equal(parseExpression('FALSE').kind, NODE.LITERAL)
  assert.throws(() => parseStatement('SELECT 1 DıV 2'), { errno: 1064 })
  assert.throws(() => parseExpression("TIMESTAMPDIFF(MıNUTE,'2001-01-01','2001-01-02')"), { errno: 1064 })
})

test('datatype admission uses the same keyword identity without consuming an invalid type', () => {
  const c = new Cursor(lex('bıNARY(2)'))
  assert.equal(atDataType(c), false)
  assert.equal(c.at, 0)
  assert.throws(() => parseDataType(c, NO_SQL_MODE), { errno: 1064 })
  assert.equal(c.at, 0)
  assert.equal(parseDataType(new Cursor(lex('bInArY(2)')), NO_SQL_MODE).name, 'BINARY')
})
