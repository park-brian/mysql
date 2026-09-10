// M2.13 — MySQL's binary JSON format (doc 28).
//
// A `JSON` column does not store text. It stores a representation designed so
// that a path lookup is O(log n) rather than a re-parse, and so that a
// sub-document can be replaced in place. Doc 28: "This format appears in three
// places — `.ibd` files, binlog row images, and `JSON_*` function internals —
// so it is worth implementing once, carefully."
//
// Four things in the grammar are where third-party readers go wrong, and all
// four are the tests below:
//
//   **Small vs large.** Every object and array exists in two forms, and the
//   type byte — not the document — decides which. A small container can hold a
//   large one, so the width of *every* offset is a property of the container
//   being read, never of the document.
//
//   **Offsets are relative to the container**, not to the document. Getting
//   this right for the top level and wrong one level down is the classic bug,
//   because the two coincide at depth 0.
//
//   **Inlining.** A value entry holds either an offset *or the value itself*.
//   Doc 28 calls treating every entry as an offset "a common source of bugs in
//   third-party readers". What fits depends on the container's width, so the
//   same `int32` is inline in a large container and out-of-line in a small one.
//
//   **Key order is length-then-bytes**, and it is *observable*: `JSON_KEYS()`
//   and the text rendering both reflect the stored order, which is why
//   `JSON_OBJECT('b',1,'a',2)` comes back with `a` first. Reproducing it is
//   required for output compatibility, not a nicety.
import { FIELD_TYPE } from '@myjs/bytes'
import { invalidJson } from './errors.ts'
import { decodeStorageValue, type ColumnMeta, type StorageValue } from './values.ts'

/** Type tags, from `sql-common/json_binary.h`'s grammar. */
export const JSON_TYPE = {
  SMALL_OBJECT: 0x00,
  LARGE_OBJECT: 0x01,
  SMALL_ARRAY: 0x02,
  LARGE_ARRAY: 0x03,
  LITERAL: 0x04,
  INT16: 0x05,
  UINT16: 0x06,
  INT32: 0x07,
  UINT32: 0x08,
  INT64: 0x09,
  UINT64: 0x0a,
  DOUBLE: 0x0b,
  STRING: 0x0c,
  /**
   * A non-JSON MySQL value in its *storage* encoding.
   *
   * Note the collision, which is only confusing if you forget these are two
   * namespaces: `0x0f` here is custom-data, while `0x0f` in
   * `enum_field_types` is the internal VARCHAR type. The byte inside a
   * custom-data payload is from the *other* namespace.
   */
  CUSTOM: 0x0f,
} as const

const LITERAL_NULL = 0x00
const LITERAL_TRUE = 0x01
const LITERAL_FALSE = 0x02

/** What a decoded document is made of. `StorageValue` covers custom-data. */
export type JsonValue = null | boolean | number | bigint | string | StorageValue | JsonValue[] | { [key: string]: JsonValue }

function need(bytes: Uint8Array, at: number, n: number, what: string): void {
  if (at < 0 || at + n > bytes.length) {
    throw invalidJson(`${what}: needs ${n} byte(s) at ${at}, document is ${bytes.length}`)
  }
}

function u16(bytes: Uint8Array, at: number): number {
  need(bytes, at, 2, 'uint16')
  return (bytes[at] as number) | ((bytes[at + 1] as number) << 8)
}

function u32(bytes: Uint8Array, at: number): number {
  need(bytes, at, 4, 'uint32')
  return (
    ((bytes[at] as number) |
      ((bytes[at + 1] as number) << 8) |
      ((bytes[at + 2] as number) << 16) |
      ((bytes[at + 3] as number) << 24)) >>>
    0
  )
}

/**
 * The length varint: 7 bits per byte, high bit as a continuation flag,
 * little-endian — the same scheme as Protocol Buffers, and nothing like the
 * length-encoded integers the wire protocol uses.
 */
function varint(bytes: Uint8Array, at: number): { value: number; size: number } {
  let value = 0
  let shift = 0
  let n = 0
  for (;;) {
    need(bytes, at + n, 1, 'varint')
    const b = bytes[at + n] as number
    n++
    value += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return { value, size: n }
    shift += 7
    if (shift > 35) throw invalidJson('varint is longer than five bytes')
  }
}

