import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('ANY_VALUE owns its prefix without delegating branch readers or repeating argument effects', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: parts => parts[0] === 'g' ? { index: 1, type: intType(11,false) } : { index: parts[0] === 'a' ? 0 : 2, type: stringType(8,255,true) } },
  }
  for (const sql of ['ANY_VALUE(a)', 'ANY_VALUE(IF(g=1,a,b))', 'ANY_VALUE(CASE g WHEN 1 THEN a ELSE b END)', 'IF(g=1,ANY_VALUE(a),b)', 'CASE g WHEN 1 THEN ANY_VALUE(a) ELSE b END', 'ANY_VALUE(COALESCE(a,b))', 'ANY_VALUE(LOWER(a))']) {
    const calls: string[] = []
    let selected: Value = stringValue('123x',255)
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return selected } },
      1: { get: () => { calls.push('g'); return intValue(1n) } },
      2: { get: () => { throw Error('unselected branch evaluated') } },
    })
    const result = compile(parseExpression(sql),ctx)
    const order = sql.includes('g=1') || sql.includes('CASE g') ? ['g','a'] : ['a']
    const normal = result.eval(row,env)
    assert.ok(normal !== null)
    assert.equal(toText(normal),'123x')
    assert.deepEqual(calls.splice(0),order,sql)
    const checked = asNumber(result,'DECIMAL',true)
    const first = { ...env, memo: new Map(), conditions: [] as Condition[] }
    checked.eval(row,first)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(first.conditions,[])
    selected = stringValue('abc1',255)
    const next = { ...env, memo: new Map(), conditions: [] as Condition[] }
    checked.eval(row,next)
    checked.eval(row,next)
    assert.deepEqual(calls.splice(0),[...order,...order],sql)
    assert.deepEqual(next.conditions.map(c => c.code),[1366],sql)
    const again = { ...env, memo: new Map(), conditions: [] as Condition[] }
    checked.eval(row,again)
    assert.deepEqual(again.conditions.map(c => c.code),[1366],sql)
    assert.deepEqual(calls.splice(0),order,sql)
    if (!sql.includes('COALESCE')) {
      selected = null
      const empty = { ...env, memo: new Map(), conditions: [] as Condition[] }
      assert.equal(checked.eval(row,empty),null,sql)
      assert.deepEqual(calls.splice(0),order,sql)
      assert.deepEqual(empty.conditions,[])
    }
  }
  for (const sql of ['ANY_VALUE(IF(TRUE,18446744073709551615,0e0))', 'ANY_VALUE(CASE WHEN TRUE THEN 18446744073709551615 ELSE 0e0 END)']) {
    const result = compile(parseExpression(sql),ctx)
    assert.equal(result.decimalOf,undefined,sql)
    assert.equal(result.type.kind,'double',sql)
    const value = asNumber(result,'DECIMAL').eval([],env)
    assert.ok(value?.kind === 'double',sql)
    assert.equal(value.v,Number(18446744073709551615n),sql)
  }
})
