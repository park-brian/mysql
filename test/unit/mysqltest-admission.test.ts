import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '@myjs/parser'
import { annotatedAdmission } from '../../tools/lib/mysqltest-admission.mjs'

test('census accepts only native-annotated grammar errors with matching generated facts', () => {
  const overflow = new ParseError('ER_ILLEGAL_VALUE_FOR_TYPE', 'overflow', { errno: 1367, sqlState: '22007' })
  const collation = new ParseError('ER_UNKNOWN_COLLATION', 'collation', { errno: 1273, sqlState: 'HY000' })
  for (const label of ['1367', 'ER_ILLEGAL_VALUE_FOR_TYPE', 'ER_UNKNOWN_COLLATION, 1367']) assert.equal(annotatedAdmission(overflow, label), true, label)
  assert.equal(annotatedAdmission(collation, '1273'), true)
  assert.equal(annotatedAdmission(collation, 'ER_UNKNOWN_COLLATION'), true)
  for (const label of [undefined, '', '0', '1064', '1367x', 'ER_UNKNOWN_COLLATION', 'ER_NOT_A_NATIVE_ERROR']) assert.equal(annotatedAdmission(overflow, label), false, String(label))
  assert.equal(annotatedAdmission(new Error('overflow'), '1367'), false)
  assert.equal(annotatedAdmission({ ...overflow }, '1367'), false)
  assert.equal(annotatedAdmission(new ParseError('ER_UNKNOWN_COLLATION', 'wrong code', { errno: 1367, sqlState: '22007' }), '1367'), false)
  assert.equal(annotatedAdmission(new ParseError('ER_ILLEGAL_VALUE_FOR_TYPE', 'wrong state', { errno: 1367, sqlState: 'HY000' }), '1367'), false)
})
