// M5.36 — the values of doc 42's query API, as `mysql2` 3.24.3 gives them.
//
// Doc 42 shapes the API on `mysql2/promise` so that most users need learn
// nothing, and the values are most of what they would otherwise have to
// learn: an INT is a number, a DECIMAL a string, a DATETIME a `Date` in local
// time, a BIGINT a number that may lose precision unless `supportBigNumbers`
// says otherwise, a JSON column parsed. Each rule here is `mysql2`'s, read
// out of its `static_text_parser.js`, `static_binary_parser.js`,
// `packets/packet.js` and `encode_parameter.js`, and checked against
// `mysql2` itself by `test/protocol/api-query.test.ts`, which runs the same
// statements through both and compares what comes back.
//
// Two deliberate differences, both from ground rule 1: bytes are a
// `Uint8Array` where `mysql2` gives a `Buffer`, and a `Uint8Array` parameter
// is sent as bytes (a BLOB) as `mysql2` sends a `Buffer`.
import { FIELD_TYPE, Reader, Writer } from '@myjs/bytes'
import { COLUMN_FLAG, COM, type ColumnDefinition } from '@myjs/protocol'
import { collationInfo, decodeCollation } from '@myjs/charsets'

/** The options that change a value's JavaScript form: `mysql2`'s, by the same names. */
export interface TypeOptions {
  /** A BIGINT past 2^53 as an exact string. */
  readonly supportBigNumbers?: boolean
  /** With `supportBigNumbers`, every BIGINT as a string. */
  readonly bigNumberStrings?: boolean
  /** DATE, DATETIME and TIMESTAMP as their text, all of them or the types named. */
  readonly dateStrings?: boolean | readonly ('DATE' | 'DATETIME' | 'TIMESTAMP')[]
  /** DECIMAL as a number. */
  readonly decimalNumbers?: boolean
  /** JSON as its text. */
  readonly jsonStrings?: boolean
  /** The zone a DATETIME is read in and a `Date` written in: 'local', 'Z' or '±HH:MM'. */
  readonly timezone?: string
}

/** A result column, with `mysql2`'s field names. */
export interface FieldInfo {
  readonly catalog: string
  readonly schema: string
  readonly db: string
  readonly table: string
  readonly orgTable: string
  readonly name: string
  readonly orgName: string
  readonly characterSet: number
  readonly encoding: string
  readonly columnLength: number
  readonly columnType: number
  readonly type: number
  readonly flags: number
  readonly decimals: number
}

export function fieldInfo(c: ColumnDefinition): FieldInfo {
  return {
    catalog: 'def',
    schema: c.schema ?? '',
    db: c.schema ?? '',
    table: c.table ?? '',
    orgTable: c.orgTable ?? '',
    name: c.name,
    orgName: c.orgName ?? '',
    characterSet: c.characterSet,
    encoding: c.characterSet === BINARY ? 'binary' : 'utf8',
    columnLength: c.columnLength,
    columnType: c.type,
    type: c.type,
    flags: c.flags,
    decimals: c.decimals,
  }
}

const BINARY = 63
const ZERO_DATE = '0000-00-00'
const utf8 = new TextDecoder()

const pad = (n: number, v: number | string): string => {
  const s = String(v)
  return s.length >= n ? s : ('0'.repeat(n) + s).slice(-n)
}

const datesAsText = (type: number, o: TypeOptions): boolean => {
  const d = o.dateStrings
  if (Array.isArray(d)) return (d as readonly ('DATE' | 'DATETIME' | 'TIMESTAMP')[]).some((t) => FIELD_TYPE[t] === type)
  return d === true
}

/** `±HH:MM` as minutes east, or null for anything else (`timezoneOffsetMinutes`). */
function offsetMinutes(zone: string): number | null {
  if (!/^[+-]\d{2}:\d{2}$/.test(zone)) return null
  return (zone[0] === '-' ? -1 : 1) * (Number.parseInt(zone.slice(1, 3), 10) * 60 + Number.parseInt(zone.slice(4), 10))
}

const text = (bytes: Uint8Array, c: ColumnDefinition): string => (isUtf8(c.characterSet) ? utf8.decode(bytes) : decodeCollation(bytes, c.characterSet))

/** Whether a collation's charset is UTF-8, which TextDecoder reads as it is. */
function isUtf8(collation: number): boolean {
  const charset = collationInfo(collation)?.charset
  return charset === undefined || charset === 'utf8mb4' || charset === 'utf8mb3'
}

