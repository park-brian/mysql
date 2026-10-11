import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('NULLIF separately reads its original result, including after a NULL comparison', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: parts => parts[0] === 'g' ? { index: 2, type: intType(11,false) } : { index: parts[0] === 'a' ? 0 : 1, type: stringType(8,255,true) } },
  }
  const sources: [string, string[], string[]][] = [
    ['NULLIF(a,b)', ['a'], []],
    ['NULLIF(CONCAT(a),b)', ['a'], []],
    ['NULLIF(IF(g=1,a,NULL),b)', ['g','a'], []],
    ['NULLIF(CASE g WHEN 1 THEN a END,b)', ['g','a'], []],
    ['IF(g=1,NULLIF(a,b),NULL)', ['a'], ['g']],
    ['COALESCE(NULLIF(a,b),NULL)', ['a'], []],
    ['ANY_VALUE(NULLIF(a,b))', ['a'], []],
  ]
  for (const [sql,argument,outer] of sources) for (const decimal of [false,true]) for (const first of [null,'zz','abc1']) {
    const calls: string[] = []
    let reads = 0
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => {
        calls.push('a')
        reads++
        if (reads === 1) return first === null ? null : stringValue(first,255)
        if (first === 'zz') throw Error('equal comparison read the result')
        return stringValue('123x',255)
      } },
      1: { get: () => {
        calls.push('b')
        if (first === null) throw Error('NULL comparison read the right argument')
        return stringValue('zz',255)
      } },
      2: { get: () => { calls.push('g'); return intValue(1n) } },
    })
    const result = compile(parseExpression(sql),ctx)
    const reader = decimal ? compile(parseExpression('CAST(' + sql + ' AS DECIMAL(65,0))'),ctx) : result
    const statement = { ...env, memo: new Map(), conditions: [] as Condition[] }
    const value = reader.eval(row,statement)
    if (first === 'zz') assert.equal(value,null,sql)
    else {
      assert.ok(value !== null,sql)
      assert.equal(toText(value),decimal ? '123' : '123x',sql)
    }
    assert.deepEqual(calls,[...outer,...argument,...(first === null ? [] : ['b']),...(first === 'zz' ? [] : argument)],sql)
    const warning = decimal && first !== 'zz' && !sql.includes('CONCAT') && !sql.includes('COALESCE') && !sql.includes('ANY_VALUE') ? [1292] : []
    assert.deepEqual(statement.conditions.map(c => c.code),warning,sql)
  }
  for (const [sql,code] of [['NULLIF(a,b)',1292],['NULLIF(CONCAT(a),b)',1366]] as const) {
    const calls: string[] = []
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return stringValue('abc1',255) } },
      1: { get: () => { calls.push('b'); return stringValue('zz',255) } },
    })
    const result = compile(parseExpression(sql),ctx)
    const reader = asNumber(result,'DECIMAL',true)
    for (let statement=0;statement<2;statement++) {
      const fresh = { ...env, memo: new Map(), conditions: [] as Condition[] }
      reader.eval(row,fresh)
      reader.eval(row,fresh)
      assert.deepEqual(calls.splice(0),['a','b','a','a','b','a'],sql)
      assert.deepEqual(fresh.conditions.map(c => c.code),[code],sql)
    }
  }
})
