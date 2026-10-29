import { test } from 'node:test'
import assert from 'node:assert/strict'
import { materializedAntijoinWins, type Positioned } from '../../packages/core/src/sql/cost.ts'

const position = (read: number, fetched: number): Positioned => ({
  alias: 't', read, fetched, filter: 1, keyFrom: new Set(), lookup: true,
})

test('equal reported temporary costs can hide a cheaper weedout cost', () => {
  // The captured 1.9 / 1.9 boundary accumulates as 1.9000000000000004
  // for materialization and 1.9 for weedout. Do not round the comparison.
  assert.equal(materializedAntijoinWins(position(0.25, 1), position(0.25, 1), position(0.25, 1)), false)
})

test('an actual full-cost tie keeps the earlier materialized candidate', () => {
  // Both full costs are 4.1. Cancelling common charges and applying a
  // strict comparison to the remainder would incorrectly decline this.
  assert.equal(materializedAntijoinWins(position(0.25, 3), position(0.75, 2.5), position(0.25, 10)), true)
})
