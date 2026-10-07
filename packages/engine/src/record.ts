// M4.5 — the record: what a clustered leaf stores for a row (doc 22 §Records).
//
// A null bitmap, then a length for each variable-length field that is not
// null, then the field bytes in column order. Lengths, not offsets, which is
// what COMPACT chose over REDUNDANT. The field bytes are doc 24's storage
// encodings, which `@myjs/types` produces and this module never interprets
// (D-22): a record is bytes made of bytes.
//
// A length is one byte when it is under 128 and the field is inline, and
// otherwise two: the high bit set, the next bit marking an off-page field, and
// 14 bits of length. An off-page field (DYNAMIC's atomic BLOB, D-20) is an
// 8-byte reference inline and no local prefix. Which fields go off-page is
// DYNAMIC's rule: while the record is over its budget, the longest inline
// variable-length field over 40 bytes moves out. The codec is told how to store
// one and stays a pure function of its inputs.
import type { Reader, Writer } from '@myjs/bytes'
import { EngineError, misuse, rowTooBig } from './errors.ts'
import { REF_SIZE } from './overflow.ts'

export interface RecordField {
  readonly nullable: boolean
  /** The width of a fixed-length field. Absent for a variable-length one. */
  readonly fixed?: number
}

export type RecordLayout = readonly RecordField[]

/** A field as stored inline, or `null`. */
export type FieldBytes = Uint8Array | null

/** A field `decodeRecord` found off-page: its 8-byte reference. */
export interface OffPage {
  readonly ref: Uint8Array
}

/** Fields no longer than this stay inline whatever the record's size (DYNAMIC's rule). */
export const OFF_PAGE_MIN = 40
/** The longest inline variable-length field a two-byte length can carry. */
const MAX_INLINE = 0x3fff

const badRecord = (what: string): EngineError => new EngineError('ENGINE_CORRUPT_RECORD', what)

export interface EncodeOptions {
  /** The record's budget in bytes. */
  readonly maxSize: number
  /** Store a field off-page and return its reference. Without it, an oversized record is refused. */
  readonly storeExternal?: (bytes: Uint8Array) => Uint8Array
}

/** Encode a row's field bytes. */
export function encodeRecord(layout: RecordLayout, fields: readonly FieldBytes[], options: EncodeOptions): Uint8Array {
  if (fields.length !== layout.length) throw misuse(`${fields.length} fields for a ${layout.length}-field layout`)
  const external = new Array<boolean>(layout.length).fill(false)
  for (let i = 0; i < layout.length; i++) {
    const f = layout[i] as RecordField
    const v = fields[i] ?? null
    if (v === null) {
      if (!f.nullable) throw misuse(`field ${i} is NOT NULL`)
    } else if (f.fixed !== undefined && v.length !== f.fixed) {
      throw misuse(`field ${i} is ${f.fixed} bytes wide, given ${v.length}`)
    }
  }
  for (;;) {
    const size = encodedSize(layout, fields, external)
    const longest = longestInline(layout, fields, external, size > options.maxSize ? OFF_PAGE_MIN : MAX_INLINE)
    if (size <= options.maxSize && longest === -1) break
    if (longest === -1 || options.storeExternal === undefined) throw rowTooBig(options.maxSize)
    external[longest] = true
  }
  const out = new Uint8Array(encodedSize(layout, fields, external))
  let at = nullBitmapSize(layout)
  let nullable = 0
  for (let i = 0; i < layout.length; i++) {
    const f = layout[i] as RecordField
    const v = fields[i] ?? null
    if (f.nullable) {
      if (v === null) out[nullable >> 3] = (out[nullable >> 3] as number) | (1 << (nullable & 7))
      nullable++
    }
    if (v === null || f.fixed !== undefined) continue
    const length = external[i] === true ? REF_SIZE : v.length
    if (length < 0x80 && external[i] !== true) {
      out[at++] = length
    } else {
      out[at++] = 0x80 | (external[i] === true ? 0x40 : 0) | (length >> 8)
      out[at++] = length & 0xff
    }
  }
  for (let i = 0; i < layout.length; i++) {
    const v = fields[i] ?? null
    if (v === null) continue
    const bytes = external[i] === true ? (options.storeExternal as (b: Uint8Array) => Uint8Array)(v) : v
    if (bytes.length !== (external[i] === true ? REF_SIZE : v.length)) throw misuse('storeExternal returned a reference of the wrong size')
    out.set(bytes, at)
    at += bytes.length
  }
  return out
}

