import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, toText, type Value } from '@myjs/types'
import { readSlot, type Compiled, type Env } from '../../packages/core/src/sql/compile.ts'
import { groupRows, type AggregateSpec, type GroupPlan } from '../../packages/core/src/sql/group.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

function environment(): Env {
  return {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
}

function sum(index: number, events: string[] = []): AggregateSpec {
  return { name: 'SUM', type: intType(21, true), start() {
    events.push('start')
    let total = 0n
    let count = 0
    return {
      add(row) {
        const value = row[index]
        assert.ok(value?.kind === 'int')
        events.push('add:' + value.v)
        total += value.v
        count++
      },
      result: () => count === 0 ? null : intValue(total),
    }
  } }
}
const shown = (value: Value | undefined): string | null => value == null ? null : toText(value)
const sourceRows = () => [[1, 10], [2, 20], [2, 30]].map((row) => row.map((n) => intValue(BigInt(n))))

test('group outputs own their frames without changing source rows or later groups', () => {
  for (const strategy of ['temp', 'index', 'sort', 'implicit'] as const) {
    const rows = sourceRows()
    const before = rows.map((row) => row.map(shown))
    const plan: GroupPlan = { width: 2, keys: strategy === 'implicit' ? [] : [readSlot(0, intType(11, true))], specs: [sum(1)], strategy, rollup: false }
    const iterator = groupRows(rows.map((row) => ({ row })), plan, environment())
    const first = iterator.next()
    assert.equal(first.done, false)
    assert.ok(first.value)
    assert.equal(shown(first.value.row.at(-1)), strategy === 'implicit' ? '60' : '10')
    assert.ok(rows.every((row) => row !== first.value.row))
    first.value.row[0] = intValue(999n)
    first.value.row[first.value.row.length - 1] = intValue(999n)
    const rest = [...iterator]
    assert.deepEqual(rest.map(({ row }) => shown(row.at(-1))), strategy === 'implicit' ? [] : ['50'])
    assert.ok(rest.every(({ row }) => row !== first.value.row))
    assert.deepEqual(rows.map((row) => row.map(shown)), before)
    assert.equal([...groupRows([], plan, environment())].length, strategy === 'implicit' ? 1 : 0)
  }
})

test('ROLLUP preserves native prefix spelling, independent totals and fresh frames', async () => {
  await loadCollation(255)
  for (const strategy of ['index', 'sort'] as const) {
    const rows = [['a', 1, 10], ['A', 2, 20], ['b', 1, 30]].map(([g, h, n]) => [stringValue(String(g), 255), intValue(BigInt(h!)), intValue(BigInt(n!))])
    const before = rows.map((row) => row.map(shown))
    const plan: GroupPlan = { width: 3, keys: [readSlot(0, stringType(4, 255, true)), readSlot(1, intType(11, true))], specs: [sum(2)], strategy, rollup: true }
    const iterator = groupRows(rows.map((row) => ({ row })), plan, environment())
    const first = iterator.next()
    assert.ok(first.value)
    const view = (row: Value[]) => row.slice(3).map(shown)
    const initial = view(first.value.row)
    first.value.row[0] = stringValue('changed', 255)
    first.value.row[3] = stringValue('changed', 255)
    first.value.row[6] = intValue(999n)
    const rest = [...iterator]
    assert.deepEqual([initial, ...rest.map(({ row }) => view(row))], [
      ['a', '1', '2', '10'], ['A', '2', '2', '20'], ['A', null, '1', '30'],
      ['b', '1', '2', '30'], ['b', null, '1', '30'], [null, null, '0', '60'],
    ])
    assert.equal(new Set([first.value, ...rest].map(({ row }) => row)).size, 6)
    assert.deepEqual(rows.map((row) => row.map(shown)), before)
  }
})

test('cancelling a ROLLUP flush cannot reset or add the next group', () => {
  for (const strategy of ['index', 'sort'] as const) {
    const events: string[] = []
    let read = 0
    let closed = 0
    function* source() {
      try {
        for (const row of sourceRows()) { read++; events.push('read'); yield { row } }
      } finally { closed++ }
    }
    const keys: Compiled[] = [readSlot(0, intType(11, true)), { ...readSlot(0, intType(11, true)), eval(row) { events.push('key'); return row[0] ?? null } }]
    const iterator = groupRows(source(), { width: 2, keys, specs: [sum(1, events)], strategy, rollup: true }, environment())
    const first = iterator.next()
    assert.equal(first.done, false)
    assert.equal(read, strategy === 'index' ? 2 : 3)
    if (strategy === 'sort') assert.deepEqual(events.slice(0, 3), ['read', 'read', 'read'], 'sort reads the source before binding keys')
    const starts = events.filter((event) => event === 'start').length
    const additions = events.filter((event) => event.startsWith('add:'))
    assert.equal(starts, 3)
    assert.deepEqual(additions, ['add:10', 'add:10', 'add:10'])
    iterator.return(undefined)
    assert.equal(closed, 1)
    assert.equal(events.filter((event) => event === 'start').length, starts)
    assert.deepEqual(events.filter((event) => event.startsWith('add:')), additions)
  }
})

test('pinned implicit keys bind after accumulation and empty pinned groups emit nothing', () => {
  const events: string[] = []
  const key: Compiled = { type: intType(11, true), eval(row) { events.push('key'); return row[0] ?? null } }
  const plan: GroupPlan = { width: 2, keys: [key], specs: [sum(1, events)], strategy: 'implicit', rollup: true }
  assert.deepEqual([...groupRows([], plan, environment())], [])
  events.length = 0
  const rows = [[intValue(1n), intValue(10n)], [intValue(1n), intValue(20n)]]
  const result = [...groupRows(rows.map((row) => ({ row })), plan, environment())]
  assert.deepEqual(events, ['start', 'add:10', 'add:20', 'key'])
  assert.deepEqual(result.map(({ row }) => row.slice(2).map(shown)), [['1', '1', '30'], [null, '0', '30']])
})