/** JSON, its unsafe integers kept as their digits under `supportBigNumbers` (`parseJson`). */
function json(source: string, o: TypeOptions): unknown {
  if (o.supportBigNumbers === true && /\d{16}/.test(source)) {
    return JSON.parse(source, (_key, value: unknown, context?: { source?: string }) =>
      typeof value === 'number' && !Number.isSafeInteger(value) && context?.source !== undefined && /^-?\d+$/.test(context.source) ? context.source : value,
    )
  }
  return JSON.parse(source)
}

/** A text BIGINT (`parseLengthCodedInt`). */
function bigintText(s: string, o: TypeOptions): number | string {
  if (o.supportBigNumbers === true && o.bigNumberStrings === true) return s
  const n = Number(s)
  if (o.supportBigNumbers !== true) return n
  return Number.isSafeInteger(n) ? n : s
}

/** A text DATE (`parseDate`). */
function dateText(s: string, zone: string): Date {
  if (s.length !== 10) return new Date(Number.NaN)
  const y = Number.parseInt(s.slice(0, 4), 10)
  const m = Number.parseInt(s.slice(5, 7), 10)
  const d = Number.parseInt(s.slice(8, 10), 10)
  if (zone === 'local') return new Date(y, m - 1, d)
  if (zone === 'Z') return new Date(Date.UTC(y, m - 1, d))
  return new Date(`${pad(4, y)}-${pad(2, m)}-${pad(2, d)}T00:00:00${zone}`)
}

/** A text DATETIME or TIMESTAMP (`parseDateTime`). */
function dateTimeText(s: string, zone: string): Date {
  if (s.length >= 19 && s[4] === '-' && s[7] === '-' && s[13] === ':' && s[16] === ':') {
    const y = Number(s.slice(0, 4))
    const mo = Number(s.slice(5, 7))
    const d = Number(s.slice(8, 10))
    if (mo === 0 || d === 0 || mo > 12 || d > 31) return new Date(Number.NaN)
    if (y < 100) return zone === 'local' ? new Date(s) : new Date(`${s}${zone}`)
    const h = Number(s.slice(11, 13))
    const mi = Number(s.slice(14, 16))
    const se = Number(s.slice(17, 19))
    let ms = 0
    let scale = 100
    for (let i = 20; i < s.length && scale >= 1; i++) {
      ms += (s.charCodeAt(i) - 48) * scale
      scale /= 10
    }
    if (zone === 'local') return new Date(y, mo - 1, d, h, mi, se, ms)
    const utc = Date.UTC(y, mo - 1, d, h, mi, se, ms)
    if (zone === 'Z') return new Date(utc)
    const offset = offsetMinutes(zone)
    if (offset !== null) return new Date(utc - offset * 60000)
    return new Date(`${s}${zone}`)
  }
  return zone === 'local' ? new Date(s) : new Date(`${s}${zone}`)
}

/** One value of a text-protocol row. */
export function textValue(bytes: Uint8Array | null, c: ColumnDefinition, o: TypeOptions): unknown {
  if (bytes === null) return null
  const zone = o.timezone ?? 'local'
  switch (c.type) {
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.YEAR:
      return bytes.length === 0 ? 0 : Number(utf8.decode(bytes))
    case FIELD_TYPE.LONGLONG:
      return bytes.length === 0 ? 0 : bigintText(utf8.decode(bytes), o)
    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE:
      return bytes.length === 0 ? 0 : Number.parseFloat(utf8.decode(bytes))
    case FIELD_TYPE.NULL:
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return o.decimalNumbers === true ? (bytes.length === 0 ? 0 : Number.parseFloat(utf8.decode(bytes))) : utf8.decode(bytes)
    case FIELD_TYPE.DATE:
      return datesAsText(c.type, o) ? utf8.decode(bytes) : dateText(utf8.decode(bytes), zone)
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
      return datesAsText(c.type, o) ? utf8.decode(bytes) : dateTimeText(utf8.decode(bytes), zone)
    case FIELD_TYPE.TIME:
      return utf8.decode(bytes)
    case FIELD_TYPE.GEOMETRY:
      return geometry(bytes)
    case FIELD_TYPE.JSON:
      return o.jsonStrings === true ? utf8.decode(bytes) : json(utf8.decode(bytes), o)
    default:
      return c.characterSet === BINARY ? bytes.slice() : text(bytes, c)
  }
}

