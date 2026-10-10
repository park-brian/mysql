// What a client receives: an evaluated value as the `SqlValue` the protocol
// layer writes, for the text protocol or the binary one.
//
// The text protocol is rendered here rather than left to the protocol layer,
// because the rendering is MySQL's and depends on what the value *is*: a
// DECIMAL keeps its scale, a DOUBLE prints its shortest round-trip digits, a
// FLOAT only six significant ones, and a string is converted into the
// session's result charset. The binary protocol wants typed values and writes
// them by the column's field type, so a value is first brought to that type.
import { FIELD_TYPE } from '@myjs/bytes'
import type { RowValue, Session } from '@myjs/protocol'
import { renderDateTime, renderDecimal, renderDouble, renderFloat, renderTime, toDecimal, toDouble, toInteger, toText, type Value } from '@myjs/types'
import type { ResultType } from './meta.ts'

/** latin1_swedish_ci, `my_charset_numeric`'s collation: the charset a number's text is in. */
const LATIN1_SWEDISH_CI = 8

export type WireProtocol = 'text' | 'binary'


function textOf(v: Exclude<Value, null>, t: ResultType): string {
  // A FLOAT(M,D), and arithmetic over one, prints exactly D decimals, as
  // `my_fcvt` does (8.4.11: a FLOAT(3,1) holding 1.25 is `1.2`).
  if (t.kind === 'double' && t.scale < 31 && (v.kind === 'double' || v.kind === 'int' || v.kind === 'decimal')) {
    const n = toDouble(v)
    // Negative zero keeps its sign, as `my_fcvt` writes it (8.4.11: `-TIME'00:00:00'` is `-0`).
    if (Number.isFinite(n) && Math.abs(n) < 1e21) return `${Object.is(n, -0) ? '-' : ''}${n.toFixed(t.scale)}`
  }
  // A YEAR column is four digits, zero too; YEAR()'s result is a number (8.4.11: `0000`, and `YEAR('0000-00-00')` is 0).
  if (t.field === FIELD_TYPE.YEAR && t.column !== undefined && v.kind === 'int') return v.v.toString().padStart(4, '0')
  switch (v.kind) {
    case 'double':
      return t.field === FIELD_TYPE.FLOAT ? renderFloat(v.v) : renderDouble(v.v)
    case 'decimal':
      return renderDecimal(v)
    case 'datetime':
      return renderDateTime(v.v, v.type, t.kind === 'datetime' ? t.scale : v.fsp)
    case 'time':
      return renderTime(v.v, t.kind === 'time' ? t.scale : v.fsp)
    default:
      return toText(v)
  }
}

/** One value for one column, ready for `textRowPacket` or `binaryRowPacket`. */
export function toWire(v: Value, t: ResultType, protocol: WireProtocol, session: Session): RowValue {
  if (v === null) return null
  if (v.kind === 'bytes') return v.v
  // A BIT's bytes go as bytes where the result holds bytes; under an integer result, as its number (8.4.11: `COALESCE(bt, u)` is 49).
  if (v.kind === 'int' && v.str !== undefined && (t.kind !== 'int' || t.field === FIELD_TYPE.BIT)) {
    // A BIT's bytes under a DECIMAL holder are text in the numbers' charset,
    // latin1, converted for the client as any text is (8.4.11: 0xFF comes as C3 BF).
    return t.kind === 'decimal' ? session.transcoder.encode(session.transcoder.decode(v.str, LATIN1_SWEDISH_CI), session.characterSet) : v.str
  }
  // A BIT is sent as its bytes, big-endian, in either protocol (8.4.11).
  if (t.field === FIELD_TYPE.BIT && v.kind === 'int') return bitBytes(v.v, t.length)
  if (v.kind === 'string') return session.transcoder.encode(v.v, session.characterSet)
  if (protocol === 'text') return session.transcoder.encode(textOf(v, t), session.characterSet)

  // Binary: a value of the column's own type, whatever kind evaluation gave.
  switch (t.field) {
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.LONGLONG:
    case FIELD_TYPE.YEAR:
      return toInteger(v)
    case FIELD_TYPE.FLOAT:
    case FIELD_TYPE.DOUBLE:
      return toDouble(v)
    case FIELD_TYPE.NEWDECIMAL:
    case FIELD_TYPE.DECIMAL:
      return renderDecimal(toDecimal(v))
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP:
      return v.kind === 'datetime' ? v.v : textOf(v, t)
    case FIELD_TYPE.TIME:
      return v.kind === 'time' ? v.v : textOf(v, t)
    default:
      return session.transcoder.encode(textOf(v, t), session.characterSet)
  }
}

/** A BIT(n) value's bytes: big-endian, as many as n bits take. */
export function bitBytes(n: bigint, bits: number): Uint8Array {
  const out = new Uint8Array(Math.max(1, Math.ceil(bits / 8)))
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return out
}
