import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numericPrefix } from '@myjs/types'

test('numeric prefix validity distinguishes parsed zero from invalid fallback zero', () => {
  for (const text of ['0', '-0', '+.0x', ' \t0e2x', '.5x']) assert.equal(numericPrefix(text).valid, true)
  for (const text of ['', ' ', 'abc1', '+x1', '.x1', '\0' + '1']) assert.equal(numericPrefix(text).valid, false)
})