/** A text-protocol row's fields: each a length-encoded string, or 0xFB for NULL. */
export function textRow(packet: Uint8Array, columns: readonly ColumnDefinition[], o: TypeOptions): unknown[] {
  const r = new Reader(packet)
  return columns.map((c) => textValue(r.lenEncBytes(), c, o))
}

/** A binary-protocol row: a header byte, the NULL bitmap offset by 2, then each value. */
export function binaryRow(packet: Uint8Array, columns: readonly ColumnDefinition[], o: TypeOptions): unknown[] {
  const r = new Reader(packet)
  r.skip(1)
  const bitmap = r.bytes((columns.length + 7 + 2) >> 3)
  return columns.map((c, i) => {
    const bit = i + 2
    if ((((bitmap[bit >> 3] as number) >> (bit & 7)) & 1) === 1) return null
    return binaryValue(r, c, o)
  })
}

function binaryValue(r: Reader, c: ColumnDefinition, o: TypeOptions): unknown {
  const unsigned = (c.flags & COLUMN_FLAG.UNSIGNED) !== 0
  const zone = o.timezone ?? 'local'
  switch (c.type) {
    case FIELD_TYPE.TINY:
      return unsigned ? r.u8() : r.i8()
    case FIELD_TYPE.SHORT:
      return unsigned ? r.u16() : r.i16()
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.INT24:
      return unsigned ? r.u32() : r.i32()
    case FIELD_TYPE.YEAR:
      return r.u16()
    case FIELD_TYPE.FLOAT:
      return r.f32()
    case FIELD_TYPE.DOUBLE:
      return r.f64()
    case FIELD_TYPE.NULL:
      return null
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
    case FIELD_TYPE.NEWDATE:
      return datesAsText(c.type, o) ? dateTimeString(r, c.decimals, c.type) : dateTime(r, zone)
    case FIELD_TYPE.TIME:
      return timeString(r)
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL: {
      const s = utf8.decode(r.lenEncBytes() ?? new Uint8Array(0))
      return o.decimalNumbers === true ? (s === '' ? 0 : Number.parseFloat(s)) : s
    }
    case FIELD_TYPE.GEOMETRY:
      return geometry(r.lenEncBytes() ?? new Uint8Array(0))
    case FIELD_TYPE.JSON: {
      const s = utf8.decode(r.lenEncBytes() ?? new Uint8Array(0))
      return o.jsonStrings === true ? s : json(s, o)
    }
    case FIELD_TYPE.LONGLONG: {
      const v = unsigned ? r.u64() : r.i64()
      if (o.supportBigNumbers !== true) return Number(v)
      if (o.bigNumberStrings === true) return v.toString()
      return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
    }
    default: {
      const bytes = r.lenEncBytes() ?? new Uint8Array(0)
      return c.characterSet === BINARY ? bytes.slice() : text(bytes, c)
    }
  }
}

/** A binary DATE, DATETIME or TIMESTAMP as a `Date` (`readDateTime`). */
function dateTime(r: Reader, zone: string): Date {
  const length = r.u8()
  let y = 0
  let m = 0
  let d = 0
  let H = 0
  let M = 0
  let S = 0
  let ms = 0
  if (length > 3) {
    y = r.u16()
    m = r.u8()
    d = r.u8()
  }
  if (length > 6) {
    H = r.u8()
    M = r.u8()
    S = r.u8()
  }
  let micro = 0
  if (length > 10) {
    micro = r.u32()
    ms = micro / 1000
  }
  if (zone === 'local' || zone === 'Z') {
    if (y + m + d + H + M + S + ms === 0) return new Date(Number.NaN)
    return zone === 'Z' ? new Date(Date.UTC(y, m - 1, d, H, M, S, ms)) : new Date(y, m - 1, d, H, M, S, ms)
  }
  let s = ZERO_DATE
  if (length > 3) s = `${pad(4, y)}-${pad(2, m)}-${pad(2, d)}`
  if (length > 6) s += `T${pad(2, H)}:${pad(2, M)}:${pad(2, S)}`
  if (length > 10) s += `.${pad(6, micro)}`
  if (s.startsWith(ZERO_DATE)) return new Date(Number.NaN)
  if (s.length === 10) s += 'T00:00:00'
  return new Date(s + zone)
}