function isContainer(type: number): boolean {
  return type <= JSON_TYPE.LARGE_ARRAY
}

function isLarge(type: number): boolean {
  return type === JSON_TYPE.LARGE_OBJECT || type === JSON_TYPE.LARGE_ARRAY
}

/**
 * Whether a value of this type is stored *in* its entry rather than at an
 * offset, for a container of this width.
 *
 * From `json_binary.cc`'s `inlined_type`. The width dependence is the point:
 * an `int32` is inline in a large container and out-of-line in a small one,
 * because the entry's value field is 4 bytes there and 2 bytes here.
 */
function isInlined(type: number, large: boolean): boolean {
  switch (type) {
    case JSON_TYPE.LITERAL:
    case JSON_TYPE.INT16:
    case JSON_TYPE.UINT16:
      return true
    case JSON_TYPE.INT32:
    case JSON_TYPE.UINT32:
      return large
    default:
      return false
  }
}

/** Decode one binary JSON document. */
export function decodeJson(bytes: Uint8Array, meta?: Omit<ColumnMeta, 'type'>): JsonValue {
  if (bytes.length === 0) throw invalidJson('empty document')
  return decodeValue(bytes, bytes[0] as number, bytes.subarray(1), meta)
}

/**
 * Decode a value whose bytes start at the beginning of `body`.
 *
 * A container's `body` is the container itself, which is what makes every
 * offset inside it container-relative without any arithmetic at the call site.
 */
function decodeValue(
  document: Uint8Array,
  type: number,
  body: Uint8Array,
  meta?: Omit<ColumnMeta, 'type'>,
): JsonValue {
  switch (type) {
    case JSON_TYPE.SMALL_OBJECT:
    case JSON_TYPE.LARGE_OBJECT:
      return decodeObject(body, isLarge(type), meta)
    case JSON_TYPE.SMALL_ARRAY:
    case JSON_TYPE.LARGE_ARRAY:
      return decodeArray(body, isLarge(type), meta)
    case JSON_TYPE.LITERAL: {
      need(body, 0, 1, 'literal')
      const v = body[0] as number
      if (v === LITERAL_NULL) return null
      if (v === LITERAL_TRUE) return true
      if (v === LITERAL_FALSE) return false
      throw invalidJson(`literal 0x${v.toString(16)} is not null, true or false`)
    }
    case JSON_TYPE.INT16:
      return (u16(body, 0) << 16) >> 16
    case JSON_TYPE.UINT16:
      return u16(body, 0)
    case JSON_TYPE.INT32:
      return u32(body, 0) | 0
    case JSON_TYPE.UINT32:
      return u32(body, 0)
    case JSON_TYPE.INT64: {
      need(body, 0, 8, 'int64')
      return new DataView(body.buffer, body.byteOffset, 8).getBigInt64(0, true)
    }
    case JSON_TYPE.UINT64: {
      need(body, 0, 8, 'uint64')
      return new DataView(body.buffer, body.byteOffset, 8).getBigUint64(0, true)
    }
    case JSON_TYPE.DOUBLE: {
      need(body, 0, 8, 'double')
      return new DataView(body.buffer, body.byteOffset, 8).getFloat64(0, true)
    }
    case JSON_TYPE.STRING: {
      const { value: length, size } = varint(body, 0)
      need(body, size, length, 'string')
      return new TextDecoder().decode(body.subarray(size, size + length))
    }
    case JSON_TYPE.CUSTOM: {
      // Doc 28: "this is how `CAST(NOW() AS JSON)` round-trips a temporal
      // without turning it into a string, and it is why the JSON codec depends
      // on the column codec."
      need(body, 0, 1, 'custom-data type')
      const fieldType = body[0] as number
      const { value: length, size } = varint(body, 1)
      need(body, 1 + size, length, 'custom-data payload')
      const payload = body.subarray(1 + size, 1 + size + length)
      return decodeStorageValue(fieldType, payload, { ...meta, type: fieldType })
    }
    default:
      throw invalidJson(`type 0x${type.toString(16)} is not a JSON type`)
  }
}

