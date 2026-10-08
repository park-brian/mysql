// M5.3 — each Volcano operator over a fixed row source, with no table behind it:
// the item's done-when, and the reason the operators take any iterable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { Session, capabilities, utf8Transcoder } from '@myjs/protocol'
import { intValue, stringValue, toText, type Value } from '@myjs/types'
import type { Compiled, Env } from '../../packages/core/src/sql/compile.ts'
import { distinct, filter, limit, project, sort } from '../../packages/core/src/sql/operators.ts'
import { intType } from '../../packages/core/src/sql/meta.ts'

const session = new Session({ connectionId: 1, capabilities: capabilities(0), transcoder: utf8Transcoder })
const env: Env = {
  params: [],
  now: new Date(0),
  session,
  state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
}
const s = (v: string) => stringValue(v, 255)
const n = (v: number) => intValue(BigInt(v))
const column = (i: number): Compiled => ({ eval: (row) => row[i] ?? null, type: intType(11, true) })
const show = (rows: Iterable<{ row: readonly Value[] } | Value[]>): string[] =>
  [...rows].map((r) => ('row' in r ? r.row : r).map((v) => (v === null ? 'NULL' : toText(v))).join(','))

const rows = (...values: (readonly Value[])[]) => values.map((row) => ({ row }))

test.before(async () => {
  await loadCollation(255)
})

test('M5.3: filter keeps a row only when its predicate is TRUE, not FALSE and not NULL', () => {
  const source = rows([n(1)], [n(0)], [null], [n(2)])
  assert.deepEqual(show(filter(source, column(0), env)), ['1', '2'])
  assert.deepEqual(show(filter(source, undefined, env)), ['1', '0', 'NULL', '2'])
})

test('M5.3: sort orders by collation, NULL first ascending and last descending, and is stable', () => {
  const source = rows([s('b'), n(1)], [null, n(2)], [s('A'), n(3)], [s('a'), n(4)], [s('B'), n(5)])
  // utf8mb4_0900_ai_ci: case does not distinguish, so 'A' and 'a' tie and keep their order.
  assert.deepEqual(show(sort(source, [{ expr: column(0), desc: false }], env)), ['NULL,2', 'A,3', 'a,4', 'b,1', 'B,5'])
  assert.deepEqual(show(sort(source, [{ expr: column(0), desc: true }], env)), ['b,1', 'B,5', 'A,3', 'a,4', 'NULL,2'])
  // A second key breaks the first's ties.
  assert.deepEqual(show(sort(source, [{ expr: column(0), desc: false }, { expr: column(1), desc: true }], env)), ['NULL,2', 'a,4', 'A,3', 'B,5', 'b,1'])
})

test('M5.3: project, distinct and limit', () => {
  const source = rows([n(1), s('x')], [n(2), s('X')], [n(1), s('y')])
  assert.deepEqual(show(project(source, [column(1)], env)), ['x', 'X', 'y'])
  // DISTINCT compares as the collation does: 'x' and 'X' are one value.
  assert.deepEqual(show(distinct(project(source, [column(1)], env))), ['x', 'y'])
  assert.deepEqual(show(limit(source, 1, 1)), ['2,X'])
  assert.deepEqual(show(limit(source, 0, 0)), [])
  assert.deepEqual(show(limit(source, 2, undefined)), ['1,y'])
})

test('M5.3: limit stops pulling from its source — a LIMIT 1 over an endless scan returns', () => {
  function* endless() {
    for (let i = 0; ; i++) yield { row: [n(i)] }
  }
  assert.deepEqual(show(limit(filter(endless(), column(0), env), 0, 2)), ['1', '2'])
})
