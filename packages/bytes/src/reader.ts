// M0.3 — `Reader`, the contract written out in docs/11-protocol-primitives.md.
//
// Four rules from doc 11 govern every method here:
//   1. Zero-copy reads — `bytes()` returns a subarray, never a copy. Decoding
//      to a JS string is a separate, deferred step, because a text-resultset
//      value uses the *column's* charset, not the connection's.
//   2. Bounds-check every read, throwing a typed `ProtocolError`. This is the
//      entire attack surface for a malicious peer.
//   3. No `Buffer` — `Uint8Array` + `DataView` only, so this runs unchanged in
//      the browser.
//   4. (the writer's rule; see writer.ts)
//
// All multi-byte integers in the protocol are little-endian unless stated
// otherwise (doc 10). `int<3>` and `int<6>` are genuine MySQL widths — a
// reader built on `DataView` alone needs explicit helpers for them.

import { ProtocolError, outOfBounds } from './errors.ts'

/** First-byte markers for a length-encoded integer (doc 11). */
const LENENC_NULL = 0xfb
const LENENC_U16 = 0xfc
const LENENC_U24 = 0xfd
const LENENC_U64 = 0xfe
const LENENC_INVALID = 0xff

export class Reader {
  readonly #bytes: Uint8Array
  readonly #view: DataView
  readonly #end: number
  #pos: number

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    if (start < 0 || end > bytes.length || start > end) {
      throw new ProtocolError('PROTOCOL_BAD_RANGE', `invalid Reader range ${start}..${end} over ${bytes.length} bytes`)
    }
    this.#bytes = bytes
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.#pos = start
    this.#end = end
  }

  /** Bytes left in the payload; every read checks against it. */
  get remaining(): number {
    return this.#end - this.#pos
  }

  /** Current offset, relative to the underlying array. */
  get position(): number {
    return this.#pos
  }

  #need(n: number, what: string): number {
    if (n > this.#end - this.#pos) throw outOfBounds(n, this.#end - this.#pos, what)
    const at = this.#pos
    this.#pos += n
    return at
  }

  // ---- fixed-width unsigned, little-endian -------------------------------

  u8(): number {
    return this.#view.getUint8(this.#need(1, 'u8'))
  }

  u16(): number {
    return this.#view.getUint16(this.#need(2, 'u16'), true)
  }

  /** `int<3>` — MySQL's 3-byte integer; `payload_length` is one. */
  u24(): number {
    const at = this.#need(3, 'u24')
    const v = this.#view
    return v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16)
  }

  u32(): number {
    return this.#view.getUint32(this.#need(4, 'u32'), true)
  }

  /** `int<6>` — appears in binlog contexts. Always exact: 2^48 < 2^53. */
  u48(): number {
    const at = this.#need(6, 'u48')
    const v = this.#view
    return v.getUint32(at, true) + v.getUint16(at + 4, true) * 0x1_0000_0000
  }

  /**
   * `int<8>`. Always a `BigInt` from the low-level reader — `affected_rows`
   * and `last_insert_id` can exceed `Number.MAX_SAFE_INTEGER`, and the
   * number-if-safe-else-BigInt policy (D-15) belongs to a higher layer.
   */
  u64(): bigint {
    return this.#view.getBigUint64(this.#need(8, 'u64'), true)
  }

  // ---- fixed-width signed ------------------------------------------------

  i8(): number {
    return this.#view.getInt8(this.#need(1, 'i8'))
  }

  i16(): number {
    return this.#view.getInt16(this.#need(2, 'i16'), true)
  }

  i32(): number {
    return this.#view.getInt32(this.#need(4, 'i32'), true)
  }

  i64(): bigint {
    return this.#view.getBigInt64(this.#need(8, 'i64'), true)
  }

  // ---- floats ------------------------------------------------------------

  f32(): number {
    return this.#view.getFloat32(this.#need(4, 'f32'), true)
  }

  f64(): number {
    return this.#view.getFloat64(this.#need(8, 'f64'), true)
  }

  // ---- byte strings ------------------------------------------------------

  /** `string<fix>` / `string<var>` — exactly `n` bytes, zero-copy. */
  bytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) {
      throw new ProtocolError('PROTOCOL_BAD_LENGTH', `bytes(${n}): length must be a non-negative integer`)
    }
    const at = this.#need(n, 'bytes')
    return this.#bytes.subarray(at, at + n)
  }

  /** Advance without reading. Throws rather than clamping. */
  skip(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new ProtocolError('PROTOCOL_BAD_LENGTH', `skip(${n}): length must be a non-negative integer`)
    }
    this.#need(n, 'skip')
  }

  /** `string<NUL>` — up to the NUL, which is consumed but not returned. */
  nulString(): Uint8Array {
    const start = this.#pos
    let i = start
    while (i < this.#end && this.#view.getUint8(i) !== 0) i++
    if (i === this.#end) {
      throw new ProtocolError('PROTOCOL_UNTERMINATED_STRING', 'string<NUL>: no NUL terminator before end of payload')
    }
    this.#pos = i + 1
    return this.#bytes.subarray(start, i)
  }

  /** `string<EOF>` — runs to the end of the (reassembled) payload. */
  restBytes(): Uint8Array {
    const at = this.#pos
    this.#pos = this.#end
    return this.#bytes.subarray(at, this.#end)
  }

  // ---- length-encoded ----------------------------------------------------

  /**
   * `int<lenenc>` — 1, 3, 4 or 9 bytes.
   *
   * `0xFB` is **NULL**, not the value 251: it is only meaningful as a column
   * value in a text resultset row, and a reader that returns 251 for it will
   * silently corrupt data. `0xFF` is never valid here — that is the ERR
   * packet header.
   */
  lenEncInt(): bigint | null {
    const first = this.u8()
    if (first < LENENC_NULL) return BigInt(first)
    if (first === LENENC_NULL) return null
    if (first === LENENC_U16) return BigInt(this.u16())
    if (first === LENENC_U24) return BigInt(this.u24())
    if (first === LENENC_U64) return this.u64()
    // first === 0xFF
    throw new ProtocolError(
      'PROTOCOL_BAD_LENENC',
      `invalid length-encoded integer prefix 0x${LENENC_INVALID.toString(16)}`,
    )
  }

  /** `string<lenenc>` — a length-encoded integer, then that many bytes. */
  lenEncBytes(): Uint8Array | null {
    const n = this.lenEncInt()
    if (n === null) return null
    if (n > BigInt(this.remaining)) {
      throw outOfBounds(Number(n), this.remaining, 'string<lenenc>')
    }
    return this.bytes(Number(n))
  }
}
