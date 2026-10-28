import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BINARY_DEPRECATION, Cursor, NO_SQL_MODE, ParseError, lex, parseDataType, parseExpression, parseStatement } from '@myjs/parser'

test('column and cast targets keep their own COLLATE boundaries', () => {
  const c = new Cursor(lex('CHAR(2) COLLATE utf8mb4_bin CHARACTER SET utf8mb4'))
  const type = parseDataType(c, NO_SQL_MODE)
  assert.equal(type.collation, 'utf8mb4_bin')
  assert.equal(type.charset, 'utf8mb4')
  assert.equal(c.atEnd(), true)
  const target = new Cursor(lex('CHAR(2) COLLATE missing'))
  assert.equal(parseDataType(target, NO_SQL_MODE, false).name, 'CHAR')
  assert.equal(target.atWord('COLLATE'), true)
  for (const sql of ["SELECT CAST('x' AS CHAR COLLATE missing)", "SELECT CONVERT('x', CHAR COLLATE utf8mb4_bin)"]) {
    assert.throws(() => parseStatement(sql), { errno: 1064 })
  }
  assert.throws(() => parseStatement("SELECT 1 COLLATE earlier,CAST('x' AS CHAR COLLATE missing),1e309"), (error: unknown) => {
    assert.ok(error instanceof ParseError)
    assert.equal(error.errno, 1273)
    assert.deepEqual(error.conditions?.map(c => c.errno), [1273, 1064])
    return true
  })
})

test('ZEROFILL always supplies the signedness that CAST refuses, including repeated modifiers', () => {
  for (const text of ['CHAR ZEROFILL', 'DECIMAL ZEROFILL', 'FLOAT ZEROFILL', 'CHAR ZEROFILL SIGNED', 'DECIMAL SIGNED ZEROFILL', 'DECIMAL ZEROFILL SIGNED']) {
    const type = parseDataType(new Cursor(lex(text)), NO_SQL_MODE)
    assert.equal(type.zerofill, true)
    assert.equal(type.unsigned, !text.endsWith(' SIGNED'))
    assert.throws(() => parseExpression("CAST('x' AS " + text + ')'), { errno: 1064 })
  }
})

test('CAST character modifiers are bounded independently of column modifiers', () => {
  for (const text of ['CHAR BINARY', 'CHAR ASCII', 'CHAR BYTE', 'CHAR CHARACTER SET utf8mb4 BINARY', 'CHAR BINARY CHARSET utf8mb4']) {
    assert.doesNotThrow(() => parseExpression("CAST('x' AS " + text + ')'))
    assert.doesNotThrow(() => parseExpression("CONVERT('x', " + text + ')'))
  }
  for (const text of ['CHAR BINARY BINARY', 'CHAR ASCII ASCII', 'CHAR BYTE BINARY', 'CHAR BINARY CHARACTER SET utf8mb4 BINARY', 'CHAR CHARACTER SET utf8mb4 CHARACTER SET unknown', 'NCHAR BINARY', 'NCHAR CHARACTER SET unknown', 'DECIMAL SIGNED', 'FLOAT UNSIGNED', 'BINARY BYTE']) {
    for (const sql of ["CAST('x' AS " + text + ')', "CONVERT('x', " + text + ')']) assert.throws(() => parseExpression(sql), { errno: 1064 })
  }
  const byte = parseDataType(new Cursor(lex('CHAR(2) BYTE')), NO_SQL_MODE, false)
  assert.equal(byte.charset, 'binary')
  assert.equal(byte.binary, undefined)
  assert.equal(parseDataType(new Cursor(lex('CHAR BYTE')), NO_SQL_MODE, false).name, 'BINARY')
  const column = new Cursor(lex('CHAR ASCII ASCII BINARY BINARY'))
  assert.equal(parseDataType(column, NO_SQL_MODE).binary, true)
  assert.equal(column.atEnd(), true)
})

