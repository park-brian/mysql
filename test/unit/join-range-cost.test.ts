import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestAccess, type KeyChoice, type Position, type TableFacts } from '../../packages/core/src/sql/cost.ts'

const prefix: Position[] = [{ alias: 'pa', fetched: 20, filter: 1, keyFrom: new Set() }]
const key: KeyChoice = { index: 'lookup_key', kind: 'ref', fanout: 32, covering: false, recordBytes: 9, keyFrom: new Set(['pa']) }
const facts: TableFacts = {
  stats: { rows: 64, pages: 1, recordsPerKey: () => 32 },
  constantFilter: 2 / 64, coveredByAnyIndex: false,
  // Pinned non-covering two-row range: 0.25 * (1 + 2) + 0.1 * 2 + 0.01.
  range: { index: 'range_key', rows: 2, cost: 0.96 },
}

test('a selected range repeats for every prefix row with either buffering setting', () => {
  for (const buffered of [true, false]) for (const covering of [true, false]) {
    const access = bestAccess({ ...facts, coveredByAnyIndex: covering }, prefix, key, 8, buffered)
    assert.equal(access.lookup, false)
    assert.equal(access.fetched, 2)
    assert.ok(Math.abs(access.read - 19.2) < 1e-10)
  }
})

test('range pricing pays discarded-row evaluation before the join evaluates survivors', () => {
  const access = bestAccess({ ...facts, constantFilter: 1 / 64 }, prefix, key, 8)
  assert.equal(access.lookup, false)
  assert.equal(access.fetched, 1)
  assert.ok(Math.abs(access.read - 21.2) < 1e-10)
  assert.ok(Math.abs(access.read + 0.1 * 20 - 23.2) < 1e-10)
})

test('compatible ref access retains native range and covering-index heuristics', () => {
  assert.equal(bestAccess(facts, prefix, { ...key, index: 'range_key' }, 8).lookup, true)
  assert.equal(bestAccess(facts, [], { ...key, kind: 'unique', fanout: 1 }, 8).lookup, true)
  const { range, ...scan } = facts
  assert.ok(range)
  assert.equal(bestAccess({ ...scan, coveredByAnyIndex: true }, prefix, key, 8).lookup, true)
})
