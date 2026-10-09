// M5.21 — JSON as a value: its text, its order and its binary form. Every
// expected string below was read off 8.4.11 (tools/capture-json.mjs and the
// probes behind it), which is the only authority these rules answer to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JsonSyntaxError, compareJson, decodeJson, decodeJsonDoc, encodeJsonDoc, jsonKey, orderJson, parseDecimal, parseJson, renderJson, type JsonDoc } from '@myjs/types'

const round = (text: string): string => renderJson(parseJson(text))

test('M5.21: JSON text renders as MySQL renders it', () => {
  // Spaces after `,` and `:`, keys in length-then-bytes order, the last of two equal keys.
  assert.equal(round('{"b":1,"a":[1,2.50,"x",null,true],"aa":{"z":1e2}}'), '{"a": [1, 2.5, "x", null, true], "b": 1, "aa": {"z": 100.0}}')
  assert.equal(round('{"a": 1, "a": 2}'), '{"a": 2}')
  // A double keeps `.0`; `-0` is the integer 0 and `-0.0` the double.
  assert.equal(round('[1.0, -0, -0.0, 1e2, 100, 1E-7, 0.000001, 1.5e-310, 1e15, 1e21]'), '[1.0, 0, -0.0, 100.0, 100, 0.0000001, 0.000001, 1.5e-310, 1e15, 1e21]')
  // INT64, then UINT64, then a double.
  assert.equal(round('[9223372036854775807, 9223372036854775808, 18446744073709551615, 18446744073709551616, -9223372036854775809]'), '[9223372036854775807, 9223372036854775808, 18446744073709551615, 1.8446744073709552e19, -9.223372036854776e18]')
  // Escapes in, and only the necessary ones out: `/` and non-ASCII are not escaped.
  assert.equal(round('"\\u0001\\u001f\\t\\b\\f\\/\\u00e9\\ud83d\\ude00"'), '"\\u0001\\u001f\\t\\b\\f/é😀"')
})

test("M5.21: a long number is parsed as rapidjson parses it, not correctly rounded", () => {
  // 8.4.11 says 1.2345678901234566e29; the correctly rounded double is …68e29.
  assert.equal(round('123456789012345678901234567890'), '1.2345678901234566e29')
  assert.equal(round('3.14159'), '3.14159')
  assert.equal(round('-1.5E-3'), '-0.0015')
})

test('M5.21: invalid text is refused with rapidjson\'s message at the position 8.4.11 reports', () => {
  const error = (text: string): [string, number] => {
    try {
      parseJson(text)
    } catch (e) {
      assert.ok(e instanceof JsonSyntaxError)
      return [e.message, e.position]
    }
    return ['', -1]
  }
  assert.deepEqual(error(''), ['The document is empty.', 0])
  assert.deepEqual(error('{bad'), ['Missing a name for object member.', 1])
  assert.deepEqual(error('1e400'), ['Number too big to be stored in double.', 0])
  assert.deepEqual(error('01'), ['The document root must not be followed by other values.', 1])
  assert.equal(error('[1,]')[0], 'Invalid value.')
  assert.equal(error('"x')[0], 'Missing a closing quotation mark in string.')
})

test('M5.21: values MySQL keeps beside JSON render with their own types', () => {
  const d = (t: JsonDoc): string => renderJson({ t: 'array', v: [t] })
  assert.equal(d({ t: 'decimal', v: parseDecimal('1.50') }), '[1.50]')
  assert.equal(d({ t: 'datetime', v: { year: 2020, month: 1, day: 2, hour: 3, minute: 4, second: 5, microsecond: 678000 } }), '["2020-01-02 03:04:05.678000"]')
  assert.equal(d({ t: 'date', v: { year: 2020, month: 1, day: 2, hour: 0, minute: 0, second: 0, microsecond: 0 } }), '["2020-01-02"]')
  assert.equal(d({ t: 'time', v: { negative: true, days: 0, hour: 1, minute: 2, second: 3, microsecond: 0 } }), '["-01:02:03.000000"]')
  assert.equal(d({ t: 'opaque', field: 254, v: new Uint8Array([0x61, 0x62, 0]) }), '["base64:type254:YWIA"]')
})

test('M5.21: the binary form round-trips, and the M2.13 reader reads it', () => {
  const texts = ['[1.0, -0.0, 70000, -40000, 5000000000, 18446744073709551615, true, null, "x", {"b": [1, {"a": "é"}], "aa": {}}]', '{}', '[]', '1', '"s"', 'null', '-9223372036854775808']
  for (const text of texts) {
    const bytes = encodeJsonDoc(parseJson(text))
    assert.equal(renderJson(decodeJsonDoc(bytes)), round(text))
    assert.doesNotThrow(() => decodeJson(bytes))
  }
  const extra: JsonDoc = { t: 'array', v: [{ t: 'decimal', v: parseDecimal('-12.50') }, { t: 'time', v: { negative: true, days: 1, hour: 1, minute: 2, second: 3, microsecond: 5 } }] }
  assert.equal(renderJson(decodeJsonDoc(encodeJsonDoc(extra))), '[-12.50, "-25:02:03.000005"]')
  // Past 64 KiB a container's offsets need four bytes.
  const big: JsonDoc = { t: 'array', v: Array.from({ length: 9000 }, (_, i) => ({ t: 'string', v: `xxxxxxxxxx${i}` })) }
  assert.equal(renderJson(decodeJsonDoc(encodeJsonDoc(big))), renderJson(big))
})

test('M5.21: comparison is by JSON type first, then by value; a sort keys an array or object on its length', () => {
  const j = parseJson
  assert.equal(compareJson(j('1'), j('1.0')), 0)
  assert.equal(compareJson(j('1'), j('"1"')) < 0, true)
  assert.equal(compareJson(j('{"a":1}'), j('[1]')) < 0, true, 'OBJECT before ARRAY')
  assert.equal(compareJson(j('[1]'), j('false')) < 0, true, 'ARRAY before BOOLEAN')
  assert.equal(compareJson(j('[1,2]'), j('[1,3]')) < 0, true)
  // A sort sees only the length: [false] before a three-element array, whatever is in it.
  assert.equal(orderJson(j('[false]'), j('[{}, 1, true]')) < 0, true)
  assert.equal(orderJson(j('{"zz": {}}'), j('{"name": {}}')), 0)
  // DISTINCT keys on equality, where 1, 1.0 and 1.00 are one value.
  assert.equal(jsonKey(j('[1, {"a": 1.0}]')), jsonKey(j('[1.00, {"a": 1}]')))
  assert.notEqual(jsonKey(j('[1]')), jsonKey(j('[2]')))
})
