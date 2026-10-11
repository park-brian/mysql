import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { bytesValue, intValue, stringValue, toText, type Condition, type Value } from '@myjs/types'
import { asNumber, compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('fixed-field DECIMAL diagnostics preserve full numeric inputs, original reads and statement lifetime', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  for (const binary of [false,true]) {
    const type = { ...stringType(255,binary ? 63 : 255,true), field: FIELD_TYPE.STRING, scale: 0, column: { schema: 'd', table: 't', orgTable: 't', orgName: 'a', flags: 0 } }
    const ctx: CompileContext = {
      session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
      scope: { resolve: parts => ({ index: parts[0] === 'g' ? 1 : parts[0] === 'a' ? 0 : 2, type: parts[0] === 'g' ? intType(11,false) : type }) },
    }
    const input = (text: string): Exclude<Value,null> => binary ? bytesValue(Buffer.concat([Buffer.from(text),Buffer.alloc(255 - Buffer.byteLength(text))])) : stringValue(text,255)
    const sources: [string, string[], boolean][] = [
      ['a',['a'],true],
      ['IF(g=1,a,c)',['g','a'],true],
      ["NULLIF(a,'zz')",['a','a'],true],
      ['CONCAT(a)',['a'],false],
      ["COALESCE(a,'123x')",['a'],false],
      ["GREATEST(a,'')",['a'],false],
    ]
    for (const [sql,order,field] of sources) {
      let selected: Value = input('0'.repeat(200) + '123x')
      const calls: string[] = []
      const row: Value[] = []
      Object.defineProperties(row, {
        0: { get: () => { calls.push('a'); return selected } },
        1: { get: () => { calls.push('g'); return intValue(1n) } },
        2: { get: () => { throw Error('unselected argument evaluated') } },
      })
      const fresh = (): Env & { conditions: Condition[] } => ({ ...env, memo: new Map(), conditions: [] })
      const normal = compile(parseExpression(sql),ctx)
      const initial = fresh()
      const value = normal.eval(row,initial)
      assert.ok(value !== null)
      assert.equal(toText(value),toText(selected),sql)
      assert.deepEqual(calls.splice(0),order,sql)
      assert.deepEqual(initial.conditions,[],sql)
      const decimal = compile(parseExpression('CAST(' + sql + ' AS DECIMAL(65,0))'),ctx)
      const next = fresh()
      const number = decimal.eval(row,next)
      assert.ok(number !== null)
      assert.equal(toText(number),'123',sql)
      assert.deepEqual(calls.splice(0),order,sql)
      assert.deepEqual(next.conditions.map(c => c.code),field ? [1292] : [],sql)
      if (field) assert.equal(next.conditions[0]?.message,"Truncated incorrect DECIMAL value: '" + '0'.repeat(128) + "'")
      selected = input('abc1')
      const checked = asNumber(normal,'DECIMAL',true)
      for (let statement=0;statement<2;statement++) {
        const conditions = fresh()
        checked.eval(row,conditions)
        checked.eval(row,conditions)
        assert.deepEqual(calls.splice(0),[...order,...order],sql)
        assert.deepEqual(conditions.conditions.map(c => c.code),field ? [1366,1292] : [1366],sql)
      }
      selected = null
      const empty = fresh()
      const absent = decimal.eval(row,empty)
      if (sql.startsWith('COALESCE')) {
        assert.ok(absent !== null)
        assert.equal(toText(absent),'123',sql)
      } else assert.equal(absent,null,sql)
      assert.deepEqual(calls.splice(0),order,sql)
      assert.deepEqual(empty.conditions,[],sql)
    }
  }
})
