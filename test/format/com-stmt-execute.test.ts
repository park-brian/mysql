// M1.22 — "doc 16's worked COM_STMT_EXECUTE example parses to the parameters
// it documents."
//
// Another golden vector taken straight from the specification (doc 43 §4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer } from '@myjs/bytes'
import {
  CLIENT,
  COM,
  FIELD_TYPE,
  capabilities,
  parseComStmtExecute,
  parseComQuery,
  PacketFramer,
  fromUtf8,
  utf8,
} from '@myjs/protocol'

const bytes = (s: string) => new Uint8Array(s.split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16)))
const NO_ATTRS = capabilities(CLIENT.PROTOCOL_41)
const WITH_ATTRS = capabilities(CLIENT.PROTOCOL_41 | CLIENT.QUERY_ATTRIBUTES)

// Doc 16's worked example, including its 4-byte packet header.
const DOC16_EXAMPLE = '12 00 00 00 17 01 00 00 00 00 01 00 00 00 00 01 0f 00 03 66 6f 6f'

test("doc 16's worked example frames as one 18-byte packet at sequence 0", () => {
  const framer = new PacketFramer()
  framer.feed(bytes(DOC16_EXAMPLE))
  const payload = framer.next()
  assert.ok(payload !== null)
  assert.equal(payload.length, 0x12, 'the declared payload length is 18')
  assert.equal(payload[0], COM.STMT_EXECUTE)
})

test("doc 16's worked example parses to the parameters it documents", () => {
  const framer = new PacketFramer()
  framer.feed(bytes(DOC16_EXAMPLE))
  const payload = framer.next() as Uint8Array

  const parsed = parseComStmtExecute(payload, NO_ATTRS, { paramCount: 1 })
  assert.equal(parsed.statementId, 1)
  assert.equal(parsed.flags, 0, 'CURSOR_TYPE_NO_CURSOR')
  assert.equal(parsed.iterationCount, 1, 'always 1')

  const params = parsed.binding?.parameters ?? []
  assert.equal(params.length, 1)
  assert.equal(fromUtf8(params[0]?.value as Uint8Array), 'foo')
  assert.equal(params[0]?.unsigned, false)

  // E-08: the example encodes the type word as `0f 00`, and doc 15's table
  // gives VAR_STRING = 0xfd — 0x0f is VARCHAR, which is internal-only and
  // never sent by a modern server. The example is transcribed from upstream;
  // we parse what is on the wire rather than "correcting" it, and the trace
  // fixtures settle what a real 8.4 actually sends.
  assert.equal(params[0]?.type, 0x0f)
  assert.notEqual(FIELD_TYPE.VAR_STRING, 0x0f)
  assert.equal(FIELD_TYPE.VAR_STRING, 0xfd)
})

test('a NULL parameter is carried by the bitmap and absent from the values', () => {
  const w = new Writer()
  w.u8(COM.STMT_EXECUTE)
  w.u32(1)
  w.u8(0)
  w.u32(1)
  w.u8(0b0000_0010) // parameter 1 is NULL; the bitmap is at offset 0 here
  w.u8(1)
  w.u16(FIELD_TYPE.LONG)
  w.u16(FIELD_TYPE.LONG)
  w.u32(7) // only parameter 0 has a value
  const parsed = parseComStmtExecute(w.toBytes(), NO_ATTRS, { paramCount: 2 })
  assert.deepEqual(parsed.binding?.parameters.map((p) => p.value), [7, null])
})

test('COM_QUERY carries named attributes when CLIENT_QUERY_ATTRIBUTES is negotiated', () => {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.lenEncInt(1) // parameter_count
  w.lenEncInt(1) // parameter_set_count, currently always 1
  w.u8(0) // null bitmap, offset 0
  w.u8(1) // new_params_bind_flag
  w.u16(FIELD_TYPE.LONG)
  w.lenEncBytes(utf8('trace_id'))
  w.u32(99)
  w.bytes(utf8('SELECT 1'))

  const parsed = parseComQuery(w.toBytes(), WITH_ATTRS)
  assert.equal(fromUtf8(parsed.sqlBytes), 'SELECT 1')
  assert.equal(parsed.attributes.length, 1)
  assert.equal(parsed.attributes[0]?.name, 'trace_id')
  assert.equal(parsed.attributes[0]?.value, 99)
})

test('a COM_QUERY with no attributes is just the SQL', () => {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.lenEncInt(0)
  w.lenEncInt(1)
  w.bytes(utf8('SELECT 2'))
  assert.equal(fromUtf8(parseComQuery(w.toBytes(), WITH_ATTRS).sqlBytes), 'SELECT 2')

  // And without the capability, the counts are not there to read at all.
  const plain = new Writer()
  plain.u8(COM.QUERY)
  plain.bytes(utf8('SELECT 3'))
  assert.equal(fromUtf8(parseComQuery(plain.toBytes(), NO_ATTRS).sqlBytes), 'SELECT 3')
})

test('a parameter_set_count other than 1 is refused rather than guessed at', () => {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.lenEncInt(1)
  w.lenEncInt(2) // reserved for a future batch form
  w.bytes(utf8('SELECT 1'))
  assert.throws(() => parseComQuery(w.toBytes(), WITH_ATTRS), /parameter_set_count must be 1/)
})

test('the parameter type word puts the type in the low byte and unsigned in bit 15', () => {
  // E-06: doc 15 words this as "the high bit of the high byte (0x80)"; docs 14
  // and 16 say 0x8000. Same bit.
  const w = new Writer()
  w.u8(COM.STMT_EXECUTE)
  w.u32(1)
  w.u8(0)
  w.u32(1)
  w.u8(0)
  w.u8(1)
  w.u16(FIELD_TYPE.LONGLONG | 0x8000)
  w.u64(0xffff_ffff_ffff_ffffn)
  const parsed = parseComStmtExecute(w.toBytes(), NO_ATTRS, { paramCount: 1 })
  assert.equal(parsed.binding?.parameters[0]?.type, FIELD_TYPE.LONGLONG)
  assert.equal(parsed.binding?.parameters[0]?.unsigned, true)
  assert.equal(parsed.binding?.parameters[0]?.value, 18446744073709551615n)
})
