import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session, capabilities } from '@myjs/protocol'
import { intValue, stringValue, type Condition } from '@myjs/types'
import { asNumber, choiceOf, lit, type Env } from '../../packages/core/src/sql/compile.ts'
import { doubleType, intType, stringType } from '../../packages/core/src/sql/meta.ts'

// Selector effects and statement warning lifetimes must survive nested reader delegation.
test('a nested DECIMAL reader selects once per evaluation and memoizes only diagnostics', () => {
  const conditions: Condition[] = []
  const env: Env = {
    params: [], now: new Date(0), memo: new Map(), conditions,
    session: new Session({ connectionId: 1, capabilities: capabilities(0) }),
    state: { userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n, systemVariable: () => undefined },
  }
  let selections = 0
  let reads = 0
  const branch = { type: stringType(8,255,false), eval: () => { reads++; return stringValue('123x',255) } }
  const fail = { type: stringType(8,255,false), eval: () => { throw Error('unselected branch evaluated') } }
  const select = () => { selections++; return 0 }
  const inner = choiceOf([branch,fail],select,doubleType(false))
  const outer = choiceOf([inner,fail],select,doubleType(false))
  const checked = asNumber(outer,'DECIMAL',true)
  for (let i=0;i<3;i++) assert.deepEqual(checked.eval([],env),stringValue('123x',255))
  assert.equal(selections,6)
  assert.equal(reads,3)
  assert.equal(conditions.length,1)
  const following = { ...env, memo: new Map(), conditions: [] }
  checked.eval([],following)
  assert.equal(following.conditions.length,1)
  assert.equal(selections,8)
  assert.equal(reads,4)
  const exact = intValue(18446744073709551615n)
  const choice = choiceOf([lit(exact,intType(20,false,true)),fail],select,doubleType(false))
  assert.deepEqual(asNumber(choice,'DECIMAL').eval([],env),exact)
})
