import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCollation } from '@myjs/charsets'
import { parseExpression } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { bytesValue, intValue, type Value } from '@myjs/types'
import { compile, type CompileContext, type Env } from '../../packages/core/src/sql/compile.ts'
import { intType, stringType } from '../../packages/core/src/sql/meta.ts'

test('UNHEX diagnostics belong to each invalid evaluation without rereading its value', async () => {
  await loadCollation(255)
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions: [],
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  const binary = { ...stringType(12000,63,true), column: { schema: 'd', table: 't', orgTable: 't', orgName: 'a', flags: 0 } }
  const ctx: CompileContext = {
    session: env.session, state: env.state, clause: 'field list', serverVersion: '8.4.11', connectionCollation: 255,
    scope: { resolve: parts => ({ index: parts[0] === 'g' ? 1 : parts[0] === 'a' ? 0 : 2, type: parts[0] === 'g' ? intType(11,false) : binary }) },
  }
  for (const sql of ['UNHEX(a)','IF(g=0,UNHEX(c),UNHEX(a))']) {
    let value: Value = bytesValue(Uint8Array.of(0x34,0x31,0x80,0xff))
    const calls: string[] = []
    const row: Value[] = []
    Object.defineProperties(row, {
      0: { get: () => { calls.push('a'); return value } },
      1: { get: () => { calls.push('g'); return intValue(1n) } },
      2: { get: () => { throw Error('unselected argument evaluated') } },
    })
    const expression = compile(parseExpression(sql),ctx)
    for (let statement=0;statement<2;statement++) {
      const fresh: Env = { ...env, memo: new Map(), conditions: [] }
      for (let read=0;read<2;read++) {
        assert.equal(expression.eval(row,fresh),null)
        assert.deepEqual(calls.splice(0),sql.startsWith('IF')?['g','a']:['a'])
      }
      assert.deepEqual(fresh.conditions,Array.from({length:2},()=>({level:'Warning',code:1411,message:"Incorrect string value: '`d`.`t`.`a`' for function unhex"})))
    }
    for (const next of [bytesValue(Buffer.from('41'.repeat(2048))),null]) {
      value = next
      const fresh: Env = { ...env, memo: new Map(), conditions: [] }
      const result = expression.eval(row,fresh)
      assert.deepEqual(result,next===null?null:bytesValue(new Uint8Array(2048).fill(0x41)))
      assert.deepEqual(calls.splice(0),sql.startsWith('IF')?['g','a']:['a'])
      assert.deepEqual(fresh.conditions,[])
    }
  }
})
