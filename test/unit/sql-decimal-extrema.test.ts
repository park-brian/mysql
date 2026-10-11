import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('string extrema read each argument once, stop at NULL and own DECIMAL diagnostics', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: parts => parts[0] === 'g' ? { index: 2, type: intType(11,false) } : { index: parts[0] === 'a' ? 0 : parts[0] === 'b' ? 1 : 3, type: stringType(8,255,true) } },
  }
  const sources: [string, string, string[], string[]][] = [
    ['GREATEST(a,b)','0',['a','b'],['a']],
    ['LEAST(a,b)','zz',['a','b'],['a']],
    ["GREATEST(a,'')",'0',['a'],['a']],
    ['LEAST(a,a)','0',['a','a'],['a']],
    ["GREATEST(CONCAT(a),'')",'0',['a'],['a']],
    ["GREATEST(IF(g=1,a,c),'')",'0',['g','a'],['g','a']],
    ["LEAST(CASE g WHEN 1 THEN a ELSE c END,a)",'0',['g','a','a'],['g','a']],
    ["IF(g=1,GREATEST(a,''),c)",'0',['g','a'],['g','a']],
    ["NULLIF(GREATEST(a,''),'zz')",'0',['a','a'],['a','a']],
  ]
  for (const [sql,right,order,nullOrder] of sources) {
    const calls: string[] = []
    let selected: Value = stringValue('123x',255)
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return selected } },
      1: { get: () => { calls.push('b'); return stringValue(right,255) } },
      2: { get: () => { calls.push('g'); return intValue(1n) } },
      3: { get: () => { throw Error('unselected argument evaluated') } },
    })
    const normal = compile(parseExpression(sql),ctx)
    const fresh = (): Env & { conditions: Condition[] } => ({ ...env, memo: new Map(), conditions: [] as Condition[] })
    const first = fresh()
    const value = normal.eval(row,first)
    assert.ok(value !== null,sql)
    assert.equal(toText(value),'123x',sql)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(first.conditions,[],sql)
    const decimal = compile(parseExpression('CAST(' + sql + ' AS DECIMAL(65,0))'),ctx)
    const next = fresh()
    const number = decimal.eval(row,next)
    assert.ok(number !== null,sql)
    assert.equal(toText(number),'123',sql)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(next.conditions,[],sql)
    selected = null
    assert.equal(decimal.eval(row,fresh()),null,sql)
    assert.deepEqual(calls.splice(0),nullOrder,sql)
    selected = stringValue('abc1',255)
    const checked = asNumber(normal,'DECIMAL',true)
    for (let statement=0;statement<2;statement++) {
      const conditions = fresh()
      checked.eval(row,conditions)
      checked.eval(row,conditions)
      assert.deepEqual(calls.splice(0),[...order,...order],sql)
      assert.deepEqual(conditions.conditions.map(c => c.code),[1366],sql)
    }
  }
  for (const sql of [
    "GREATEST(CAST(a AS DECIMAL(10,0)),CAST(b AS DECIMAL(10,0)))",
    "GREATEST(a,DATE'2026-10-11')",
    "GREATEST(a,TIME'12:34:56')",
    "GREATEST(a,CAST('123' AS JSON))",
  ]) assert.equal(compile(parseExpression(sql),ctx).decimalPrefix,undefined,sql)
})
