// M0.4 — `Writer`.
//
// Doc 11 gives no class sketch for the writer, only rule 4: "The writer grows
// geometrically and emits the 4-byte header last, once the payload length is
// known — or, better, reserves the header and backfills, so a large resultset
// is written in one pass." This mirrors `Reader`'s surface method for method
// and does the reserve-and-backfill version.
//
// Length-encoded writes are **canonical shortest**. Real clients are tolerant,
// but byte-for-byte comparison against captured traces (doc 43 §3) is only
// possible if we are canonical — so `lenEncInt(250)` is one byte and
// `lenEncInt(251)` is three.

import { ProtocolError } from './errors.ts'

const LENENC_NULL = 0xfb
const LENENC_U16 = 0xfc
const LENENC_U24 = 0xfd
const LENENC_U64 = 0xfe

const U16_MAX = 0xffff
const U24_MAX = 0xffffff
const U64_MAX = 0xffff_ffff_ffff_ffffn

export class Writer {
  #bytes: Uint8Array
  #view: DataView
  #pos = 0

  constructor(initialCapacity = 256) {
    const cap = Math.max(16, initialCapacity)
    this.#bytes = new Uint8Array(cap)
    this.#view = new DataView(this.#bytes.buffer)
  }

  /** Bytes written so far. */
  get length(): number {
    return this.#pos
  }

  /**
   * Geometric growth: double until it fits, so N appends cost O(N).
   *
   * Callers must resolve this into a local *before* touching `this.#view` —
   * a member expression is evaluated before its arguments, so the inline form
   * `this.#view.setUint8(this.#ensure(1), v)` would write through the
   * pre-growth DataView and throw on the first reallocation.
   */
  #ensure(n: number): number {
    const need = this.#pos + n
    if (need > this.#bytes.length) {
      let cap = this.#bytes.length
      while (cap < need) cap *= 2
      const grown = new Uint8Array(cap)
      grown.set(this.#bytes.subarray(0, this.#pos))
      this.#bytes = grown
      this.#view = new DataView(grown.buffer)
    }
    const at = this.#pos
    this.#pos += n
    return at
  }

  // ---- fixed-width unsigned, little-endian -------------------------------

  u8(v: number): this {
    const at = this.#ensure(1)
    this.#view.setUint8(at, v & 0xff)
    return this
  }

  u16(v: number): this {
    const at = this.#ensure(2)
    this.#view.setUint16(at, v & 0xffff, true)
    return this
  }

  /** `int<3>` — the packet header's `payload_length` is one. */
  u24(v: number): this {
    const at = this.#ensure(3)
    this.#view.setUint8(at, v & 0xff)
    this.#view.setUint8(at + 1, (v >>> 8) & 0xff)
    this.#view.setUint8(at + 2, (v >>> 16) & 0xff)
    return this
  }

  u32(v: number): this {
    const at = this.#ensure(4)
    this.#view.setUint32(at, v >>> 0, true)
    return this
  }

  /** `int<6>`. */
  u48(v: number): this {
    const at = this.#ensure(6)
    const lo = v % 0x1_0000_0000
    const hi = Math.floor(v / 0x1_0000_0000)
    this.#view.setUint32(at, lo >>> 0, true)
    this.#view.setUint16(at + 4, hi & 0xffff, true)
    return this
  }

  u64(v: bigint | number): this {
    const at = this.#ensure(8)
    this.#view.setBigUint64(at, BigInt(v) & U64_MAX, true)
    return this
  }

  // ---- fixed-width signed ------------------------------------------------

  i8(v: number): this {
    const at = this.#ensure(1)
    this.#view.setInt8(at, v)
    return this
  }

  i16(v: number): this {
    const at = this.#ensure(2)
    this.#view.setInt16(at, v, true)
    return this
  }

  i32(v: number): this {
    const at = this.#ensure(4)
    this.#view.setInt32(at, v, true)
    return this
  }

  i64(v: bigint | number): this {
    const at = this.#ensure(8)
    this.#view.setBigInt64(at, BigInt(v), true)
    return this
  }

