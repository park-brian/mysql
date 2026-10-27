import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, decimalValue as decimal, decimalFractionCapacity, divide, doubleToDecimal, intValue as int, magnitudeDigits, pow10, renderDecimal, type DecimalValue } from '@myjs/types'
import { decimalIntegerDigits } from '../../packages/types/src/sql-value.ts'

test('decimal capacity reserves whole integer words and keeps leading-word ties', () => {
  const seventh = divide(decimal(pow10(30), 30), int(7n)) as DecimalValue
  const near = add(seventh, decimal(1n, 30), '+')!
  const far = add(seventh, decimal(1n, 3), '+')!
  for (const sign of [1n, -1n]) {
    const numerator = decimal(sign * seventh.v, seventh.scale)
    assert.equal((divide(numerator, near) as DecimalValue).scale, 72)
    assert.equal((divide(numerator, far) as DecimalValue).scale, 81)
    const wide = divide(decimal(sign * pow10(64), 0), decimal(1n, 16)) as DecimalValue
    assert.deepEqual(wide, decimal(sign * pow10(80), 0))
  }
})

test('division keeps zero presentation without retaining underflow words or resolving cold labels', () => {
  let labels = 0
  const label = () => { labels++; return '(wide / tiny)' }
  const underflow = divide(decimal(1n, 30), decimal(pow10(64), 0), label)
  assert.deepEqual(underflow, decimal(0n, 0, 30))
  assert.deepEqual(divide(decimal(0n, 30), decimal(1n, 100), label), decimal(0n, 0, 30))
  assert.equal(divide(int(1n), int(0n), label), null)
  assert.equal(labels, 0)
  assert.throws(() => divide(decimal(pow10(64), 0), decimal(1n, 17), label), {
    code: 'ER_DATA_OUT_OF_RANGE', errno: 1690, sqlState: '22003',
    message: "DECIMAL value is out of range in '(wide / tiny)'",
  })
  assert.equal(labels, 1)
})

test('coefficient magnitude and integer precision are independent of sign and display', () => {
  for (const sign of [1n, -1n]) for (const scale of [0, 1, 3, 9, 30]) {
    const value = decimal(sign * 123n, scale, 40)
    assert.equal(magnitudeDigits(value.v), '123')
    assert.equal(decimalIntegerDigits(value), Math.max(0, 3 - scale))
  }
  assert.equal(decimalIntegerDigits(decimal(0n, 30)), 0)
  for (const [digits, capacity] of [[-10, 81], [0, 81], [1, 72], [9, 72], [10, 63], [81, 0], [82, -9]]) {
    assert.equal(decimalFractionCapacity(digits!), capacity)
  }
})

test('decimal rendering preserves rounded signs, integer digits and independent display padding', () => {
  for (const [value, expected] of [
    [decimal(12n, 0), '12'], [decimal(-12n, 0), '-12'],
    [decimal(12n, 0, 3), '12.000'], [decimal(-125n, 2, 1), '-1.3'],
    [decimal(1n, 3), '0.001'], [decimal(-1n, 3), '-0.001'],
    [decimal(-1n, 30, 0), '0'], [decimal(0n, 0, 4), '0.0000'],
  ] as const) assert.equal(renderDecimal(value), expected)
})

test('double expansion retains exact shortest digits without imposing a reader buffer', () => {
  for (const [value, coefficient, scale] of [
    [0, 0n, 0], [-0, 0n, 0], [1.25, 125n, 2], [-1.25, -125n, 2],
    [1e21, pow10(21), 0], [1e-7, 1n, 7], [1e-100, 1n, 100],
    [Number.MIN_VALUE, 5n, 324], [Number.MAX_VALUE, 17976931348623157n * pow10(292), 0],
  ] as const) assert.deepEqual(doubleToDecimal(value), decimal(coefficient, scale))
})
