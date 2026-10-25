// M5.19 — UNION, INTERSECT and EXCEPT.
//
// A set operation's columns are named by its first branch and typed by all of
// them (`Item_type_holder::join_types`), and every row is converted to that
// type before the rows meet — so `SELECT 1 UNION SELECT 'a'` is two strings,
// and a DISTINCT compares them as strings. The rules, read off 8.4.11:
//
//   - Integers keep the widest width. Mixed signedness widens the field
//     to hold both ranges: TINYINT with TINYINT UNSIGNED is SMALLINT,
//     BIGINT with BIGINT UNSIGNED is DECIMAL.
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
// twice is kept, or removed, twice; and their temporary table holds each row
// once with its count, so a row's copies come out together, in the order
// rows first came (8.4.11: `2,1,NULL,2,3,1,2 EXCEPT ALL 2,5,1` is
// 2, 2, 1, NULL, 3).
import { CHARSET_BINARY, COLUMN_FLAG, FIELD_TYPE } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import type { SetOperationNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { COERCIBILITY, bytesValue, intValue, plainValue, stringValue, toDateTime, toText, valueBytes, withoutHex, type Value } from '@myjs/types'
import { aggregate, aggregateCollations, aggregateTypes, convertTo } from './compile.ts'
import { rowKey } from './keys.ts'
import { charWidth, jsonAsText, jsonType, isNumber, promotesToBlob, stringType, type ResultType } from './meta.ts'
import { bitBytes } from './wire.ts'

type Columns = readonly { readonly name: string; readonly type: ResultType }[]

/** A set operation, typed: its columns, and how it makes its rows from its branches'. */
export interface SetOperationPlan {
  readonly columns: Columns
  rows(left: () => Iterable<readonly Value[]>, right: () => Iterable<readonly Value[]>, types: readonly ResultType[]): Iterable<Value[]>
}

/** The type a column of a set operation has, given each branch's. */
export function setOperationType(types: readonly ResultType[], connectionCollation: number): ResultType {
  const nullable = types.some((t) => t.nullable)
  let live = types.filter((t) => t.kind !== 'null')
  const fromField = types.some((t) => t.column !== undefined || t.fromField === true)
  const done = (t: ResultType): ResultType => {
    const { column: _c, temporary: _t, asText: _a, fromField: _f, names: _n, ...rest } = t
    // A column of the operation's temporary table: its collation is a
    // column's (IMPLICIT), so a nested `_bin` union keeps it against a latin1 side.
    return { ...rest, nullable, temporary: 'stream', keepField: true, ...(t.kind === 'string' ? { coercibility: COERCIBILITY.IMPLICIT } : {}), ...(fromField ? { fromField } : {}) }
  }
  if (live.length === 0) return done(stringType(0, CHARSET_BINARY, true))
  // JSON with JSON is JSON; with anything else, its text: a LONGTEXT in utf8mb4_bin (8.4.11, M5.21).
  if (live.every((t) => t.kind === 'json')) return done(jsonType(nullable))
  if (live.some((t) => t.kind === 'json')) return setOperationType(types.map((t) => (t.kind === 'json' ? { ...jsonAsText(t.nullable), ...(t.column === undefined ? {} : { column: t.column }) } : t)), connectionCollation)
  if (live.every((t) => t.kind === 'int' && t.field !== FIELD_TYPE.BIT)) {
    // UNION's YEAR holder takes no part in integer field selection or signedness.
    const integers = live.filter((t) => t.field !== FIELD_TYPE.YEAR)
    const type = aggregate(integers.length === 0 ? live : integers, nullable, connectionCollation)
    return done({ ...type, length: Math.max(...live.map((t) => t.length)), ...(type.field === FIELD_TYPE.YEAR ? { fieldFlags: COLUMN_FLAG.ZEROFILL } : {}) })
  }
  if (live.every(isNumber)) return done(aggregate(live, nullable, connectionCollation))
  if (live.every((t) => t.kind === 'datetime' || t.kind === 'time')) {
    const same = live.every((t) => t.field === live[0]!.field)
    if (same || live.every((t) => t.field === FIELD_TYPE.DATE || t.field === FIELD_TYPE.DATETIME || t.field === FIELD_TYPE.TIMESTAMP)) {
      const source = same ? live[0] : live.find((t) => t.field !== FIELD_TYPE.DATE)
      return done({ ...source, ...aggregate(live, nullable, connectionCollation) })
    }
  }
  // Raw BIT fields join collation resolution as binary columns; an explicit
  // text collation can still win. Computed BIT expressions stay numeric.
  live = live.map((t) => t.field === FIELD_TYPE.BIT && t.column !== undefined ? { ...t, kind: 'bytes', coercibility: COERCIBILITY.IMPLICIT } : t)
  const binary = aggregateCollations(live, 'UNION', false)?.collationId === CHARSET_BINARY
  const collationId = binary ? CHARSET_BINARY : aggregateTypes(live, connectionCollation)
  if (live.some((t) => t.blobBytes !== undefined || t.field === FIELD_TYPE.BLOB)) {
    // Computed BLOB widths already count bytes. Other branches are sized
    // in their own charset for binary output, or in the text holder's charset.
    const bytes = Math.min(4294967295, Math.max(...live.map((t) => {
      const width = t.blobBytes ?? charWidth(t)
      if (t.blobBytes !== undefined && t.column === undefined) return width
      return width * requireCollationInfo(binary && t.kind === 'string' ? t.collationId : collationId).mbmaxlen
    })))
    return done({ ...stringType(bytes, collationId, nullable), field: FIELD_TYPE.BLOB, blobBytes: bytes })
  }
  const sameField = live.every((t) => t.field === FIELD_TYPE.STRING)
  // Binary: as wide as the widest branch in its own bytes — a string's
  // characters at its charset's widest, bytes as they are (8.4.11:
  // VARBINARY(10) UNION 'k' is 10, UNION a 13-character literal 52).
  const width = Math.max(...live.map((t) => charWidth(t) * (binary && t.kind === 'string' ? requireCollationInfo(t.collationId).mbmaxlen : 1)))
  const text = stringType(width, collationId, nullable)
  return done(sameField ? { ...text, field: FIELD_TYPE.STRING } : text)
}

/**
 * A set operation that is a branch of a UNION is materialized as a table of
 * its own, and its columns are as nullable as its rows can be: INTERSECT only
 * where every side is, EXCEPT as its left side. The outermost operation, a
 * branch of the same operator (which 8.4.11 flattens into it), and a branch
 * of an INTERSECT or an EXCEPT are nullable where any side is. So `(b
 * INTERSECT a) UNION a` is NOT NULL over a nullable `b`, and `a EXCEPT (b
 * INTERSECT a)` and `(a INTERSECT b) INTERSECT a` are not (8.4.11, M5.48).
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
  // YEAR may meet a TINYINT without widening it. Its temporary field quietly
  // saturates at the TINYINT maximum, before DISTINCT compares the rows.
  if (t.field === FIELD_TYPE.TINY && v.kind === 'int') {
    const max = t.unsigned ? 255n : 127n
    if (v.v > max) return intValue(max, t.unsigned)
  }
  if (t.kind === 'string') return stringValue(toText(v), t.collationId, COERCIBILITY.IMPLICIT)
  if (t.kind === 'datetime' && v.kind === 'datetime' && t.field === FIELD_TYPE.DATETIME && v.type === 'DATE') return toDateTime(v, 'DATETIME') ?? v
  if (t.kind === 'bytes' && v.kind !== 'bytes') return bytesValue(valueBytes(v))
  const converted = convertTo(v, t)
  // Comparisons use the stored FLOAT, not the double read from a branch.
  return converted?.kind === 'double' && converted.float === true ? { ...converted, v: Math.fround(converted.v) } : converted
}

/**
 * A set operation over two branches' columns. Its types are folded, pairwise
 * and in order, over every SELECT beneath it, `leaves` — not over a nested
 * operation's result: `grp UNION (amt INTERSECT s)` is INT with DECIMAL(6,2),
 * 14 wide as text, then a VARCHAR(10), so 56 bytes, where `grp UNION (s
 * INTERSECT amt)` is 44 (8.4.11).
 */
export function setOperation(node: SetOperationNode, left: Columns, right: Columns, connectionCollation: number, leaves: readonly (readonly ResultType[])[]): SetOperationPlan {
  if (left.length !== right.length) throw sqlError('ER_WRONG_NUMBER_OF_COLUMNS_IN_SELECT', 'The used SELECT statements have a different number of columns')
  // Nullable if either side is; `nestedNullability` narrows it for an
  // operation that is itself a branch.
  const columns = left.map((c, i) => {
    // A NULL-only prefix has no holder yet; only an all-NULL final result does.
    const folded = leaves.map((l) => l[i] as ResultType).reduce((acc, t, at) => acc.kind === 'null' && t.kind === 'null' && at < leaves.length - 1 ? acc : setOperationType([acc, t], connectionCollation))
    return { name: c.name, type: { ...folded, nullable: c.type.nullable || right[i]!.type.nullable } }
  })
  return {
    columns,
    *rows(leftRows, rightRows, types) {
      // Copy numeric sources into the final binary BLOB before comparison.
      // Only a raw BIT field uses packed bytes; computed numbers use digits.
      const prepare = (r: readonly Value[], source: Columns): Value[] => r.map((v, i) => {
        const from = source[i]!.type
        const to = types[i]!
        if (v?.kind !== 'int' || !isNumber(from) || to.kind !== 'bytes' || (to.field !== FIELD_TYPE.BLOB && !promotesToBlob(to))) return v
        if (from.field === FIELD_TYPE.BIT && from.column !== undefined) return bytesValue(bitBytes(v.v, from.length))
        // A materialized numeric field reads its declared scale.
        const value = from.temporary ? convertTo(v, from) : v
        return bytesValue(valueBytes(plainValue(value)!))
      })
      const keyOf = (r: readonly Value[]): string => rowKey(r.map((v, i) => convert(v, types[i] as ResultType)))
      if (node.op === 'UNION') {
        const seen = new Set<string>()
        for (const [side, source] of [[leftRows, left], [rightRows, right]] as const) {
          for (const raw of side()) {
            const r = prepare(raw, source)
            if (!node.all) {
              const k = keyOf(r)
              if (seen.has(k)) continue
              seen.add(k)
            }
            yield r.map(withoutHex)
          }
        }
        return
      }
      // INTERSECT and EXCEPT: the right side counted, the left side filtered.
      const counts = new Map<string, number>()
      for (const raw of rightRows()) {
        const k = keyOf(prepare(raw, right))
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      if (node.all) {
        const held = new Map<string, { row: Value[]; n: number }>()
        for (const raw of leftRows()) {
          const row = prepare(raw, left)
          const k = keyOf(row)
          const entry = held.get(k)
          if (entry === undefined) held.set(k, { row, n: 1 })
          else entry.n++
        }
        for (const [k, { row, n }] of held) {
          const right = counts.get(k) ?? 0
          const times = node.op === 'INTERSECT' ? Math.min(n, right) : n - right
          for (let i = 0; i < times; i++) yield row
        }
        return
      }
      const seen = new Set<string>()
      for (const raw of leftRows()) {
        const row = prepare(raw, left)
        const k = keyOf(row)
        if ((node.op === 'INTERSECT') !== counts.has(k) || seen.has(k)) continue
        seen.add(k)
        yield row
      }
    },
  }
}