  // ---- floats ------------------------------------------------------------

  f32(v: number): this {
    const at = this.#ensure(4)
    this.#view.setFloat32(at, v, true)
    return this
  }

  f64(v: number): this {
    const at = this.#ensure(8)
    this.#view.setFloat64(at, v, true)
    return this
  }

  // ---- byte strings ------------------------------------------------------

  /** `string<fix>` / `string<var>` / `string<EOF>` — raw bytes. */
  bytes(src: Uint8Array): this {
    const at = this.#ensure(src.length)
    this.#bytes.set(src, at)
    return this
  }

  /** `n` zero bytes — handshake filler and reserved fields. */
  zeros(n: number): this {
    const at = this.#ensure(n)
    this.#bytes.fill(0, at, at + n)
    return this
  }

  /** `string<NUL>` — the bytes, then the terminator. */
  nulString(src: Uint8Array): this {
    return this.bytes(src).u8(0)
  }

  // ---- length-encoded ----------------------------------------------------

  /**
   * `int<lenenc>`, shortest form. `null` writes the single byte `0xFB`, which
   * is NULL — only valid as a column value in a text resultset row.
   */
  lenEncInt(v: number | bigint | null): this {
    if (v === null) return this.u8(LENENC_NULL)
    if (typeof v === 'bigint') {
      if (v < 0n || v > U64_MAX) {
        throw new ProtocolError('PROTOCOL_BAD_LENENC', `length-encoded integer out of range: ${v}`)
      }
      if (v > BigInt(U24_MAX)) return this.u8(LENENC_U64).u64(v)
      return this.lenEncInt(Number(v))
    }
    if (!Number.isInteger(v) || v < 0) {
      throw new ProtocolError('PROTOCOL_BAD_LENENC', `length-encoded integer out of range: ${v}`)
    }
    if (v < LENENC_NULL) return this.u8(v)
    if (v <= U16_MAX) return this.u8(LENENC_U16).u16(v)
    if (v <= U24_MAX) return this.u8(LENENC_U24).u24(v)
    return this.u8(LENENC_U64).u64(BigInt(v))
  }

  /** `string<lenenc>`; `null` writes the bare `0xFB`. */
  lenEncBytes(src: Uint8Array | null): this {
    if (src === null) return this.u8(LENENC_NULL)
    return this.lenEncInt(src.length).bytes(src)
  }

  // ---- reserve and backfill ---------------------------------------------

  /**
   * Reserve `n` bytes (zeroed) and return their offset, so a header can be
   * written before its length is known. The packet framer reserves 4 and
   * backfills `payload_length` + `sequence_id` once the payload is complete.
   */
  reserve(n: number): number {
    const at = this.#ensure(n)
    this.#bytes.fill(0, at, at + n)
    return at
  }

  patchU8(offset: number, v: number): void {
    this.#assertInside(offset, 1)
    this.#view.setUint8(offset, v & 0xff)
  }

  patchU24(offset: number, v: number): void {
    this.#assertInside(offset, 3)
    this.#view.setUint8(offset, v & 0xff)
    this.#view.setUint8(offset + 1, (v >>> 8) & 0xff)
    this.#view.setUint8(offset + 2, (v >>> 16) & 0xff)
  }

  #assertInside(offset: number, n: number): void {
    if (offset < 0 || offset + n > this.#pos) {
      throw new ProtocolError('PROTOCOL_BAD_PATCH', `patch at ${offset}..${offset + n} is outside the ${this.#pos} bytes written`)
    }
  }

  // ---- output ------------------------------------------------------------

  /** A zero-copy view of what has been written. Invalidated by later writes. */
  view(): Uint8Array {
    return this.#bytes.subarray(0, this.#pos)
  }

  /** A copy of what has been written, safe to retain. */
  toBytes(): Uint8Array {
    return this.#bytes.slice(0, this.#pos)
  }

  /** Reset to empty, keeping the allocated capacity. */
  reset(): void {
    this.#pos = 0
  }
}
