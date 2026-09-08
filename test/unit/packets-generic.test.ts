// M1.4 and M1.5.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer } from '@myjs/bytes'
import {
  CLIENT,
  SERVER_STATUS,
  capabilities,
  writeOk,
  parseOk,
  writeErr,
  parseErr,
  writeEof,
  parseEof,
  writeTerminator,
  classify,
  PACKET,
  PacketFramer,
} from '@myjs/protocol'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ')

const CAPS_41 = capabilities(CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS)
const CAPS_MODERN = capabilities(
  CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS | CLIENT.SESSION_TRACK | CLIENT.DEPRECATE_EOF,
)

// --- M1.5: byte-identity with doc 10's minimal OK -----------------------

test('the minimal OK is byte-identical to 07 00 00 02 00 00 00 02 00 00 00', () => {
  const w = new Writer()
  writeOk(w, CAPS_41, { statusFlags: SERVER_STATUS.AUTOCOMMIT })
  const payload = w.view()
  assert.equal(hex(payload), '00 00 00 02 00 00 00', 'the 7-byte payload')

  // And framed, at sequence 2, it is the whole line from the doc.
  const f = new PacketFramer()
  f.resetSequence()
  f.encode(new Uint8Array(0))
  f.encode(new Uint8Array(0)) // advance to sequence 2
  assert.equal(hex(f.encode(payload)), '07 00 00 02 00 00 00 02 00 00 00')
})

test('the minimal OK stays 7 bytes with session tracking negotiated', () => {
  // The `info` field appears only when there is something to say; a writer
  // that always emits it would add a byte to every OK packet.
  const w = new Writer()
  writeOk(w, CAPS_MODERN, { statusFlags: SERVER_STATUS.AUTOCOMMIT })
  assert.equal(w.length, 7)
})

test('OK round-trips affected rows and insert id beyond 2^53', () => {
  const w = new Writer()
  writeOk(w, CAPS_41, { affectedRows: 2n ** 60n, lastInsertId: 2n ** 61n, warnings: 3 })
  const ok = parseOk(w.view(), CAPS_41)
  assert.equal(ok.affectedRows, 2n ** 60n)
  assert.equal(ok.lastInsertId, 2n ** 61n)
  assert.equal(ok.warnings, 3)
})

test('OK carries session state changes only when the flag is set', () => {
  const changes = new Uint8Array([1, 4, 0x74, 0x65, 0x73, 0x74])
  const w = new Writer()
  writeOk(w, CAPS_MODERN, {
    statusFlags: SERVER_STATUS.AUTOCOMMIT | SERVER_STATUS.SESSION_STATE_CHANGED,
    sessionStateChanges: changes,
  })
  const ok = parseOk(w.view(), CAPS_MODERN)
  assert.deepEqual([...(ok.sessionStateChanges as Uint8Array)], [...changes])

  const without = new Writer()
  writeOk(without, CAPS_MODERN, { statusFlags: SERVER_STATUS.AUTOCOMMIT })
  assert.equal(parseOk(without.view(), CAPS_MODERN).sessionStateChanges, null)
})

test('ERR matches doc 10s worked example byte for byte', () => {
  const w = new Writer()
  writeErr(w, CAPS_41, { errno: 1096, sqlState: 'HY000', message: 'No tables used' })
  assert.equal(
    hex(w.view()),
    'ff 48 04 23 48 59 30 30 30 4e 6f 20 74 61 62 6c 65 73 20 75 73 65 64',
  )
})

test('a connection-phase ERR to a pre-4.1 client omits the SQL state', () => {
  const w = new Writer()
  writeErr(w, capabilities(0), { errno: 1045, message: 'nope' })
  assert.equal(hex(w.view()).startsWith('ff 15 04 6e'), true, 'errno then message, no # marker')
  assert.equal(parseErr(w.view(), capabilities(0)).errno, 1045)
})

