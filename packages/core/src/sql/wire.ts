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
import { renderDateTime, renderDecimal, renderDouble, renderTime, toDecimal, toDouble, toInteger, toText, type Value } from '@myjs/types'
import type { ResultType } from './meta.ts'

export type WireProtocol = 'text' | 'binary'

/** A FLOAT column prints six significant digits, as `my_gcvt` does for `FLT_DIG`. */
export function renderFloat(n: number): string {
  if (!Number.isFinite(n) || n === 0) return renderDouble(n)
  return renderDouble(Number(n.toPrecision(6)))
}

function textOf(v: Exclude<Value, null>, t: ResultType): string {
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
