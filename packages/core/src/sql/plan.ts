// M5.7, its first step — which rows to read: a key range when the WHERE clause
// pins an index's leading column, a full scan otherwise.
//
// The rule that keeps this safe (D-65): **the whole WHERE clause is applied
// to every row the range returns.** A range can therefore only ever lose rows
// by being too narrow, never add wrong ones, and the planner's one job is to
// never be too narrow. It narrows only when a constant converts to the
// column's type *exactly*, so the bound it encodes is the value the
// comparison would have used:
//
//   - an integer column against an integer constant in its range;
//   - a DECIMAL column against an exact constant with no more scale than it;
//   - a DOUBLE against any number (FLOAT is excluded: `f = 1.1` must not
//     find a row the float32 conversion would make equal);
//   - a text column against a string constant, compared under the column's
//     collation — a literal's coercibility always loses to a column's — and
//     no longer than the column;
//   - a binary column against a string or bytes;
//   - a temporal against a constant that parses to that temporal exactly.
//
// Anything else — `varchar_col = 1`, which compares as doubles — is a full
// scan, and correct.
//
// Row order matters as much as the rows: a query without ORDER BY returns
// rows in the order of its access path, and MySQL's choice of path decides
// that. So a secondary index is used only for equality (and IN lists), where
// its order within one key is the primary key's — the same as a full scan
// filtered. A *range* on a secondary is left to a full scan until the cost
// model of M5.7 can say what MySQL would pick.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import type { ColumnDef, IndexDef, KeyBound, KeyRange, TableDef } from '@myjs/engine'
import { NODE, type Expression } from '@myjs/parser'
import {
  compareValues,
  encodeField,
  orderValues,
  parseDateTime,
  type StoreContext,
  type Value,
} from '@myjs/types'
import type { Env } from './compile.ts'

/** How to read a table: an index and the ranges of it, in index order, or a full scan. */
export interface Access {
  readonly index?: string
  /** Disjoint, ascending. Absent for a full scan. */
  readonly ranges?: readonly KeyRange[]
}

export const FULL_SCAN: Access = {}

type Op = '=' | '<' | '<=' | '>' | '>=' | 'IN' | 'IS NULL'

interface Condition {
  readonly column: string
  readonly op: Op
  readonly constants: readonly Expression[]
}

const FLIP: Readonly<Record<string, Op>> = { '=': '=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' }

/** A constant the planner may evaluate before the scan: a literal, or a `?`. */
const isConstant = (e: Expression): boolean =>
  e.kind === NODE.LITERAL || e.kind === NODE.PLACEHOLDER || (e.kind === NODE.UNARY && e.op === '-' && isConstant(e.operand))

/** The WHERE clause's top-level `AND`ed conjuncts. */
function conjuncts(e: Expression | undefined, out: Expression[] = []): Expression[] {
  if (e === undefined) return out
  if (e.kind === NODE.BINARY && (e.op === 'AND' || e.op === '&&')) {
    conjuncts(e.left, out)
    conjuncts(e.right, out)
  } else out.push(e)
  return out
}

/** A column reference that names a column of this table, by its own name. */
function columnOf(e: Expression, def: TableDef, alias: string): string | undefined {
  if (e.kind !== NODE.COLUMN) return undefined
  const parts = e.parts
  if (parts.length === 3 && (parts[0] !== def.schema || parts[1] !== alias)) return undefined
  if (parts.length === 2 && parts[0] !== alias) return undefined
  const name = (parts[parts.length - 1] as string).toLowerCase()
  return def.columns.find((c) => c.name.toLowerCase() === name)?.name
}

function conditionOf(e: Expression, def: TableDef, alias: string): Condition | undefined {
  if (e.kind === NODE.UNARY && e.op === 'IS NULL') {
    const column = columnOf(e.operand, def, alias)
    return column === undefined ? undefined : { column, op: 'IS NULL', constants: [] }
  }
  if (e.kind !== NODE.BINARY) return undefined
  if (e.op === 'IN' && e.right.kind === NODE.ROW && e.right.items.every(isConstant)) {
    const column = columnOf(e.left, def, alias)
    return column === undefined ? undefined : { column, op: 'IN', constants: e.right.items }
  }
  const op = FLIP[e.op === '<>' || e.op === '!=' ? '' : e.op]
  if (op === undefined) return undefined
  const left = columnOf(e.left, def, alias)
  if (left !== undefined && isConstant(e.right)) return { column: left, op: e.op as Op, constants: [e.right] }
  const right = columnOf(e.right, def, alias)
  if (right !== undefined && isConstant(e.left)) return { column: right, op, constants: [e.left] }
  return undefined
}