test('ERR takes its SQL state from the generated table when not given', () => {
  const w = new Writer()
  writeErr(w, CAPS_41, { errno: 1062, message: 'dup' })
  assert.equal(parseErr(w.view(), CAPS_41).sqlState, '23000')
})

test('EOF orders warnings before status flags — the reverse of OK', () => {
  const w = new Writer()
  writeEof(w, CAPS_41, { warnings: 0x0102, statusFlags: 0x0304 })
  assert.equal(hex(w.view()), 'fe 02 01 04 03')
  const eof = parseEof(w.view(), CAPS_41)
  assert.equal(eof.warnings, 0x0102)
  assert.equal(eof.statusFlags, 0x0304)

  const ok = new Writer()
  writeOk(ok, CAPS_41, { statusFlags: 0x0304, warnings: 0x0102 })
  assert.equal(hex(ok.view()), '00 00 00 04 03 02 01', 'OK is status then warnings')
})

test('the terminator honours CLIENT_DEPRECATE_EOF in both directions', () => {
  const deprecated = new Writer()
  writeTerminator(deprecated, CAPS_MODERN, { statusFlags: SERVER_STATUS.AUTOCOMMIT })
  assert.equal(deprecated.view()[0], 0xfe, 'an OK packet wearing the EOF header')
  assert.equal(deprecated.length, 7, 'and an OK packet body')

  const classic = new Writer()
  writeTerminator(classic, CAPS_41, { statusFlags: SERVER_STATUS.AUTOCOMMIT })
  assert.equal(classic.view()[0], 0xfe)
  assert.equal(classic.length, 5, 'a real EOF packet')
})

// --- M1.4: discrimination by length -------------------------------------

test('a 0xFE payload of >= 9 bytes is a lenenc integer, not EOF', () => {
  assert.equal(classify(new Uint8Array(9).fill(0xfe), 'command'), PACKET.RESULTSET)
  assert.equal(classify(new Uint8Array(8).fill(0xfe), 'command'), PACKET.EOF)
  assert.equal(classify(new Uint8Array([0xfe, 0, 0, 0, 0]), 'command'), PACKET.EOF)
})

test('0x00 is OK only when the payload can hold its fixed fields', () => {
  assert.equal(classify(new Uint8Array(7), 'command'), PACKET.OK)
  // A short payload starting 0x00 is a column count of zero, not a stunted OK.
  assert.equal(classify(new Uint8Array(6), 'command'), PACKET.RESULTSET)
})

test('0xFF is ERR in either phase', () => {
  assert.equal(classify(new Uint8Array([0xff, 1, 2]), 'command'), PACKET.ERR)
  assert.equal(classify(new Uint8Array([0xff, 1, 2]), 'connection'), PACKET.ERR)
})

test('the connection phase reads the same bytes differently', () => {
  // 0xFE is an auth switch here, whatever its length — OldAuthSwitchRequest is
  // a single 0xFE byte.
  assert.equal(classify(new Uint8Array([0xfe]), 'connection'), PACKET.AUTH_SWITCH)
  assert.equal(classify(new Uint8Array(20).fill(0xfe), 'connection'), PACKET.AUTH_SWITCH)
  assert.equal(classify(new Uint8Array([0x01, 0x03]), 'connection'), PACKET.AUTH_MORE_DATA)
  assert.equal(classify(new Uint8Array([0x02, 0x61, 0x00]), 'connection'), PACKET.AUTH_NEXT_FACTOR)
  // The same 0x01 payload in the command phase is a one-column resultset.
  assert.equal(classify(new Uint8Array([0x01, 0x03]), 'command'), PACKET.RESULTSET)
})

test('0xFB heads a LOCAL INFILE request', () => {
  assert.equal(classify(new Uint8Array([0xfb, 0x78]), 'command'), PACKET.LOCAL_INFILE)
})

test('an empty payload classifies as empty rather than crashing', () => {
  assert.equal(classify(new Uint8Array(0), 'command'), PACKET.EMPTY)
  assert.equal(classify(new Uint8Array(0), 'connection'), PACKET.EMPTY)
})