interface Header {
  readonly count: number
  readonly size: number
  readonly offsetSize: number
  readonly headerSize: number
}

function readHeader(container: Uint8Array, large: boolean): Header {
  const offsetSize = large ? 4 : 2
  const read = large ? u32 : u16
  const count = read(container, 0)
  const size = read(container, offsetSize)
  // `size` is the whole container's byte length — the field that lets a reader
  // skip a sub-document without parsing it, and the one that says whether the
  // container is even internally consistent.
  if (size > container.length) {
    throw invalidJson(`container claims ${size} bytes but only ${container.length} are present`)
  }
  return { count, size, offsetSize, headerSize: offsetSize * 2 }
}

function readValueEntry(
  container: Uint8Array,
  at: number,
  large: boolean,
  meta?: Omit<ColumnMeta, 'type'>,
): JsonValue {
  need(container, at, 1, 'value entry')
  const type = container[at] as number
  if (isInlined(type, large)) {
    // The value is in the entry itself. Reading it as an offset here is the
    // bug doc 28 warns about.
    return decodeValue(container, type, container.subarray(at + 1), meta)
  }
  const offset = large ? u32(container, at + 1) : u16(container, at + 1)
  if (offset >= container.length) {
    throw invalidJson(`value offset ${offset} is past the end of a ${container.length}-byte container`)
  }
  // Offsets are relative to the *container*, which is exactly why `container`
  // and not the document is passed down.
  return decodeValue(container, type, container.subarray(offset), meta)
}

function decodeArray(container: Uint8Array, large: boolean, meta?: Omit<ColumnMeta, 'type'>): JsonValue[] {
  const { count, offsetSize, headerSize } = readHeader(container, large)
  const entrySize = 1 + offsetSize
  const out: JsonValue[] = []
  for (let i = 0; i < count; i++) out.push(readValueEntry(container, headerSize + i * entrySize, large, meta))
  return out
}

