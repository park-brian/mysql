import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('CHAR/BINARY casts own DECIMAL diagnostics after one original argument read', async () => {
  await loadCollation(255)
  await loadCollation(8)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: parts => parts[0] === 'g' ? { index: 1, type: intType(11,false) } : { index: parts[0] === 'a' ? 0 : 2, type: stringType(8,255,true) } },
  }
  const sources: [string, string, string[], number[]][] = [
    ['CAST(a AS CHAR)','123x',['a'],[]],
    ['CAST(a AS CHAR(3))','123',['a'],[1292]],
    ['CAST(a AS CHAR CHARACTER SET latin1)','123x',['a'],[]],
    ['CAST(a AS BINARY)','123x',['a'],[]],
    ['CAST(a AS BINARY(3))','123',['a'],[1292]],
    ['CAST(a AS BINARY(16))','123x' + '\0'.repeat(12),['a'],[]],
    ["IF(g=1,CAST(a AS BINARY),b)",'123x',['g','a'],[]],
    ["CAST(IF(g=1,a,b) AS CHAR)",'123x',['g','a'],[]],
    ["NULLIF(CAST(a AS BINARY),_binary'zz')",'123x',['a','a'],[]],
  ]
  for (const [sql,text,order,codes] of sources) {
    const calls: string[] = []
    let selected: Value = stringValue('123x',255)
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return selected } },
      1: { get: () => { calls.push('g'); return intValue(1n) } },
      2: { get: () => { throw Error('unselected argument evaluated') } },
    })
    const normal = compile(parseExpression(sql),ctx)
    assert.equal(normal.decimalOf === undefined,!sql.startsWith('IF(') && !sql.startsWith('NULLIF('),sql)
    const first = { ...env, memo: new Map(), conditions: [] as Condition[] }
    const value = normal.eval(row,first)
    assert.ok(value !== null,sql)
    assert.equal(toText(value),text,sql)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(first.conditions.map(c => c.code),codes,sql)
    const decimal = compile(parseExpression('CAST(' + sql + ' AS DECIMAL(65,0))'),ctx)
    const next = { ...env, memo: new Map(), conditions: [] as Condition[] }
    const number = decimal.eval(row,next)
    assert.ok(number !== null,sql)
    assert.equal(toText(number),'123',sql)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(next.conditions.map(c => c.code),codes,sql)
    selected = null
    const empty = { ...env, memo: new Map(), conditions: [] as Condition[] }
    assert.equal(decimal.eval(row,empty),null,sql)
    assert.deepEqual(calls.splice(0),order,sql)
    assert.deepEqual(empty.conditions,[],sql)
    selected = stringValue('abc1',255)
    const checked = asNumber(normal,'DECIMAL',true)
    for (let statement=0;statement<2;statement++) {
      const fresh = { ...env, memo: new Map(), conditions: [] as Condition[] }
      checked.eval(row,fresh)
      checked.eval(row,fresh)
      assert.deepEqual(calls.splice(0),[...order,...order],sql)
      assert.deepEqual(fresh.conditions.map(c => c.code),[...codes,1366,...codes],sql)
    }
  }
})
