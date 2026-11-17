import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { MERGE_TYPES, mergeTypes } from '@myjs/types'

test('M5.2: the result type table preserves every ordered MySQL pair', () => {
  assert.equal(mergeTypes('LONGLONG', 'FLOAT'), 'DOUBLE')
  assert.equal(mergeTypes('FLOAT', 'LONGLONG'), 'FLOAT')
  const results = MERGE_TYPES.flatMap((a) => MERGE_TYPES.map((b) => mergeTypes(a, b)))
  const digest = createHash('sha256').update(JSON.stringify([MERGE_TYPES, results])).digest('hex')
  assert.equal(digest, '51b1fac7b1a11111fce24d2461ad4989334d1926968102197cce97cbbb88e378')
})