/**
 * Whether `v` compared with column `c` compares as `c`'s own type and converts
 * to it without loss — the condition for using its bytes as a key bound.
 */
function exact(v: Value, c: ColumnDef): boolean {
  if (v === null) return false
  const t = c.type
  switch (t.type) {
    case FIELD_TYPE.TINY:
    case FIELD_TYPE.SHORT:
    case FIELD_TYPE.INT24:
    case FIELD_TYPE.LONG:
    case FIELD_TYPE.LONGLONG:
    case FIELD_TYPE.YEAR:
      return v.kind === 'int' && t.type !== FIELD_TYPE.YEAR
    case FIELD_TYPE.DECIMAL:
    case FIELD_TYPE.NEWDECIMAL:
      return v.kind === 'int' || (v.kind === 'decimal' && v.scale <= (t.scale ?? 0) && v.display === undefined)
    case FIELD_TYPE.DOUBLE:
      return v.kind === 'int' || v.kind === 'decimal' || v.kind === 'double'
    case FIELD_TYPE.DATE:
    case FIELD_TYPE.DATETIME:
    case FIELD_TYPE.TIMESTAMP: {
      if (v.kind === 'datetime') return t.type !== FIELD_TYPE.DATE || v.type === 'DATE'
      if (v.kind !== 'string') return false
      const p = parseDateTime(v.v)
      if (p === undefined) return false
      if (t.type === FIELD_TYPE.DATE) return !p.hasTime
      return p.fsp <= (t.decimals ?? 0)
    }
    case FIELD_TYPE.STRING:
    case FIELD_TYPE.VAR_STRING:
    case FIELD_TYPE.VARCHAR: {
      if (t.collationId === undefined || t.collationId === CHARSET_BINARY) return v.kind === 'bytes' || v.kind === 'string'
      // The column's collation decides the comparison only against a string
      // whose own coercibility is weaker (a literal's or a parameter's).
      if (v.kind !== 'string' || v.coercibility <= 2) return false
      return [...v.v].length <= (t.length ?? 1)
    }
    default:
      return false
  }
}

/**
 * The access path for a single-table WHERE clause. `alias` is the name the
 * statement gives the table. Constants are evaluated now, with `env`, which
 * is why the plan is made per execution (a `?` is a constant by then).
 */
export function chooseAccess(def: TableDef, alias: string, where: Expression | undefined, env: Env): Access {
  const conditions = conjuncts(where)
    .map((e) => conditionOf(e, def, alias))
    .filter((c): c is Condition => c !== undefined)
  if (conditions.length === 0) return FULL_SCAN

  const candidates = [...def.indexes].sort((a, b) => (a.kind === 'primary' ? -1 : 0) - (b.kind === 'primary' ? -1 : 0))
  let best: { access: Access; score: number } | undefined
  for (const index of candidates) {
    const part = index.parts[0]
    if (part === undefined || part.prefix !== undefined || part.descending === true) continue
    const column = def.columns.find((c) => c.name === part.column) as ColumnDef
    const mine = conditions.filter((c) => c.column === column.name)
    const access = accessFor(index, column, mine, env)
    if (access === undefined) continue
    const score = access.score + (index.kind === 'primary' || def.clustered === index.name ? 0.5 : 0)
    if (best === undefined || score > best.score) best = { access: access.access, score }
  }
  return best?.access ?? FULL_SCAN
}

const ctx = (): StoreContext => ({ strict: true, row: 1, warnings: 0 })

function bound(v: Value, column: ColumnDef, inclusive: boolean): KeyBound | undefined {
  try {
    return { values: [encodeField(v, { ...column, nullable: true }, ctx())], inclusive }
  } catch {
    return undefined
  }
}

