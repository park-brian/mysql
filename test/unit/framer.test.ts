// M1.1, M1.2 — framing and sequence ids.
//
// M1.1's acceptance assertion: "a 16777215-byte payload emits `ff ff ff n`
// **plus an empty packet**, and decodes back."
// M1.2's: "a mismatch raises `ER_NET_PACKETS_OUT_OF_ORDER`, and the counter is
// not visible to packet types."
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProtocolError } from '@myjs/bytes'
import { PacketFramer, MAX_PAYLOAD } from '@myjs/protocol'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ')

test('a small payload frames as length + sequence + payload', () => {
  const f = new PacketFramer()
  assert.equal(hex(f.encode(new Uint8Array([0x0e]))), '01 00 00 00 0e')
  assert.equal(hex(f.encode(new Uint8Array([0x0e]))), '01 00 00 01 0e', 'the counter advances')
})

test('an empty payload is a real packet, not nothing', () => {
  const f = new PacketFramer()
  assert.equal(hex(f.encode(new Uint8Array(0))), '00 00 00 00')
})

test('a payload round-trips through encode and next', () => {
  const send = new PacketFramer()
  const recv = new PacketFramer()
  const payload = new Uint8Array(1000).map((_, i) => i & 0xff)
  recv.feed(send.encode(payload))
  assert.deepEqual([...(recv.next() as Uint8Array)], [...payload])
  assert.equal(recv.next(), null, 'nothing left over')
})

test('an empty payload round-trips as an empty payload', () => {
  const send = new PacketFramer()
  const recv = new PacketFramer()
  recv.feed(send.encode(new Uint8Array(0)))
  const got = recv.next()
  assert.ok(got !== null, 'an empty packet must be delivered, not swallowed')
  assert.equal(got.length, 0)
})

test('a 16777215-byte payload emits ff ff ff n plus an empty packet', () => {
  const f = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  const payload = new Uint8Array(MAX_PAYLOAD)
  const framed = f.encode(payload)

  assert.equal(framed.length, MAX_PAYLOAD + 4 + 4, 'two headers: the full chunk and the terminator')
  assert.equal(hex(framed.subarray(0, 4)), 'ff ff ff 00')
  assert.equal(hex(framed.subarray(framed.length - 4)), '00 00 00 01', 'the mandatory empty packet')
})

test('a 16777215-byte payload decodes back', () => {
  const send = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  const recv = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  const payload = new Uint8Array(MAX_PAYLOAD)
  payload[0] = 0xaa
  payload[MAX_PAYLOAD - 1] = 0xbb
  recv.feed(send.encode(payload))
  const got = recv.next()
  assert.ok(got !== null)
  assert.equal(got.length, MAX_PAYLOAD)
  assert.equal(got[0], 0xaa)
  assert.equal(got[MAX_PAYLOAD - 1], 0xbb)
  assert.equal(recv.next(), null)
})

test('a payload just over the split boundary round-trips', () => {
  const send = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  const recv = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  const payload = new Uint8Array(MAX_PAYLOAD + 10)
  payload[MAX_PAYLOAD + 9] = 0x7f
  const framed = send.encode(payload)
  assert.equal(hex(framed.subarray(0, 4)), 'ff ff ff 00')
  assert.equal(hex(framed.subarray(MAX_PAYLOAD + 4, MAX_PAYLOAD + 8)), '0a 00 00 01')
  recv.feed(framed)
  const got = recv.next()
  assert.equal(got?.length, MAX_PAYLOAD + 10)
  assert.equal(got?.[MAX_PAYLOAD + 9], 0x7f)
})

test('reassembly works when bytes arrive one at a time', () => {
  const send = new PacketFramer()
  const recv = new PacketFramer()
  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const framed = send.encode(payload)
  for (let i = 0; i < framed.length - 1; i++) {
    recv.feed(framed.subarray(i, i + 1))
    assert.equal(recv.next(), null, `incomplete after ${i + 1} bytes`)
  }
  recv.feed(framed.subarray(framed.length - 1))
  assert.deepEqual([...(recv.next() as Uint8Array)], [...payload])
})