/** Decode a record into its fields: bytes, `null`, or an off-page reference. Any bytes may be passed. */
export function decodeRecord(layout: RecordLayout, bytes: Uint8Array): (FieldBytes | OffPage)[] {
  let at = nullBitmapSize(layout)
  if (bytes.length < at) throw badRecord('shorter than its null bitmap')
  const isNull: boolean[] = []
  let nullable = 0
  for (const f of layout) {
    if (!f.nullable) isNull.push(false)
    else {
      isNull.push((((bytes[nullable >> 3] as number) >> (nullable & 7)) & 1) === 1)
      nullable++
    }
  }
  const lengths: number[] = []
  const external: boolean[] = []
  for (let i = 0; i < layout.length; i++) {
    const f = layout[i] as RecordField
    if (isNull[i] === true) {
      lengths.push(0)
      external.push(false)
    } else if (f.fixed !== undefined) {
      lengths.push(f.fixed)
      external.push(false)
    } else {
      if (at >= bytes.length) throw badRecord('the length array runs past the record')
      const b = bytes[at++] as number
      if (b < 0x80) {
        lengths.push(b)
        external.push(false)
      } else {
        if (at >= bytes.length) throw badRecord('the length array runs past the record')
        lengths.push(((b & 0x3f) << 8) | (bytes[at++] as number))
        external.push((b & 0x40) !== 0)
        if (external[i] === true && lengths[i] !== REF_SIZE) throw badRecord(`an off-page field with a ${lengths[i]}-byte reference`)
      }
    }
  }
  const out: (FieldBytes | OffPage)[] = []
  for (let i = 0; i < layout.length; i++) {
    if (isNull[i] === true) {
      out.push(null)
      continue
    }
    const length = lengths[i] as number
    if (at + length > bytes.length) throw badRecord(`field ${i} runs past the record`)
    const v = bytes.slice(at, at + length)
    at += length
    out.push(external[i] === true ? { ref: v } : v)
  }
  if (at !== bytes.length) throw badRecord(`${bytes.length - at} byte(s) after the last field`)
  return out
}

/**
 * A layout as bytes, for the one place the store keeps one: an undo record
 * that drops a tree. A count, then per field a flag byte — bit 0 nullable,
 * bit 1 fixed — and a fixed field's width.
 */
export function encodeLayout(w: Writer, layout: RecordLayout): void {
  w.lenEncInt(layout.length)
  for (const f of layout) {
    w.u8((f.nullable ? 1 : 0) | (f.fixed !== undefined ? 2 : 0))
    if (f.fixed !== undefined) w.lenEncInt(f.fixed)
  }
}

export function decodeLayout(r: Reader): RecordLayout {
  const n = Number(r.lenEncInt())
  if (n > r.remaining) throw badRecord(`a ${n}-field layout longer than its bytes`)
  const out: RecordField[] = []
  for (let i = 0; i < n; i++) {
    const flags = r.u8()
    if ((flags & ~3) !== 0) throw badRecord(`layout field flags ${flags}`)
    out.push((flags & 2) !== 0 ? { nullable: (flags & 1) !== 0, fixed: Number(r.lenEncInt()) } : { nullable: (flags & 1) !== 0 })
  }
  return out
}

/** The off-page references a record holds — what must be freed when it is deleted or replaced. */
export function externalRefs(layout: RecordLayout, bytes: Uint8Array): Uint8Array[] {
  return decodeRecord(layout, bytes).flatMap((v) => (v !== null && !(v instanceof Uint8Array) ? [v.ref] : []))
}

function nullBitmapSize(layout: RecordLayout): number {
  let n = 0
  for (const f of layout) if (f.nullable) n++
  return (n + 7) >> 3
}

function encodedSize(layout: RecordLayout, fields: readonly FieldBytes[], external: readonly boolean[]): number {
  let size = nullBitmapSize(layout)
  for (let i = 0; i < layout.length; i++) {
    const v = fields[i] ?? null
    if (v === null) continue
    if ((layout[i] as RecordField).fixed !== undefined) {
      size += v.length
      continue
    }
    const length = external[i] === true ? REF_SIZE : v.length
    size += length + (length < 0x80 && external[i] !== true ? 1 : 2)
  }
  return size
}

/** The longest inline variable-length field longer than `over`, or -1. */
function longestInline(layout: RecordLayout, fields: readonly FieldBytes[], external: readonly boolean[], over: number): number {
  let best = -1
  let bestLength = over
  for (let i = 0; i < layout.length; i++) {
    const v = fields[i] ?? null
    if (v === null || external[i] === true || (layout[i] as RecordField).fixed !== undefined) continue
    if (v.length > bestLength) {
      best = i
      bestLength = v.length
    }
  }
  return best
}