test('modifier refusal keeps preceding warnings and stops before later charset lookup', () => {
  for (const expression of ["CAST('x' AS NCHAR CHARACTER SET unknown)", "CONVERT('x', NCHAR BINARY)"]) {
    assert.throws(() => parseExpression(expression), (error: unknown) => error instanceof ParseError && error.errno === 1064 && String(error.conditions?.map(c => c.errno)) === '3720,1064')
  }
  assert.throws(() => parseStatement("SELECT 1 COLLATE earlier,CAST('x' AS CHAR CHARACTER SET utf8mb4 CHARACTER SET unknown),1e309"), (error: unknown) => error instanceof ParseError && error.errno === 1273 && String(error.conditions?.map(c => c.errno)) === '1273,1064')
})

test('CAST BINARY warnings reduce after a valid charset and before later refusal', () => {
  for (const expression of ["CAST('x' AS CHAR BINARY BINARY)", "CONVERT('x', CHAR CHARACTER SET utf8mb4 BINARY BINARY)", "CAST('x' AS CHAR BINARY) + (1 COLLATE missing)"]) {
    assert.throws(() => parseExpression(expression), (error: unknown) => {
      assert.ok(error instanceof ParseError)
      assert.deepEqual(error.conditions?.[0], { errno: 1287, message: BINARY_DEPRECATION, level: 'Warning' })
      assert.equal(error.conditions?.length, 2)
      assert.equal(error.conditions?.[1]?.errno, error.errno)
      return true
    })
  }
  for (const type of ['CHAR BINARY CHARACTER SET unknown', 'CHAR BINARY CHARSET unknown', 'CHAR BINARY CHARACTER', 'CHAR BINARY CHARACTER what', 'CHAR BINARY CHARACTER SET']) {
    assert.throws(() => parseExpression("CAST('x' AS " + type + ')'), (error: unknown) => error instanceof ParseError && error.conditions === undefined)
  }
  assert.throws(() => parseStatement("SELECT 1 COLLATE earlier,CAST('x' AS CHAR BINARY BINARY)"), (error: unknown) => error instanceof ParseError && error.errno === 1273 && String(error.conditions?.map(c => c.errno)) === '1273,1287,1064')
})

test('adjacent literal reading is explicit, while ENUM preserves text and byte members', () => {
  const single = new Cursor(lex("'a' /* separator */ 'b'"))
  assert.equal(single.expectString(), 'a')
  assert.equal(single.expectString(), 'b')
  const adjacent = new Cursor(lex("'a' /* separator */ 'b'"))
  assert.equal(adjacent.expectString(true), 'ab')
  assert.equal(adjacent.atEnd(), true)
  const type = parseDataType(new Cursor(lex("ENUM('a' 'b',0x63,b'1100100')")), NO_SQL_MODE)
  assert.deepEqual(type.values, ['ab', Uint8Array.of(99), Uint8Array.of(100)])
  assert.throws(() => parseStatement("CREATE TABLE t(a INT COMMENT 'a' 'b')"), { errno: 1064 })
})

test('public modifier-only datatype reading remains separate from CAST target admission', () => {
  const c = new Cursor(lex('INT(4) UNSIGNED'))
  const type = parseDataType(c, NO_SQL_MODE, false)
  assert.equal(type.name, 'INT')
  assert.equal(type.length, 4)
  assert.equal(type.unsigned, undefined)
  assert.equal(c.atWord('UNSIGNED'), true)
  assert.throws(() => parseExpression('CAST(1 AS INT(4))'), { errno: 1064 })
  for (const name of ['SIGNED', 'UNSIGNED']) {
    assert.throws(() => parseDataType(new Cursor(lex(name)), NO_SQL_MODE, false), { errno: 1064 })
    assert.equal(parseExpression(`CAST(1 AS ${name} INTEGER)`).kind, 'cast')
  }
})