/** A binary DATE, DATETIME or TIMESTAMP as its text (`readDateTimeString`). */
function dateTimeString(r: Reader, decimals: number, type: number): string {
  const length = r.u8()
  let s = ZERO_DATE
  if (length > 3) s = `${pad(4, r.u16())}-${pad(2, r.u8())}-${pad(2, r.u8())}`
  if (length > 6) s += ` ${pad(2, r.u8())}:${pad(2, r.u8())}:${pad(2, r.u8())}`
  else if (type === FIELD_TYPE.DATETIME || type === FIELD_TYPE.TIMESTAMP) s += ' 00:00:00'
  if (length > 10) {
    let ms: number | string = r.u32()
    s += '.'
    if (decimals !== 0) {
      ms = pad(6, ms)
      if (ms.length > decimals) ms = ms.slice(0, decimals)
    }
    s += String(ms)
  }
  return s
}

/** A binary TIME as its text (`readTimeString`). */
function timeString(r: Reader): string {
  const length = r.u8()
  if (length === 0) return '00:00:00'
  const negative = r.u8() !== 0
  let d = 0
  let H = 0
  let M = 0
  let S = 0
  let ms = 0
  if (length > 6) {
    d = r.u32()
    H = r.u8()
    M = r.u8()
    S = r.u8()
  }
  if (length > 10) ms = r.u32()
  return `${negative ? '-' : ''}${pad(2, d * 24 + H)}:${pad(2, M)}:${pad(2, S)}${ms !== 0 ? `.${pad(6, ms)}`.replace(/0+$/, '') : ''}`
}

/** A geometry's WKB, after its four-byte SRID, as points and arrays of them (`parseGeometryValue`). */
function geometry(bytes: Uint8Array): unknown {
  if (bytes.length === 0) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 4
  const u32 = (le: boolean): number => {
    const v = view.getUint32(at, le)
    at += 4
    return v
  }
  const f64 = (le: boolean): number => {
    const v = view.getFloat64(at, le)
    at += 8
    return v
  }
  const point = (le: boolean) => ({ x: f64(le), y: f64(le) })
  const parse = (): unknown => {
    if (at + 5 > bytes.length) return null
    const le = bytes[at++] !== 0
    switch (u32(le)) {
      case 1:
        return at + 16 > bytes.length ? null : point(le)
      case 2: {
        if (at + 4 > bytes.length) return null
        const n = u32(le)
        if (n > (bytes.length - at) / 16) return null
        const out = []
        for (let i = n; i > 0 && at + 16 <= bytes.length; i--) out.push(point(le))
        return out
      }
      case 3: {
        if (at + 4 > bytes.length) return null
        const rings = u32(le)
        if (rings > (bytes.length - at) / 4) return null
        const out = []
        for (let i = rings; i > 0 && at + 4 <= bytes.length; i--) {
          const n = u32(le)
          const line = []
          for (let j = n; j > 0 && at + 16 <= bytes.length; j--) line.push(point(le))
          out.push(line)
        }
        return out
      }
      case 4:
      case 5:
      case 6:
      case 7: {
        if (at + 4 > bytes.length) return null
        const n = u32(le)
        if (n > (bytes.length - at) / 9) return null
        const out = []
        for (let i = n; i > 0; i--) out.push(parse())
        return out
      }
      default:
        return null
    }
  }
  return parse()
}

// --- parameters -------------------------------------------------------------

const isPlainJson = (v: object): boolean =>
  Array.isArray(v) || v.constructor === Object || (typeof (v as { toJSON?: unknown }).toJSON === 'function' && !(v instanceof Uint8Array))

/**
 * COM_STMT_EXECUTE for statement `id` with `values`, as `mysql2` writes it
 * (`packets/execute.js`, `encode_parameter.js`): a number is a DOUBLE, a
 * boolean a TINY, a `Date` a DATETIME in `timezone`, an array or plain object
 * its JSON, bytes a BLOB, anything else its string.
 */
export function executePacket(id: number, values: readonly unknown[], queryAttributes: boolean, timezone = 'local'): Uint8Array {
  const w = new Writer(64)
  w.u8(COM.STMT_EXECUTE)
  w.u32(id)
  // CURSOR_TYPE_NO_CURSOR, and PARAMETER_COUNT_AVAILABLE with query attributes.
  w.u8(queryAttributes ? 0x08 : 0x00)
  w.u32(1)
  if (queryAttributes) w.lenEncInt(values.length)
  if (values.length === 0) return w.toBytes()
  const encoded = values.map((v) => parameter(v, timezone))
  const bitmap = new Uint8Array((values.length + 7) >> 3)
  encoded.forEach((p, i) => {
    if (p.type === FIELD_TYPE.NULL) bitmap[i >> 3] = (bitmap[i >> 3] as number) | (1 << (i & 7))
  })
  w.bytes(bitmap)
  w.u8(1)
  for (const p of encoded) {
    w.u8(p.type)
    w.u8(0)
    if (queryAttributes) w.u8(0) // an unnamed parameter
  }
  for (const p of encoded) p.write(w)
  return w.toBytes()
}

