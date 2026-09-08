// M1.1, M1.2 — packet framing and sequence ids.
//
// Doc 10's implementation note 2: "Frame first, parse second. A `PacketReader`
// that yields complete reassembled payloads (handling the 16 MiB split and
// sequence validation) keeps every packet parser trivial and independently
// fuzzable."
//
// Doc 17 fixes the *shape*: "The envelope boundary is unrelated to the packet
// boundary. One compressed envelope may carry a fragment of a MySQL packet, or
// several whole packets. The decompressor must feed a byte stream to the
// packet framer, not try to align them." So this is a streaming byte consumer,
// not a `parsePacket(buffer)` function — a compression layer can be spliced
// underneath it later without touching it.
//
// Note 4: "Sequence ids belong to the framer, not to the packet types."

import { Writer } from '@myjs/bytes'
import { DEFAULT_MAX_ALLOWED_PACKET } from './constants/commands.ts'
import { messages } from './errors/messages.ts'
import { protocolError } from './errors/index.ts'

/** `0xFFFFFF`. A payload of this length is always continued. */
export const MAX_PAYLOAD = 0xffffff
export const HEADER_SIZE = 4

export interface FramerOptions {
  /**
   * Cap on a *reassembled* payload. D-31 defaults it to MySQL's 64 MiB and
   * enforces it during reassembly, so a hostile peer cannot make us allocate
   * first and complain afterwards.
   */
  readonly maxAllowedPacket?: number
}

export class PacketFramer {
  readonly maxAllowedPacket: number

  /** Received bytes not yet consumed by a complete packet. */
  #buf: Uint8Array
  #start = 0
  #end = 0

  /**
   * The single sequence counter both directions share.
   *
   * Reading a packet requires it to carry this value and then advances it;
   * writing stamps it and advances it. That is exactly MySQL's rule: the
   * client's `COM_*` is sequence 0 and the server's first response packet is 1.
   */
  #seq = 0

  /** Chunks of a >16 MiB message accumulated so far, or null when not mid-message. */
  #partial: Uint8Array[] | null = null
  #partialLen = 0

  constructor(options: FramerOptions = {}) {
    this.maxAllowedPacket = options.maxAllowedPacket ?? DEFAULT_MAX_ALLOWED_PACKET
    this.#buf = new Uint8Array(8192)
  }

  /** The value the next packet read must carry, and the next packet written will. */
  get sequenceId(): number {
    return this.#seq
  }

  /**
   * Reset to 0 at the start of a new command.
   *
   * Doc 10: the counter resets per command in the command phase, but runs
   * *continuously* through the whole connection phase — so this is called by
   * the connection when it is about to read a `COM_*`, and never during auth.
   * `COM_CHANGE_USER` is the one place the two rules meet: it re-enters the
   * connection phase, and its auth exchange continues from that command's
   * sequence 0 rather than resetting again.
   */
  resetSequence(): void {
    this.#seq = 0
  }

  /** Bytes buffered but not yet forming a complete packet. */
  get buffered(): number {
    return this.#end - this.#start
  }

  /** True while a >16 MiB message is partially reassembled. */
  get midMessage(): boolean {
    return this.#partial !== null
  }

  /** Append received bytes. Any framing they complete is available from `next()`. */
  feed(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.#reserve(chunk.length)
    this.#buf.set(chunk, this.#end)
    this.#end += chunk.length
  }

  #reserve(n: number): void {
    if (this.#end + n <= this.#buf.length) return
    const live = this.#end - this.#start
    if (live + n <= this.#buf.length && this.#start > 0) {
      // Compaction is enough; no need to grow.
      this.#buf.copyWithin(0, this.#start, this.#end)
      this.#end = live
      this.#start = 0
      return
    }
    let cap = this.#buf.length
    while (cap < live + n) cap *= 2
    const grown = new Uint8Array(cap)
    grown.set(this.#buf.subarray(this.#start, this.#end))
    this.#buf = grown
    this.#end = live
    this.#start = 0
  }

  /**
   * The next complete, reassembled payload, or `null` if more bytes are needed.
   *
   * A zero-length payload is a real message and is returned as such — it means
   * "end of a 16 MiB run" or "end of `LOCAL INFILE` data" (doc 17), and a
   * framer that swallows it leaves the peer waiting forever.
   */
  next(): Uint8Array | null {
    for (;;) {
      if (this.#end - this.#start < HEADER_SIZE) return null
      const b = this.#buf
      const h = this.#start
      const payloadLength = (b[h] as number) | ((b[h + 1] as number) << 8) | ((b[h + 2] as number) << 16)
      const seq = b[h + 3] as number

      // Refuse before allocating: the accumulated size is what matters, and
      // this chunk's length is known from the header alone.
      const wouldBe = this.#partialLen + payloadLength
      if (wouldBe > this.maxAllowedPacket) {
        throw protocolError('ER_NET_PACKET_TOO_LARGE', messages.packetTooLarge(this.maxAllowedPacket))
      }

      if (this.#end - this.#start < HEADER_SIZE + payloadLength) return null

      if (seq !== this.#seq) {
        throw protocolError('ER_NET_PACKETS_OUT_OF_ORDER', messages.packetsOutOfOrder(this.#seq, seq))
      }
      this.#seq = (this.#seq + 1) & 0xff

      const from = this.#start + HEADER_SIZE
      const to = from + payloadLength
      this.#start = to
      if (this.#start === this.#end) {
        this.#start = 0
        this.#end = 0
      }

      if (payloadLength === MAX_PAYLOAD) {
        // Continued. Keep the chunk and read the next header.
        ;(this.#partial ??= []).push(b.slice(from, to))
        this.#partialLen += payloadLength
        continue
      }

      if (this.#partial === null) return b.slice(from, to)

      // Final chunk of a split message — including the empty packet that
      // terminates a message whose length is an exact multiple of 16 MiB.
      const parts = this.#partial
      const total = this.#partialLen + payloadLength
      const out = new Uint8Array(total)
      let at = 0
      for (const part of parts) {
        out.set(part, at)
        at += part.length
      }
      out.set(b.subarray(from, to), at)
      this.#partial = null
      this.#partialLen = 0
      return out
    }
  }

  /** Every complete packet currently available. */
  *drain(): Generator<Uint8Array> {
    for (;;) {
      const packet = this.next()
      if (packet === null) return
      yield packet
    }
  }

  /**
   * Frame a payload for sending, stamping and advancing the sequence id.
   *
   * A message of exactly 16777215 bytes is followed by an empty packet — the
   * consequence people get wrong (doc 10). The loop below produces it without
   * a special case: the run continues while a chunk is exactly `MAX_PAYLOAD`,
   * so a final chunk of length 0 is emitted naturally.
   */
  encode(payload: Uint8Array): Uint8Array {
    const chunks = Math.floor(payload.length / MAX_PAYLOAD) + 1
    const w = new Writer(payload.length + chunks * HEADER_SIZE)
    let offset = 0
    for (;;) {
      const chunk = Math.min(MAX_PAYLOAD, payload.length - offset)
      w.u24(chunk)
      w.u8(this.#seq)
      this.#seq = (this.#seq + 1) & 0xff
      w.bytes(payload.subarray(offset, offset + chunk))
      offset += chunk
      if (chunk < MAX_PAYLOAD) break
    }
    return w.toBytes()
  }
}
