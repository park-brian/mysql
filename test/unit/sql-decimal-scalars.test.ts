import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { stringType } from '../../packages/core/src/sql/meta.ts'

test('scalar prefix facts preserve argument counts, numeric readers and statement diagnostic lifetime', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: () => ({ index: 0, type: stringType(8,255,true) }) },
  }
  for (const sql of ['SUBSTRING(a,1)', 'LEFT(a,8)', 'LCASE(a)', 'REVERSE(REVERSE(a))', "REPLACE(a,'z','')", 'ELT(1,a)', 'MAKE_SET(1,a)', "SUBSTRING_INDEX(a,'z',1)", 'FROM_BASE64(TO_BASE64(a))', "LOWER(IF(TRUE,a,'123x'))"]) {
    let calls = 0
    let value: Value = stringValue('123x',255)
    const row: Value[] = []
    Object.defineProperty(row,0,{ get: () => { calls++; return value } })
    const result = compile(parseExpression(sql),ctx)
    const normal = result.eval(row,env)
    assert.ok(normal !== null)
    assert.equal(toText(normal),'123x')
    assert.equal(calls,1,sql)
    const decimal = asNumber(result,'DECIMAL',true)
    const next = { ...env, memo: new Map(), conditions: [] as Condition[] }
    const read = decimal.eval(row,next)
    assert.ok(read !== null)
    assert.equal(toText(read),'123x')
    assert.equal(calls,2,sql)
    assert.deepEqual(next.conditions,[])
    for (const kind of ['DOUBLE','INTEGER'] as const) {
      const numeric = { ...env, memo: new Map(), conditions: [] as Condition[] }
      asNumber(result,kind).eval(row,numeric)
      assert.deepEqual(numeric.conditions.map(c => c.code),[1292],sql + ': ' + kind)
    }
    value = stringValue('abc1',255)
    const fresh = { ...env, memo: new Map(), conditions: [] as Condition[] }
    decimal.eval(row,fresh)
    decimal.eval(row,fresh)
    assert.deepEqual(fresh.conditions.map(c => c.code),[1366],sql)
    const again = { ...env, memo: new Map(), conditions: [] as Condition[] }
    decimal.eval(row,again)
    assert.deepEqual(again.conditions.map(c => c.code),[1366],sql)
    assert.equal(calls,7,sql)
  }
  for (const sql of ['FLOOR(a)', 'CEIL(a)', 'CEILING(a)', 'ROUND(a)', 'TRUNCATE(a,0)', 'SIGN(a)', "GREATEST(a,'0')", "LEAST(a,'0')"]) {
    assert.equal(compile(parseExpression(sql),ctx).decimalPrefix,undefined,sql)
  }
})