interface Encoded {
  readonly type: number
  write(w: Writer): void
}

const encoder = new TextEncoder()

function parameter(v: unknown, timezone: string): Encoded {
  if (v === undefined) throw new TypeError('Bind parameters must not contain undefined. To pass SQL NULL specify JS null')
  if (v === null) return { type: FIELD_TYPE.NULL, write: () => {} }
  if (typeof v === 'number') return { type: FIELD_TYPE.DOUBLE, write: (w) => w.f64(v) }
  if (typeof v === 'boolean') return { type: FIELD_TYPE.TINY, write: (w) => w.u8(v ? 1 : 0) }
  if (v instanceof Date) return { type: FIELD_TYPE.DATETIME, write: (w) => writeDate(w, v, timezone) }
  if (v instanceof Uint8Array) return { type: FIELD_TYPE.BLOB, write: (w) => w.lenEncBytes(v) }
  if (typeof v === 'object' && isPlainJson(v)) {
    const s = encoder.encode(JSON.stringify(v))
    return { type: FIELD_TYPE.JSON, write: (w) => w.lenEncBytes(s) }
  }
  const s = encoder.encode(String(v))
  return { type: FIELD_TYPE.VAR_STRING, write: (w) => w.lenEncBytes(s) }
}

/** A `Date` as a binary DATETIME: its local fields, or its fields in `timezone` (`writeDate`). */
function writeDate(w: Writer, d: Date, timezone: string): void {
  w.u8(11)
  if (timezone === 'local') {
    w.u16(d.getFullYear())
    w.u8(d.getMonth() + 1)
    w.u8(d.getDate())
    w.u8(d.getHours())
    w.u8(d.getMinutes())
    w.u8(d.getSeconds())
    w.u32(d.getMilliseconds() * 1000)
    return
  }
  let t = d
  if (timezone !== 'Z') {
    const offset = (timezone[0] === '-' ? -1 : 1) * (Number.parseInt(timezone.slice(1, 3), 10) * 60 + Number.parseInt(timezone.slice(4), 10))
    if (offset !== 0) t = new Date(d.getTime() + 60000 * offset)
  }
  w.u16(t.getUTCFullYear())
  w.u8(t.getUTCMonth() + 1)
  w.u8(t.getUTCDate())
  w.u8(t.getUTCHours())
  w.u8(t.getUTCMinutes())
  w.u8(t.getUTCSeconds())
  w.u32(t.getUTCMilliseconds() * 1000)
}

// --- query values ----------------------------------------------------------

/**
 * `sql` with each `?` replaced by a value written as SQL and each `??` by a
 * quoted name, as `mysql2`'s `format` does through sql-escaper: strings
 * quoted and escaped, numbers as they print, booleans `true`/`false`, a
 * `Date` as its text in `timezone`, bytes as `X'…'`, an array as a list and
 * an array of arrays as a list of rows. A `?` in a single-quoted string, a
 * backquoted name or a comment is left alone.
 *
 * Two departures, both toward the server's own rules. Under
 * NO_BACKSLASH_ESCAPES, which the server reports in every OK, a quote is
 * doubled rather than escaped, since a backslash there escapes nothing and
 * sql-escaper's `\'` would end the string. And a plain object is refused
 * rather than expanded into `name = value` pairs by a guess at whether it
 * stands in a SET clause; `execute()` sends one as JSON.
 */
export function formatQuery(sql: string, values: readonly unknown[], noBackslashEscapes: boolean, timezone = 'local'): string {
  let out = ''
  let from = 0
  let n = 0
  let end = 0
  for (let at = nextPlaceholder(sql, 0); at !== -1 && n < values.length; at = nextPlaceholder(sql, end)) {
    end = at + 1
    while (sql[end] === '?') end++
    // Three or more are left as they are, and take no value.
    if (end - at > 2) continue
    const v = values[n++]
    out += sql.slice(from, at) + (end - at === 2 ? escapeId(v) : escapeValue(v, noBackslashEscapes, timezone))
    from = end
  }
  return from === 0 ? sql : out + sql.slice(from)
}