function decodeObject(
  container: Uint8Array,
  large: boolean,
  meta?: Omit<ColumnMeta, 'type'>,
): { [key: string]: JsonValue } {
  const { count, offsetSize, headerSize } = readHeader(container, large)
  const keyEntrySize = offsetSize + 2
  const valueEntrySize = 1 + offsetSize
  const valueEntries = headerSize + count * keyEntrySize
  const out: { [key: string]: JsonValue } = {}
  for (let i = 0; i < count; i++) {
    const keyEntry = headerSize + i * keyEntrySize
    const keyOffset = large ? u32(container, keyEntry) : u16(container, keyEntry)
    // Key length is uint16 whatever the container width — doc 28: "keys must
    // be < 64 KB".
    const keyLength = u16(container, keyEntry + offsetSize)
    need(container, keyOffset, keyLength, 'key')
    const key = new TextDecoder().decode(container.subarray(keyOffset, keyOffset + keyLength))
    // `defineProperty` rather than `out[key] = …`, because a stored document is
    // untrusted input and `__proto__` is a legal JSON key. Plain assignment
    // would walk into the prototype setter instead of creating an own
    // property, which is prototype pollution reachable from a table row.
    Object.defineProperty(out, key, {
      value: readValueEntry(container, valueEntries + i * valueEntrySize, large, meta),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

// --- encoding --------------------------------------------------------------

/**
 * MySQL's key order: length first, then bytes.
 *
 * Observable through `JSON_KEYS()` and through the text rendering, so it is
 * part of the format rather than an implementation detail. It is also why
 * MySQL appears to reorder your object: it is not preserving insertion order,
 * it is storing the sorted form.
 */
export function compareJsonKeys(a: string, b: string): number {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ab.length !== bb.length) return ab.length - bb.length
  for (let i = 0; i < ab.length; i++) {
    if (ab[i] !== bb[i]) return (ab[i] as number) - (bb[i] as number)
  }
  return 0
}

interface Encoded {
  readonly type: number
  /** The value's own bytes, empty when the type is inlined. */
  readonly body: Uint8Array
  /** The inline payload, for a type that has one. */
  readonly inline?: number
}

function encodeScalar(value: JsonValue): Encoded {
  if (value === null) return { type: JSON_TYPE.LITERAL, body: new Uint8Array(0), inline: LITERAL_NULL }
  if (value === true) return { type: JSON_TYPE.LITERAL, body: new Uint8Array(0), inline: LITERAL_TRUE }
  if (value === false) return { type: JSON_TYPE.LITERAL, body: new Uint8Array(0), inline: LITERAL_FALSE }

  if (typeof value === 'bigint') {
    const body = new Uint8Array(8)
    const view = new DataView(body.buffer)
    if (value < 0n) {
      view.setBigInt64(0, value, true)
      return { type: JSON_TYPE.INT64, body }
    }
    view.setBigUint64(0, value, true)
    return { type: JSON_TYPE.UINT64, body }
  }

  if (typeof value === 'number') {
    // `Object.is` rather than `===`, because `-0 === 0`. Negative zero is a
    // *double* in JSON and `float8store` preserves its sign, so narrowing it to
    // an integer type would silently drop that — the mirror image of M2.10,
    // where DECIMAL has no negative zero and normalising it was the fix.
    if (Number.isInteger(value) && !Object.is(value, -0)) {
      if (value >= -0x8000 && value <= 0x7fff) {
        return { type: JSON_TYPE.INT16, body: new Uint8Array(0), inline: value & 0xffff }
      }
      if (value >= 0 && value <= 0xffff) {
        return { type: JSON_TYPE.UINT16, body: new Uint8Array(0), inline: value }
      }
      if (value >= -0x80000000 && value <= 0x7fffffff) {
        return { type: JSON_TYPE.INT32, body: int32Body(value), inline: value >>> 0 }
      }
      if (value >= 0 && value <= 0xffffffff) {
        return { type: JSON_TYPE.UINT32, body: int32Body(value), inline: value >>> 0 }
      }
    }
    const body = new Uint8Array(8)
    new DataView(body.buffer).setFloat64(0, value, true)
    return { type: JSON_TYPE.DOUBLE, body }
  }

  if (typeof value === 'string') {
    const utf8 = new TextEncoder().encode(value)
    const length = writeVarint(utf8.length)
    const body = new Uint8Array(length.length + utf8.length)
    body.set(length)
    body.set(utf8, length.length)
    return { type: JSON_TYPE.STRING, body }
  }

  throw invalidJson(`cannot encode ${typeof value} as JSON`)
}

function int32Body(value: number): Uint8Array {
  const body = new Uint8Array(4)
  new DataView(body.buffer).setInt32(0, value | 0, true)
  return body
}

function writeVarint(n: number): Uint8Array {
  const out: number[] = []
  let v = n
  do {
    const b = v & 0x7f
    v = Math.floor(v / 128)
    out.push(v > 0 ? b | 0x80 : b)
  } while (v > 0)
  return Uint8Array.from(out)
}

function encodeAny(value: JsonValue, large: boolean): Encoded {
  if (Array.isArray(value)) {
    return { type: large ? JSON_TYPE.LARGE_ARRAY : JSON_TYPE.SMALL_ARRAY, body: encodeArrayBody(value, large) }
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Uint8Array) && !(value instanceof Date)) {
    const object = value as { [key: string]: JsonValue }
    return {
      type: large ? JSON_TYPE.LARGE_OBJECT : JSON_TYPE.SMALL_OBJECT,
      body: encodeObjectBody(object, large),
    }
  }
  return encodeScalar(value)
}

function putOffset(out: Uint8Array, at: number, value: number, large: boolean): void {
  const view = new DataView(out.buffer, out.byteOffset)
  if (large) view.setUint32(at, value, true)
  else view.setUint16(at, value, true)
}

function encodeArrayBody(values: readonly JsonValue[], large: boolean): Uint8Array {
  const offsetSize = large ? 4 : 2
  const headerSize = offsetSize * 2
  const entrySize = 1 + offsetSize
  const encoded = values.map((v) => encodeAny(v, large))

  let cursor = headerSize + values.length * entrySize
  const bodies: Array<{ at: number; bytes: Uint8Array } | null> = []
  for (const e of encoded) {
    if (isInlined(e.type, large)) {
      bodies.push(null)
      continue
    }
    bodies.push({ at: cursor, bytes: e.body })
    cursor += e.body.length
  }

  const out = new Uint8Array(cursor)
  putOffset(out, 0, values.length, large)
  putOffset(out, offsetSize, cursor, large)
  encoded.forEach((e, i) => {
    const at = headerSize + i * entrySize
    out[at] = e.type
    const placed = bodies[i]
    if (placed === null || placed === undefined) putOffset(out, at + 1, e.inline ?? 0, large)
    else {
      putOffset(out, at + 1, placed.at, large)
      out.set(placed.bytes, placed.at)
    }
  })
  return out
}

function encodeObjectBody(object: { [key: string]: JsonValue }, large: boolean): Uint8Array {
  const offsetSize = large ? 4 : 2
  const headerSize = offsetSize * 2
  const keyEntrySize = offsetSize + 2
  const valueEntrySize = 1 + offsetSize

  const keys = Object.keys(object).sort(compareJsonKeys)
  const keyBytes = keys.map((k) => new TextEncoder().encode(k))
  const encoded = keys.map((k) => encodeAny(object[k] as JsonValue, large))

  let cursor = headerSize + keys.length * (keyEntrySize + valueEntrySize)
  const keyAt = keyBytes.map((b) => {
    const at = cursor
    cursor += b.length
    return at
  })
  const bodies: Array<{ at: number; bytes: Uint8Array } | null> = []
  for (const e of encoded) {
    if (isInlined(e.type, large)) {
      bodies.push(null)
      continue
    }
    bodies.push({ at: cursor, bytes: e.body })
    cursor += e.body.length
  }

  const out = new Uint8Array(cursor)
  putOffset(out, 0, keys.length, large)
  putOffset(out, offsetSize, cursor, large)
  keys.forEach((_, i) => {
    const at = headerSize + i * keyEntrySize
    putOffset(out, at, keyAt[i] as number, large)
    new DataView(out.buffer, out.byteOffset).setUint16(at + offsetSize, (keyBytes[i] as Uint8Array).length, true)
    out.set(keyBytes[i] as Uint8Array, keyAt[i] as number)
  })
  const valueEntries = headerSize + keys.length * keyEntrySize
  encoded.forEach((e, i) => {
    const at = valueEntries + i * valueEntrySize
    out[at] = e.type
    const placed = bodies[i]
    if (placed === null || placed === undefined) putOffset(out, at + 1, e.inline ?? 0, large)
    else {
      putOffset(out, at + 1, placed.at, large)
      out.set(placed.bytes, placed.at)
    }
  })
  return out
}

/** The largest a small container may be, since its offsets are `uint16`. */
const SMALL_LIMIT = 0xffff

/**
 * Encode one binary JSON document.
 *
 * Small is attempted first and large is the fallback, which is what makes a
 * large container nested inside a small one impossible and a small one nested
 * inside a large one ordinary — the widths are chosen bottom-up, per container,
 * exactly as the format allows.
 */
export function encodeJson(value: JsonValue): Uint8Array {
  let encoded = encodeAny(value, false)
  if (isContainer(encoded.type) && encoded.body.length > SMALL_LIMIT) encoded = encodeAny(value, true)
  const out = new Uint8Array(1 + encoded.body.length + (isInlined(encoded.type, false) ? inlineWidth(encoded.type) : 0))
  out[0] = encoded.type
  if (isInlined(encoded.type, false)) {
    // A bare scalar document has no entry to be inlined into, so the value
    // follows the type byte in its own right.
    if (encoded.type === JSON_TYPE.LITERAL) out[1] = encoded.inline ?? 0
    else new DataView(out.buffer).setUint16(1, encoded.inline ?? 0, true)
    return out
  }
  out.set(encoded.body, 1)
  return out
}

function inlineWidth(type: number): number {
  return type === JSON_TYPE.LITERAL ? 1 : 2
}

/** The MySQL field type a JSON column's storage bytes carry. */
export const JSON_FIELD_TYPE = FIELD_TYPE.JSON
