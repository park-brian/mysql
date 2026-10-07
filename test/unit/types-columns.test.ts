// M4.23 — a column's type, to its storage width and its key part.
//
// `storageWidth` is checked against the codec that writes each value rather
// than against a table of numbers: a width that disagrees with what the codec
// produces would shift every field after it in a record. `keyPartOf` is checked
// by what a key part must do — order like the type — and by refusing what
// MySQL refuses, with MySQL's numbers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import { encodeCharset, loadCollation, memcmp } from '@myjs/charsets'
import { errnoOf, sqlStateOf } from '@myjs/protocol'
import {
  TypeError as MyjsTypeError,
  encodeBit,
  encodeDateField,
  encodeDatetime2,
  encodeDecimal,
  encodeDouble,
  encodeEnum,
  encodeFloat,
  encodeInt,
  encodeKey,
  encodeSet,
  encodeTime2,
  encodeTimestamp2,
  encodeYear,
  keyPartOf,
  storageWidth,
  type ColumnType,
} from '@myjs/types'

const t = (type: number, more: Partial<ColumnType> = {}): ColumnType => ({ type, unsigned: false, ...more }) as ColumnType

test('storageWidth is the length each codec writes', () => {
  const cases: Array<[ColumnType, Uint8Array]> = [
    [t(FIELD_TYPE.TINY), encodeInt(1n, 1, false)],
    [t(FIELD_TYPE.SHORT), encodeInt(1n, 2, false)],
    [t(FIELD_TYPE.INT24), encodeInt(1n, 3, false)],
    [t(FIELD_TYPE.LONG), encodeInt(1n, 4, false)],
    [t(FIELD_TYPE.LONGLONG), encodeInt(1n, 8, false)],
    [t(FIELD_TYPE.FLOAT), encodeFloat(1.5)],
    [t(FIELD_TYPE.DOUBLE), encodeDouble(1.5)],
    [t(FIELD_TYPE.DATE), encodeDateField(2024, 2, 29)],
    [t(FIELD_TYPE.YEAR), encodeYear(2024)],
    [t(FIELD_TYPE.BIT, { bits: 13 }), encodeBit(5n, 13)],
    [t(FIELD_TYPE.ENUM, { members: ['a', 'b'] }), encodeEnum(1, 2)],
    [t(FIELD_TYPE.ENUM, { members: Array.from({ length: 300 }, (_, i) => `m${i}`) }), encodeEnum(299, 300)],
    [t(FIELD_TYPE.SET, { members: Array.from({ length: 20 }, (_, i) => `m${i}`) }), encodeSet(3n, 20)],
  ]
  for (const [p, s] of [[10, 0], [18, 9], [65, 30], [1, 0], [20, 4]] as const) {
    cases.push([t(FIELD_TYPE.NEWDECIMAL, { precision: p, scale: s }), encodeDecimal("1", p, s)])
  }
  for (let dec = 0; dec <= 6; dec++) {
    const dt = { year: 2024, month: 1, day: 2, hour: 3, minute: 4, second: 5, microsecond: 0 }
    cases.push([t(FIELD_TYPE.DATETIME2, { decimals: dec }), encodeDatetime2(dt as never, dec)])
    cases.push([t(FIELD_TYPE.TIMESTAMP2, { decimals: dec }), encodeTimestamp2(1, 0, dec)])
    cases.push([t(FIELD_TYPE.TIME2, { decimals: dec }), encodeTime2({ negative: false, days: 0, hour: 1, minute: 2, second: 3, microsecond: 0 } as never, dec)])
  }
  for (const [type, bytes] of cases) assert.equal(storageWidth(type), bytes.length, `type ${type.type}`)
})

test('CHAR is fixed only in a single-byte charset or binary (doc 24)', () => {
  assert.equal(storageWidth(t(FIELD_TYPE.STRING, { length: 10, collationId: 63 })), 10)
  assert.equal(storageWidth(t(FIELD_TYPE.STRING, { length: 10, collationId: 8 })), 10) // latin1_swedish_ci
  assert.equal(storageWidth(t(FIELD_TYPE.STRING, { length: 10, collationId: 255 })), undefined) // utf8mb4
  assert.equal(storageWidth(t(FIELD_TYPE.VAR_STRING, { length: 10, collationId: 63 })), undefined)
  assert.equal(storageWidth(t(FIELD_TYPE.BLOB, { collationId: 63 })), undefined)
  assert.equal(storageWidth(t(FIELD_TYPE.JSON)), undefined)
})

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0)

