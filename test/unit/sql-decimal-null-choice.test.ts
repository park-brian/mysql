import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { stringValue, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { stringType } from '../../packages/core/src/sql/meta.ts'

test('null-choice readers evaluate each argument once, stop at the selected value and keep warning lifetime', async () => {
  await loadCollation(255)
  const conditions: Condition[] = []
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions,
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: (parts) => ({ index: ['a','b','c'].indexOf(parts[0] as string), type: stringType(8,255,true) }) },
  }
  for (const sql of ['IFNULL(a,b)', 'COALESCE(a,b,c)', 'IFNULL(COALESCE(a,b,c),c)', 'COALESCE(IFNULL(a,b),c)']) {
    const calls: string[] = []
    let selected: Value = stringValue('123x',255)
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return null } },
      1: { get: () => { calls.push('b'); return selected } },
      2: { get: () => { throw Error('unselected argument evaluated') } },
    })
    const result = compile(parseExpression(sql),ctx)
    assert.deepEqual(result.eval(row,env),selected)
    assert.deepEqual(calls.splice(0),['a','b'])
    const checked = asNumber(result,'DECIMAL',true)
    assert.deepEqual(checked.eval(row,env),selected)
    assert.deepEqual(calls.splice(0),['a','b'])
    assert.equal(conditions.length,0)
    selected = stringValue('abc1',255)
    const next = { ...env, memo: new Map(), conditions: [] as Condition[] }
    checked.eval(row,next)
    checked.eval(row,next)
    assert.deepEqual(calls.splice(0),['a','b','a','b'])
    assert.equal(next.conditions.length,1)
    assert.equal(next.conditions[0]?.code,1366)
  }
})
