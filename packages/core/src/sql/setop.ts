// M5.19 — UNION, INTERSECT and EXCEPT.
//
// A set operation's columns are named by its first branch and typed by all of
// them (`Item_type_holder::join_types`), and every row is converted to that
// type before the rows meet — so `SELECT 1 UNION SELECT 'a'` is two strings,
// and a DISTINCT compares them as strings. The rules, read off 8.4.11:
//
//   - Integers keep the widest field among them, and the widest width: INT
//     with TINYINT is an INT, INT with BIGINT a BIGINT, 20 wide.
//   - A DECIMAL among integers and DECIMALs holds the most integer digits and
//     the most scale; a DOUBLE anywhere is a DOUBLE, 23 wide.
//   - Two temporals of one kind keep it; DATE with DATETIME is a DATETIME.
//   - Anything else that meets a string, or numbers and temporals together,
//     is a VARCHAR as wide as the widest as text (an INT is 11), binary if a
//     byte string is among them, in the aggregated collation.
//   - A NULL branch takes no part, except that it makes the column nullable;
//     all-NULL is a zero-width binary string.
//   - The column has no table behind it, so a number carries no BINARY flag,
//     and a string's decimals are 0.
//
// Rows are compared in the column's type but passed on as their branch gave
// them, and only the outermost operation converts: a nested one's leaves
// meet the final type directly, so `(amt UNION ALL id) UNION s` shows the
// INT 1 as '1', not as the inner DECIMAL's '1.00' (8.4.11).
//
// Rows: UNION ALL is the left branch's rows, then the right's. A DISTINCT
// operation keeps each row's first occurrence, in that order, as its
// temporary table does; INTERSECT and EXCEPT keep the left branch's order.
// The ALL forms of INTERSECT and EXCEPT count: a row the right branch holds
// twice is kept, or removed, twice.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { encodeCollation, requireCollationInfo } from '@myjs/charsets'
import type { SetOperationNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { COERCIBILITY, bytesValue, stringValue, toDateTime, toText, type Value } from '@myjs/types'
import { aggregateTypes, convertTo } from './compile.ts'
import { rowKey } from './keys.ts'
import { charWidth, decimalType, doubleType, jsonAsText, jsonType, stringType, type ResultType } from './meta.ts'

type Columns = readonly { readonly name: string; readonly type: ResultType }[]

/** A set operation, typed: its columns, and how it makes its rows from its branches'. */
export interface SetOperationPlan {
  readonly columns: Columns
  rows(left: () => Iterable<readonly Value[]>, right: () => Iterable<readonly Value[]>): Iterable<Value[]>
}

const INT_RANK: Readonly<Record<number, number>> = {
  [FIELD_TYPE.TINY]: 1,
  [FIELD_TYPE.SHORT]: 2,
  [FIELD_TYPE.INT24]: 3,
  [FIELD_TYPE.LONG]: 4,
  [FIELD_TYPE.LONGLONG]: 5,
}

const intDigits = (t: ResultType): number => (t.kind === 'decimal' ? t.length - t.scale : t.kind === 'int' ? (t.unsigned ? t.length : t.length - 1) : 0)

/** The type a column of a set operation has, given each branch's. */
export function setOperationType(types: readonly ResultType[], connectionCollation: number): ResultType {
  const nullable = types.some((t) => t.nullable)
  const live = types.filter((t) => t.kind !== 'null')
  const fromField = types.some((t) => t.column !== undefined || t.fromField === true)
  const done = (t: ResultType): ResultType => {
    const { column: _c, temporary: _t, asText: _a, fromField: _f, ...rest } = t
    // A column of the operation's temporary table: its collation is a
    // column's (IMPLICIT), so a nested `_bin` union keeps it against a latin1 side.
    return { ...rest, nullable, temporary: 'stream', keepField: true, ...(t.kind === 'string' ? { coercibility: COERCIBILITY.IMPLICIT } : {}), ...(fromField ? { fromField } : {}) }
  }
  if (live.length === 0) return done({ ...stringType(0, CHARSET_BINARY, true) })
  // JSON with JSON is JSON; with anything else, its text: a LONGTEXT in utf8mb4_bin (8.4.11, M5.21).
  if (live.every((t) => t.kind === 'json')) return done(jsonType(nullable))
  if (live.some((t) => t.kind === 'json')) return setOperationType(types.map((t) => (t.kind === 'json' ? { ...jsonAsText(t.nullable), ...(t.column === undefined ? {} : { column: t.column }) } : t)), connectionCollation)
  const kinds = new Set(live.map((t) => t.kind))
  if (kinds.size === 1 && kinds.has('int') && live.every((t) => INT_RANK[t.field] !== undefined)) {
    const widest = live.reduce((a, b) => ((INT_RANK[b.field] ?? 0) > (INT_RANK[a.field] ?? 0) ? b : a))
    return done({ ...widest, length: Math.max(...live.map((t) => t.length)), unsigned: live.every((t) => t.unsigned) })
  }
  const numeric = [...kinds].every((k) => k === 'int' || k === 'decimal' || k === 'double')
  if (numeric) {
    if (kinds.has('double')) return done(doubleType(nullable, 23))
    const scale = Math.max(...live.map((t) => (t.kind === 'decimal' ? t.scale : 0)))
    return done(decimalType(Math.max(...live.map(intDigits)) + scale, scale, nullable, live.every((t) => t.unsigned)))
  }
  const temporal = [...kinds].every((k) => k === 'datetime' || k === 'time')
  if (temporal) {
    const fields = new Set(live.map((t) => t.field))
    const scale = Math.max(...live.map((t) => t.scale))
    if (fields.size === 1) return done({ ...(live[0] as ResultType), scale })
    if ([...fields].every((f) => f === FIELD_TYPE.DATE || f === FIELD_TYPE.DATETIME || f === FIELD_TYPE.TIMESTAMP)) {
      return done({ ...(live.find((t) => t.field !== FIELD_TYPE.DATE) as ResultType), field: FIELD_TYPE.DATETIME, scale })
    }
  }
  // Text: as wide as the widest as text, in the aggregated collation, binary if bytes are among them.
  const binary = kinds.has('bytes')
  const collationId = binary ? CHARSET_BINARY : aggregateTypes(live, connectionCollation)
  const blob = live.find((t) => t.blobBytes !== undefined || t.field === FIELD_TYPE.BLOB)
  if (blob !== undefined) {
    const bytes = Math.max(...live.map((t) => t.blobBytes ?? 0))
    const mb = blob.kind === 'string' ? requireCollationInfo(blob.collationId).mbmaxlen : 1
    return done({ ...stringType(bytes * mb, collationId, nullable), field: FIELD_TYPE.BLOB, blobBytes: bytes * mb })
  }
  const width = Math.max(...live.map((t) => (t.kind === 'string' || t.kind === 'bytes' ? t.length : charWidth(t))))
  const sameField = live.every((t) => t.field === (live[0] as ResultType).field) && (live[0] as ResultType).field === FIELD_TYPE.STRING
  const text = stringType(binary ? width * Math.max(...live.map((t) => (t.kind === 'string' ? requireCollationInfo(t.collationId).mbmaxlen : 1))) : width, collationId, nullable)
  return done(sameField ? { ...text, field: FIELD_TYPE.STRING } : text)
}

/**
 * A set operation that is a branch of a different one is materialized as a
 * table of its own, and its columns are as nullable as its rows can be:
 * INTERSECT only where every side is, EXCEPT as its left side, UNION where any
 * side is. The outermost operation — and a branch of the same operator, which
 * 8.4.11 flattens into it — is nullable where any side is. So `(b INTERSECT
 * a) UNION a` is NOT NULL over a nullable `b`, and `(a INTERSECT b) INTERSECT
 * a` is not.
 */
export function nestedNullability(op: SetOperationNode['op'], left: boolean, right: boolean): boolean {
  return op === 'UNION' ? left || right : op === 'INTERSECT' ? left && right : left
}

/**
 * A branch's value as the set operation's column type holds it — a string in
 * the column's collation, so the rows dedupe and sort as one column does
 * (`utf8mb4_bin` against the default puts `'Blue'` before `'ann'`).
 */
export function convert(v: Value, t: ResultType): Value {
  if (v === null) return null
  if (t.kind === 'string') return stringValue(v.kind === 'string' ? v.v : toText(v), t.collationId, COERCIBILITY.IMPLICIT)
  if (t.kind === 'datetime' && v.kind === 'datetime' && t.field === FIELD_TYPE.DATETIME && v.type === 'DATE') return toDateTime(v, 'DATETIME') ?? v
  if (t.kind === 'bytes' && v.kind !== 'bytes') return bytesValue(v.kind === 'string' ? encodeCollation(v.v, v.collationId) : new TextEncoder().encode(toText(v)))
  return convertTo(v, t)
}

/**
 * A set operation over two branches' columns. Its types are folded, pairwise
 * and in order, over every SELECT beneath it, `leaves` — not over a nested
 * operation's result: `grp UNION (amt INTERSECT s)` is INT with DECIMAL(6,2),
 * 14 wide as text, then a VARCHAR(10), so 56 bytes, where `grp UNION (s
 * INTERSECT amt)` is 44 (8.4.11).
 */
export function setOperation(node: SetOperationNode, left: Columns, right: Columns, connectionCollation: number, leaves: readonly (readonly ResultType[])[] = [left.map((c) => c.type), right.map((c) => c.type)]): SetOperationPlan {
  if (left.length !== right.length) throw sqlError('ER_WRONG_NUMBER_OF_COLUMNS_IN_SELECT', 'The used SELECT statements have a different number of columns')
  // Nullable if either side is; `nestedNullability` narrows it for an
  // operation that is itself a branch.
  const columns = left.map((c, i) => {
    const r = (right[i] as { type: ResultType }).type
    const folded = leaves.map((l) => l[i] as ResultType).reduce((acc, t) => setOperationType([acc, t], connectionCollation))
    return { name: c.name, type: { ...folded, nullable: c.type.nullable || r.nullable } }
  })
  const types = columns.map((c) => c.type)
  const all = node.all === true
  return {
    columns,
    *rows(leftRows, rightRows) {
      const conv = (r: readonly Value[]): Value[] => r.map((v, i) => convert(v, types[i] as ResultType))
      if (node.op === 'UNION') {
        const seen = new Set<string>()
        for (const side of [leftRows, rightRows]) {
          for (const r of side()) {
            if (!all) {
              const k = rowKey(conv(r))
              if (seen.has(k)) continue
              seen.add(k)
            }
            yield [...r]
          }
        }
        return
      }
      // INTERSECT and EXCEPT: the right side counted, the left side filtered.
      const counts = new Map<string, number>()
      for (const r of rightRows()) {
        const k = rowKey(conv(r))
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const seen = new Set<string>()
      for (const r of leftRows()) {
        const row = [...r]
        const k = rowKey(conv(r))
        const n = counts.get(k) ?? 0
        if (node.op === 'INTERSECT') {
          if (n === 0) continue
          if (all) counts.set(k, n - 1)
          else {
            if (seen.has(k)) continue
            seen.add(k)
          }
          yield row
        } else {
          if (all) {
            if (n > 0) {
              counts.set(k, n - 1)
              continue
            }
          } else {
            if (n > 0 || seen.has(k)) continue
            seen.add(k)
          }
          yield row
        }
      }
    },
  }
}