/** The next `?` outside a single-quoted string, a backquoted name and a comment (sql-escaper's `findNextPlaceholder`). */
function nextPlaceholder(sql: string, start: number): number {
  for (let i = start; i < sql.length; i++) {
    const c = sql[i]
    if (c === '?') return i
    // A single-quoted string, as sql-escaper skips it; a double-quoted one is not skipped there either.
    if (c === "'") {
      for (i++; i < sql.length && sql[i] !== c; i++) if (sql[i] === '\\') i++
    } else if (c === '`') {
      for (i++; i < sql.length; i++) {
        if (sql[i] === '`') {
          if (sql[i + 1] === '`') i++
          else break
        }
      }
    } else if (c === '-' && sql[i + 1] === '-' && (i + 2 >= sql.length || (sql.charCodeAt(i + 2) <= 32))) {
      const eol = sql.indexOf('\n', i)
      i = eol === -1 ? sql.length : eol
    } else if (c === '/' && sql[i + 1] === '*' && sql[i + 2] !== '!' && sql[i + 2] !== '+') {
      const close = sql.indexOf('*/', i + 2)
      i = close === -1 ? sql.length : close + 1
    }
  }
  return -1
}

function escapeId(v: unknown): string {
  if (Array.isArray(v)) return v.map(escapeId).join(', ')
  const s = String(v)
  if (s.includes('->')) return `\`${s.replace(/`/g, '``')}\``
  return `\`${s.replace(/`/g, '``').replace(/\./g, '`.`')}\``
}

const ESCAPES: Readonly<Record<string, string>> = { '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z', '"': '\\"', "'": "\\'", '\\': '\\\\' }

function escapeString(s: string, noBackslashEscapes: boolean): string {
  if (noBackslashEscapes) return `'${s.replace(/'/g, "''")}'`
  return `'${s.replace(/[\0\b\t\n\r\x1a"'\\]/g, (c) => ESCAPES[c] as string)}'`
}

function escapeValue(v: unknown, noBackslashEscapes: boolean, timezone: string): string {
  if (v === undefined || v === null) return 'NULL'
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false'
    case 'number':
    case 'bigint':
      return String(v)
    case 'string':
      return escapeString(v, noBackslashEscapes)
    case 'object': {
      if (v instanceof Date) return dateLiteral(v, timezone, noBackslashEscapes)
      if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? `(${escapeValue(x, noBackslashEscapes, timezone)})` : escapeValue(x, noBackslashEscapes, timezone))).join(', ')
      if (v instanceof Uint8Array) return `X'${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}'`
      if (typeof (v as { toSqlString?: unknown }).toSqlString === 'function') return String((v as { toSqlString: () => unknown }).toSqlString())
      throw new TypeError('an object is not a query value: pass it to execute(), which sends it as JSON, or JSON.stringify it')
    }
    default:
      return escapeString(String(v), noBackslashEscapes)
  }
}

/** A `Date` as sql-escaper writes it: 'YYYY-MM-DD HH:MM:SS.mmm', in `timezone`, or NULL if invalid. */
function dateLiteral(d: Date, timezone: string, noBackslashEscapes: boolean): string {
  if (Number.isNaN(d.getTime())) return 'NULL'
  let f: number[]
  if (timezone === 'local') f = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]
  else {
    // sql-escaper's `convertTimezone`: 'Z', or ±HH[:MM]; anything else is no shift.
    const m = /([+\-\s])(\d\d):?(\d\d)?/.exec(timezone)
    const minutes = timezone === 'Z' || m === null ? 0 : (m[1] === '-' ? -1 : 1) * (Number.parseInt(m[2] as string, 10) * 60 + (m[3] === undefined ? 0 : Number.parseInt(m[3], 10)))
    const t = new Date(d.getTime() + minutes * 60000)
    f = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds(), t.getUTCMilliseconds()]
  }
  const [y, mo, da, h, mi, s, ms] = f as [number, number, number, number, number, number, number]
  return escapeString(`${pad(4, y)}-${pad(2, mo)}-${pad(2, da)} ${pad(2, h)}:${pad(2, mi)}:${pad(2, s)}.${pad(3, ms)}`, noBackslashEscapes)
}
