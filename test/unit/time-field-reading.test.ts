import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import { decodeField, encodeField, plainValue, stringValue, toInteger } from '@myjs/types'

test('decoded TIME exposes an integer reading while retaining its payload and generic conversion', () => {
  const type = { type: FIELD_TYPE.TIME, decimals: 6 }
  const bytes = encodeField(stringValue('00:00:59.500000', 255), { name: 't', type, nullable: true }, { strict: true, row: 1, warnings: 0 })
  const value = decodeField(bytes, type)
  assert.equal(value?.kind, 'time')
  if (value?.kind !== 'time') return
  assert.equal(value.integer, 100n)
  assert.equal(value.v.second, 59)
  assert.equal(value.v.microsecond, 500000)
  assert.ok(Object.keys(value).includes('integer'))
  assert.throws(() => JSON.stringify(value), TypeError)
  assert.equal(toInteger(value), 59n)
  assert.equal((plainValue(value, true) as typeof value).integer, 60n)
  assert.ok(!Object.hasOwn(plainValue(value)!, 'integer'))
  assert.equal(value.integer, 100n)
})
