import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, avgAccumulator, decimalValue as decimal, divide, intValue as int, intDivide, renderDecimal, type DecimalValue } from '@myjs/types'

test('held decimal digits and displayed scale remain independent', () => {
  const zero = decimal(0n, 0, 9)
  assert.equal(zero.scale, 0)
  assert.equal(renderDecimal(zero), '0.000000000')
  const third = divide(int(1n), int(3n)) as DecimalValue
  const inverse = divide(int(1n), third) as DecimalValue
  assert.equal(renderDecimal(decimal(inverse.v, inverse.scale, 18)), '3.000000003000000003')
  for (const cancelled of [add(third, third, '-'), add(third, decimal(-third.v, third.scale, third.display), '+')]) {
    assert.equal((cancelled as DecimalValue).scale, 0)
    assert.equal(renderDecimal(cancelled as DecimalValue), '0.0000')
  }
  assert.equal((add(decimal(0n, 9), decimal(0n, 9), '+') as DecimalValue).scale, 9)
  assert.equal((add(decimal(0n, 9), int(1n), '*') as DecimalValue).scale, 0)
})

test('AVG presentation never adds physical fractional words to its quotient', () => {
  const average = avgAccumulator(true, 30)
  for (const value of [0n, 0n, 1n]) average.add(int(value))
  const value = average.result() as DecimalValue
  assert.equal(value.scale, 9)
  assert.equal(value.display, 34)
  assert.equal(renderDecimal(value), '0.3333333330000000000000000000000000')
})

test('DIV aligns exact operands without rounding before truncating', () => {
  for (let x = -31n; x <= 31n; x++) for (let y = -13n; y <= 13n; y++) {
    const expected = y === 0n ? null : int(x / y)
    assert.deepEqual(intDivide(int(x), int(y)), expected)
    assert.deepEqual(intDivide(decimal(x * 1000n, 3), decimal(y * 10n, 1)), expected)
  }
})