test('a key part from keyPartOf orders like its type', async () => {
  const c = await loadCollation(255)
  const words = ['', 'a', 'A', 'ab', 'b', 'é', 'e', 'z', 'Zebra', 'zebra ', 'ß', 'ss', 'Straße', 'Strasse', '\ufdfa', 'ææææææ']
  for (const descending of [false, true]) {
    const text = keyPartOf(t(FIELD_TYPE.VAR_STRING, { length: 6, collationId: 255 }), false, { descending })
    const ints = keyPartOf(t(FIELD_TYPE.LONG), true, { descending })
    const floats = keyPartOf(t(FIELD_TYPE.DOUBLE), false, { descending })
    const flip = descending ? -1 : 1
    for (const a of words) {
      for (const b of words) {
        const [ba, bb] = [encodeCharset(a, 'utf8mb4'), encodeCharset(b, 'utf8mb4')]
        assert.equal(sign(memcmp(encodeKey([ba], [text]), encodeKey([bb], [text]))), flip * sign(c.compare(ba, bb)) || 0, `${a} vs ${b}`)
      }
    }
    const nums = [null, -(2n ** 31n), -1n, 0n, 1n, 2n ** 31n - 1n]
    for (const [i, a] of nums.entries()) {
      for (const [j, b] of nums.entries()) {
        const ka = encodeKey([a === null ? null : encodeInt(a, 4, false)], [ints])
        const kb = encodeKey([b === null ? null : encodeInt(b, 4, false)], [ints])
        assert.equal(sign(memcmp(ka, kb)), flip * sign(i - j) || 0)
      }
    }
    const ds = [-Infinity, -1e300, -1, -0, 0, 1e-300, 1, Infinity]
    for (const a of ds) {
      for (const b of ds) {
        assert.equal(sign(memcmp(encodeKey([encodeDouble(a)], [floats]), encodeKey([encodeDouble(b)], [floats]))), flip * sign(a - b) || 0, `${a} vs ${b}`)
      }
    }
  }
})

test('keyPartOf gives each kind of column its part', () => {
  assert.deepEqual(keyPartOf(t(FIELD_TYPE.LONG), false), { kind: 'bytes', nullable: false })
  assert.deepEqual(keyPartOf(t(FIELD_TYPE.FLOAT), true), { kind: 'float', nullable: true })
  assert.deepEqual(keyPartOf(t(FIELD_TYPE.STRING, { length: 4, collationId: 63 }), false), { kind: 'bytes', nullable: false })
  assert.deepEqual(keyPartOf(t(FIELD_TYPE.VAR_STRING, { length: 9, collationId: 63 }), false), { kind: 'bytes', nullable: false, width: 9 })
  assert.deepEqual(keyPartOf(t(FIELD_TYPE.BLOB, { collationId: 63 }), false, { prefix: 5 }), { kind: 'bytes', nullable: false, width: 5, prefix: 5 })
  const text = keyPartOf(t(FIELD_TYPE.BLOB, { collationId: 255 }), false, { prefix: 5 })
  assert.equal(text.kind, 'text')
  assert.equal(text.prefix, 5)
})

test('keyPartOf refuses what MySQL refuses, with its numbers', () => {
  const refusals: Array<[string, () => unknown]> = [
    ['ER_BLOB_KEY_WITHOUT_LENGTH', () => keyPartOf(t(FIELD_TYPE.BLOB, { collationId: 255 }), false)],
    ['ER_JSON_USED_AS_KEY', () => keyPartOf(t(FIELD_TYPE.JSON), false)],
    ['ER_WRONG_SUB_KEY', () => keyPartOf(t(FIELD_TYPE.LONG), false, { prefix: 2 })],
    ['ER_WRONG_SUB_KEY', () => keyPartOf(t(FIELD_TYPE.VAR_STRING, { length: 3, collationId: 255 }), false, { prefix: 4 })],
    ['ER_WRONG_SUB_KEY', () => keyPartOf(t(FIELD_TYPE.VAR_STRING, { length: 3, collationId: 255 }), false, { prefix: 0 })],
    ['ER_NOT_SUPPORTED_YET', () => keyPartOf(t(FIELD_TYPE.GEOMETRY), false)],
  ]
  for (const [code, fn] of refusals) {
    assert.throws(fn, (e: unknown) => {
      assert.ok(e instanceof MyjsTypeError)
      assert.equal(e.code, code)
      assert.equal(e.errno, errnoOf(code as never))
      assert.equal(e.sqlState, sqlStateOf(code as never))
      return true
    })
  }
})

test('unsupportedType carries the table SQLSTATE (it said 0A000 from M2 until this check)', async () => {
  const { unsupportedType } = await import('@myjs/types')
  assert.equal(unsupportedType('x').sqlState, sqlStateOf('ER_NOT_SUPPORTED_YET'))
})