function accessFor(index: IndexDef, column: ColumnDef, conditions: readonly Condition[], env: Env): { access: Access; score: number } | undefined {
  const clustered = index.kind === 'primary'
  const evaluate = (e: Expression): Value | undefined => {
    try {
      return constantValue(e, env)
    } catch {
      return undefined
    }
  }
  for (const c of conditions) {
    if (c.op === 'IS NULL') {
      if (!column.nullable) continue
      return { access: { index: index.name, ranges: [{ from: { values: [null], inclusive: true }, to: { values: [null], inclusive: true } }] }, score: 3 }
    }
    if (c.op === '=' || c.op === 'IN') {
      const values = c.constants.map(evaluate)
      if (values.some((v) => v === undefined || !exact(v ?? null, column))) continue
      const points = dedupe((values as Value[]).sort(orderValues))
      const ranges: KeyRange[] = []
      for (const v of points) {
        const b = bound(v, column, true)
        if (b === undefined) return undefined
        ranges.push({ from: b, to: b })
      }
      return { access: { index: index.name, ranges }, score: 3 }
    }
  }
  // A range, on the clustered index only (see the header).
  if (!clustered) return undefined
  let from: KeyBound | undefined
  let to: KeyBound | undefined
  for (const c of conditions) {
    if (c.op === 'IN' || c.op === '=' || c.op === 'IS NULL') continue
    const v = evaluate(c.constants[0] as Expression)
    if (v === undefined || !exact(v, column)) continue
    const b = bound(v, column, c.op === '<=' || c.op === '>=')
    if (b === undefined) continue
    if ((c.op === '>' || c.op === '>=') && from === undefined) from = b
    if ((c.op === '<' || c.op === '<=') && to === undefined) to = b
  }
  if (from === undefined && to === undefined) return undefined
  // A lower bound alone still skips the NULLs a clustered key cannot hold anyway.
  return { access: { index: index.name, ranges: [{ ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) }] }, score: from !== undefined && to !== undefined ? 2 : 1 }
}

function dedupe(sorted: readonly Value[]): Value[] {
  const out: Value[] = []
  for (const v of sorted) if (out.length === 0 || compareValues(out[out.length - 1] ?? null, v) !== 0) out.push(v)
  return out
}

/** A literal, `-literal` or `?`, evaluated. */
function constantValue(e: Expression, env: Env): Value {
  switch (e.kind) {
    case NODE.PLACEHOLDER:
      return env.params[e.index] ?? null
    case NODE.UNARY: {
      const v = constantValue(e.operand, env)
      if (v === null) return null
      if (v.kind === 'int') return v.unsigned && v.v > (1n << 63n) - 1n ? null : { kind: 'int', v: -v.v, unsigned: false }
      if (v.kind === 'decimal') return { ...v, v: -v.v }
      if (v.kind === 'double') return { kind: 'double', v: -v.v }
      return null
    }
    case NODE.LITERAL:
      return literalValue(e, env)
    default:
      return null
  }
}

/** A literal's value, without compiling it: the planner's own small evaluator, kept to the kinds `exact` accepts. */
function literalValue(e: Expression & { kind: typeof NODE.LITERAL }, env: Env): Value {
  switch (e.type) {
    case 'int': {
      const n = e.value as bigint
      return { kind: 'int', v: n, unsigned: n > (1n << 63n) - 1n }
    }
    case 'decimal': {
      const text = e.value as string
      const [i = '0', f = ''] = text.replace(/^[+]/, '').split('.')
      return { kind: 'decimal', v: BigInt(`${i}${f}` || '0'), scale: f.length }
    }
    case 'double':
      return { kind: 'double', v: e.value as number }
    case 'string':
      // An introducer or COLLATE changes what the literal compares as; leave those to the scan.
      if (e.charset !== undefined || e.collation !== undefined) return null
      return { kind: 'string', v: e.value as string, collationId: env.session.characterSet, coercibility: 4 }
    case 'hex':
      return { kind: 'bytes', v: e.value as Uint8Array }
    default:
      return null
  }
}

