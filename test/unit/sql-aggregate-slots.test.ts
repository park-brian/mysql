import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { decimalValue, intValue, toText, type Value } from '@myjs/types'
import { compile, decimalField, type CompileContext, type Compiled, type Env } from '../../packages/core/src/sql/compile.ts'
import { AggregateSink } from '../../packages/core/src/sql/group.ts'
import { intType } from '../../packages/core/src/sql/meta.ts'
import { WindowSink } from '../../packages/core/src/sql/window.ts'

test('grouped slots share pure readers while copies and accumulator lifetimes remain independent', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: () => ({ index: 0, type: intType(11, true) }) },
  }
  const sink = new AggregateSink(ctx, 2)
  const grouped = { ...ctx, aggregates: sink }
  const bind = (sql: string): Compiled => compile(parseExpression(sql), grouped)
  const first = bind('AVG(n)')
  assert.equal(bind('AVG(n)'), first)
  for (const sql of ['+AVG(n)', '++AVG(n)']) assert.equal(bind(sql), first, sql)
  const readers: readonly Compiled[] = sink.specs
  for (const sql of ['ABS(AVG(n))', 'ANY_VALUE(AVG(n))', 'NULLIF(AVG(n),-1)', 'CAST(AVG(n) AS DECIMAL(24,14))', 'CAST(AVG(n) AS CHAR) COLLATE utf8mb4_0900_ai_ci', 'IF(1,AVG(n),AVG(n))', 'CASE WHEN 1 THEN AVG(n) ELSE AVG(n) END']) {
    assert.equal(readers.includes(bind(sql)), false, sql)
  }
  assert.equal(bind('ANY_VALUE(AVG(n))').eval, first.eval, 'shared evaluation alone does not prove slot ownership')
  assert.notEqual(bind('AVG(DISTINCT n)'), first)
  const other = new AggregateSink(ctx, 2)
  assert.notEqual(compile(parseExpression('AVG(n)'), { ...ctx, aggregates: other }), first)

  const value = decimalValue(1250000000n, 9, 4)
  const row: Value[] = [null, null, value]
  Object.defineProperty(row, 0, { get: () => { throw Error('a result reader evaluated its aggregate argument') } })
  assert.equal(first.eval(row, env), value)
  const copied = decimalField({ ...first, type: { ...first.type, temporary: 'pinned', ownInTemporary: false } })
  assert.equal(readers.includes(copied), false)
  assert.equal(first.type.temporary, undefined)
  assert.equal(first.type.ownInTemporary, true)
  assert.equal(bind('AVG(n)'), first)
  assert.equal(first.eval(row, env), value)
  assert.deepEqual(copied.eval(row, env), decimalValue(12500n, 4))

  const a = sink.specs[0]!.start()
  const b = sink.specs[0]!.start()
  a.add([intValue(1n)], env)
  b.add([intValue(5n)], env)
  a.add([intValue(3n)], env)
  const left = a.result()
  const right = b.result()
  assert.ok(left !== null && right !== null)
  assert.equal(toText(left), '2.0000')
  assert.equal(toText(right), '5.0000')

  const count = sink.specs.length
  const windows = new WindowSink(grouped, 4)
  const window = compile(parseExpression('AVG(n) OVER ()'), { ...grouped, windows })
  assert.equal(readers.includes(window), false)
  assert.equal(sink.specs.length, count)
  assert.equal(windows.windows.length, 1)
})