test('several packets in one chunk all drain', () => {
  const send = new PacketFramer()
  const recv = new PacketFramer()
  const parts = [new Uint8Array([1]), new Uint8Array([2, 2]), new Uint8Array(0), new Uint8Array([3])]
  const all = parts.map((p) => send.encode(p))
  const joined = new Uint8Array(all.reduce((n, a) => n + a.length, 0))
  let at = 0
  for (const a of all) {
    joined.set(a, at)
    at += a.length
  }
  recv.feed(joined)
  const got = [...recv.drain()].map((p) => [...p])
  assert.deepEqual(got, [[1], [2, 2], [], [3]])
})

// --- sequence ids (M1.2) -------------------------------------------------

test('a sequence mismatch raises ER_NET_PACKETS_OUT_OF_ORDER', () => {
  const recv = new PacketFramer()
  // A client packet claiming sequence 5 when 0 is expected.
  recv.feed(new Uint8Array([0x01, 0x00, 0x00, 0x05, 0xff]))
  assert.throws(
    () => recv.next(),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError)
      assert.equal(err.code, 'ER_NET_PACKETS_OUT_OF_ORDER')
      assert.equal(err.errno, 1156)
      assert.equal(err.sqlState, '08S01')
      return true
    },
  )
})

test('the counter runs continuously and resets only when asked', () => {
  const f = new PacketFramer()
  assert.equal(f.sequenceId, 0)
  f.encode(new Uint8Array(0))
  f.encode(new Uint8Array(0))
  assert.equal(f.sequenceId, 2, 'continuous through the connection phase')
  f.resetSequence()
  assert.equal(f.sequenceId, 0, 'reset at the start of a command')
})

test('the counter wraps at 256', () => {
  const f = new PacketFramer()
  for (let i = 0; i < 255; i++) f.encode(new Uint8Array(0))
  assert.equal(f.sequenceId, 255)
  f.encode(new Uint8Array(0))
  assert.equal(f.sequenceId, 0, 'wraps rather than growing')
})

test('a split message advances the counter once per packet', () => {
  const f = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  f.encode(new Uint8Array(MAX_PAYLOAD))
  assert.equal(f.sequenceId, 2, 'the full chunk and the terminator are two packets')
})

// --- max_allowed_packet (M1.1 / D-31) ------------------------------------

test('max_allowed_packet is enforced during reassembly, not after', () => {
  const recv = new PacketFramer({ maxAllowedPacket: 1024 })
  // Only the 4-byte header is fed. The claim alone must be refused — we must
  // not wait for, and buffer, the megabytes it promises.
  recv.feed(new Uint8Array([0x00, 0x00, 0x40, 0x00])) // claims 0x400000 bytes
  assert.throws(
    () => recv.next(),
    (err: unknown) => {
      assert.ok(err instanceof ProtocolError)
      assert.equal(err.code, 'ER_NET_PACKET_TOO_LARGE')
      assert.equal(err.errno, 1153)
      return true
    },
  )
  assert.equal(recv.buffered, 4, 'nothing was allocated for the claimed payload')
})

test('the cap applies to the reassembled size, across a split', () => {
  const recv = new PacketFramer({ maxAllowedPacket: MAX_PAYLOAD + 8 })
  const send = new PacketFramer({ maxAllowedPacket: 64 * 1024 * 1024 })
  // First chunk is exactly at the cap's edge; the continuation pushes it over.
  const framed = send.encode(new Uint8Array(MAX_PAYLOAD + 16))
  recv.feed(framed)
  assert.throws(() => recv.next(), /max_allowed_packet/)
})

test('a payload exactly at the cap is accepted', () => {
  const send = new PacketFramer()
  const recv = new PacketFramer({ maxAllowedPacket: 8 })
  recv.feed(send.encode(new Uint8Array(8)))
  assert.equal(recv.next()?.length, 8)
})
