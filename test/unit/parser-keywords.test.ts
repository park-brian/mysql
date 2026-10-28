import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Cursor, NODE, NO_SQL_MODE, ParseError, atDataType, lex, nativeFunctionWord, parseDataType, parseExpression, parseSqlMode, parseStatement } from '@myjs/parser'

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

test('interval units share keyword identity and retain their canonical spelling', () => {
  const e = parseExpression("DATE_ADD('2001-02-03',INTERVAL 1 dAy)")
  assert.ok(e.kind === NODE.CALL)
  const interval = e.args[1]
  assert.ok(interval?.kind === NODE.INTERVAL)
  assert.equal(interval.unit, 'DAY')
  for (const mode of ['', 'ANSI_QUOTES']) for (const unit of ['`DAY`', '"DAY"', 'MıNUTE', 'ſECOND']) {
    assert.throws(() => parseStatement("SELECT DATE_ADD('2001-02-03',INTERVAL 1 " + unit + ')', { sqlMode: parseSqlMode(mode) }), { errno: 1064 })
  }
})

test('event schedules refuse Unicode keyword lookalikes before storing a program', () => {
  parseStatement('CREATE EVENT e ON SCHEDULE EVERY 1 mInUtE DISABLE DO SET @x=1')
  for (const unit of ['MıNUTE', 'ſECOND', '`DAY`']) {
    assert.throws(() => parseStatement('CREATE EVENT e ON SCHEDULE EVERY 1 ' + unit + ' DISABLE DO SET @x=1'), { errno: 1064 })
  }
})

test('resource selectors use the same keyword rule for first and subsequent limits', () => {
  for (const name of ['MAX_QUERIES_PER_HOUR', 'MAX_UPDATES_PER_HOUR', 'MAX_CONNECTIONS_PER_HOUR', 'MAX_USER_CONNECTIONS']) {
    parseStatement("CREATE USER u WITH " + name.toLowerCase() + ' 1')
    const lookalike = name.replaceAll('S', 'ſ').replaceAll('I', 'ı')
    for (const prefix of ['', 'MAX_QUERIES_PER_HOUR 2 ']) {
      assert.throws(() => parseStatement('CREATE USER u WITH ' + prefix + lookalike + ' 1'), { errno: 1064 })
    }
  }
})


test('M5.10: native function eligibility preserves raw generic and reserved names', () => {
  for (const name of ['ſUM', '雪', '12f', '', 'X Y', 'X`Y', 'CASE', 'SELECT']) assert.equal(nativeFunctionWord(name), '', name)
  for (const name of ['missing_fn', 'sin', 'SUM', 'INTERVAL', 'IF', '$name', '_name']) assert.equal(nativeFunctionWord(name), name.toUpperCase(), name)
  for (const name of ['CASE', 'SELECT', 'SUM', 'INTERVAL']) {
    const call = parseExpression('`' + name + '`(1)')
    assert.equal(call.kind, NODE.CALL)
    assert.equal('stored' in call && call.stored, true, name)
  }
  const generic = parseExpression('12f(1)')
  assert.equal(generic.kind, NODE.CALL)
  assert.equal('name' in generic && generic.name, '12f')
})
