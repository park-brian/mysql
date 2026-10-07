// M3.16 — replay the query-grouping corpus captured from a real MySQL.
//
// The sibling of `precedence-vectors.test.ts`, one level up. The evaluator
// below contains **no grouping knowledge at all**: it walks the tree the parser
// built — a join node joins its two children, a set operation combines its two
// sides, a query's `LIMIT` applies to its own body — and checks each `ON`'s
// columns against the tables its operands supply. Everything about *which*
// operands those are was decided by the parser. So a parser that let a comma
// bind as tightly as `JOIN` produces a tree whose `ON` sees a table it should
// not, and comes out with rows where MySQL said ER_BAD_FIELD_ERROR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NODE,
  ParseError,
  STATEMENT,
  parseStatement,
  type Expression,
  type QueryBody,
  type QueryExpression,
  type TableReference,
} from '@myjs/parser'

const FIXTURE = new URL('./fixtures/queries.json', import.meta.url).pathname

interface Vector {
  readonly sql: string
  readonly rows?: readonly (readonly (number | null)[])[]
  readonly errno?: number
}

interface Fixture {
  readonly capturedAgainst: string
  readonly tables: Readonly<Record<string, readonly (readonly (number | null)[])[]>>
  readonly vectors: readonly Vector[]
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture

type Value = number | null
type Row = ReadonlyMap<string, Value>
interface Relation {
  /** Qualified column names, `t1.a`, in order. */
  readonly columns: readonly string[]
  readonly rows: readonly Row[]
}

/** MySQL's error, carried out of the evaluator. */
class SqlFailure extends Error {
  readonly errno: number
  constructor(errno: number) {
    super(`errno ${errno}`)
    this.errno = errno
  }
}

/** The qualified name of a column reference; the corpus only writes `t.c`. */
const nameOf = (e: Expression): string => {
  assert.ok(e.kind === NODE.COLUMN && e.parts.length === 2, 'the corpus writes only qualified columns')
  return e.parts.join('.')
}

/** Every column an expression names. */
function columnsIn(e: Expression, out: string[] = []): string[] {
  if (e.kind === NODE.COLUMN) out.push(nameOf(e))
  else if (e.kind === NODE.BINARY) {
    columnsIn(e.left, out)
    columnsIn(e.right, out)
  } else if (e.kind === NODE.UNARY) columnsIn(e.operand, out)
  return out
}

/**
 * An expression may name only columns in scope. MySQL checks this while
 * resolving names, before reading a row — so it holds over empty tables too,
 * and this checks it the same way rather than discovering it per row.
 */
function inScope(e: Expression, columns: readonly string[]): void {
  for (const c of columnsIn(e)) if (!columns.includes(c)) throw new SqlFailure(1054)
}

/** Three-valued: 1, 0 or NULL. */
function evaluate(e: Expression, row: Row): Value {
  switch (e.kind) {
    case NODE.LITERAL:
      return Number(e.value)
    case NODE.COLUMN:
      return row.get(nameOf(e)) ?? null
    case NODE.UNARY: {
      assert.equal(e.op, 'IS NULL')
      return evaluate(e.operand, row) === null ? 1 : 0
    }
    case NODE.BINARY: {
      const l = evaluate(e.left, row)
      const r = evaluate(e.right, row)
      switch (e.op) {
        case 'OR':
          return l === 1 || r === 1 ? 1 : l === null || r === null ? null : 0
        case 'AND':
          return l === 0 || r === 0 ? 0 : l === null || r === null ? null : 1
      }
      if (l === null || r === null) return null
      switch (e.op) {
        case '=':
          return l === r ? 1 : 0
        case '<':
          return l < r ? 1 : 0
        case '>':
          return l > r ? 1 : 0
      }
    }
  }
  throw new Error(`the corpus does not use ${e.kind}`)
}

const nulls = (columns: readonly string[]): Row => new Map(columns.map((c) => [c, null]))
const merge = (a: Row, b: Row): Row => new Map([...a, ...b])

function cross(a: Relation, b: Relation): Relation {
  return { columns: [...a.columns, ...b.columns], rows: a.rows.flatMap((l) => b.rows.map((r) => merge(l, r))) }
}

function reference(ref: TableReference): Relation {
  switch (ref.kind) {
    case 'table': {
      const name = ref.alias ?? ref.table.name
      const data = fixture.tables[ref.table.name]
      assert.ok(data !== undefined, ref.table.name)
      const columns = [`${name}.a`, `${name}.b`]
      return { columns, rows: data.map((r) => new Map(columns.map((c, i) => [c, r[i] ?? null]))) }
    }
    case 'list':
      return ref.items.map(reference).reduce(cross)
    case 'derived':
      throw new Error('the corpus has no derived tables')
    case 'join': {
      const left = reference(ref.left)
      const right = reference(ref.right)
      const columns = [...left.columns, ...right.columns]
      // The `ON` sees its two operands and nothing else — the rule that makes
      // grouping observable at all.
      if (ref.on !== undefined) inScope(ref.on, columns)
      const matches = (l: Row, r: Row) => ref.on === undefined || evaluate(ref.on, merge(l, r)) === 1
      if (ref.type === 'LEFT') {
        return {
          columns,
          rows: left.rows.flatMap((l) => {
            const hit = right.rows.filter((r) => matches(l, r)).map((r) => merge(l, r))
            return hit.length > 0 ? hit : [merge(l, nulls(right.columns))]
          }),
        }
      }
      if (ref.type === 'RIGHT') {
        return {
          columns,
          rows: right.rows.flatMap((r) => {
            const hit = left.rows.filter((l) => matches(l, r)).map((l) => merge(l, r))
            return hit.length > 0 ? hit : [merge(nulls(left.columns), r)]
          }),
        }
      }
      return { columns, rows: left.rows.flatMap((l) => right.rows.filter((r) => matches(l, r)).map((r) => merge(l, r))) }
    }
  }
}

type Tuple = readonly Value[]
const key = (t: Tuple): string => JSON.stringify(t)

function distinct(rows: readonly Tuple[]): Tuple[] {
  const seen = new Set<string>()
  return rows.filter((r) => !seen.has(key(r)) && seen.add(key(r)) !== undefined)
}

function counts(rows: readonly Tuple[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + 1)
  return out
}

function body(b: QueryBody): Tuple[] {
  switch (b.kind) {
    case 'query':
      return query(b)
    case 'select': {
      const from = (b.from ?? []).map(reference).reduce(cross)
      if (b.where !== undefined) inScope(b.where, from.columns)
      const items = b.items.map((i) => i.expr)
      for (const e of items) inScope(e, from.columns)
      const kept = b.where === undefined ? from.rows : from.rows.filter((r) => evaluate(b.where as Expression, r) === 1)
      return kept.map((r) => items.map((e) => evaluate(e, r)))
    }
    case 'setOperation': {
      const left = body(b.left)
      const right = body(b.right)
      if (b.op === 'UNION') return b.all === true ? [...left, ...right] : distinct([...left, ...right])
      const have = counts(right)
      if (b.op === 'INTERSECT') {
        if (b.all !== true) return distinct(left.filter((r) => have.has(key(r))))
        return left.filter((r) => {
          const n = have.get(key(r)) ?? 0
          if (n === 0) return false
          have.set(key(r), n - 1)
          return true
        })
      }
      if (b.all !== true) return distinct(left.filter((r) => !have.has(key(r))))
      return left.filter((r) => {
        const n = have.get(key(r)) ?? 0
        if (n === 0) return true
        have.set(key(r), n - 1)
        return false
      })
    }
    default:
      throw new Error(`the corpus has no ${b.kind}`)
  }
}

/** NULL sorts first ascending and last descending, as in MySQL. */
const compare = (a: Value, b: Value): number => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b)

function query(q: QueryExpression): Tuple[] {
  let rows = body(q.body)
  if (q.orderBy !== undefined) {
    // The corpus orders only by `1`, the first column.
    const desc = q.orderBy[0]?.desc === true
    rows = [...rows].sort((a, b) => (desc ? -1 : 1) * compare(a[0] ?? null, b[0] ?? null))
  }
  if (q.limit !== undefined) {
    const offset = q.limit.offset === undefined ? 0 : Number((q.limit.offset as { value: bigint }).value)
    rows = rows.slice(offset, offset + Number((q.limit.count as { value: bigint }).value))
  }
  return rows
}

/** What our parser and evaluator say: rows, or an errno. */
function ours(sql: string): { rows: Tuple[] } | { errno: number } {
  let node
  try {
    node = parseStatement(sql)
  } catch (e) {
    if (e instanceof ParseError) return { errno: e.errno ?? -1 }
    throw e
  }
  assert.equal(node.kind, STATEMENT.QUERY)
  try {
    return { rows: query(node as QueryExpression) }
  } catch (e) {
    if (e instanceof SqlFailure) return { errno: e.errno }
    throw e
  }
}

/** Rows compare in order when the query fixed one, and as a multiset when not. */
const normal = (rows: readonly Tuple[], ordered: boolean): string[] => {
  const keys = rows.map(key)
  return ordered ? keys : keys.sort()
}

test(`M3.16: queries group the way MySQL groups them (${fixture.vectors.length} vectors, ${fixture.capturedAgainst})`, () => {
  assert.ok(fixture.vectors.length >= 1000, 'the corpus is the size it claims')
  const disagreements: string[] = []
  for (const v of fixture.vectors) {
    const got = ours(v.sql)
    if (v.errno !== undefined) {
      if (!('errno' in got) || got.errno !== v.errno) {
        disagreements.push(`${v.sql}\n    MySQL: errno ${v.errno}; us: ${'errno' in got ? `errno ${got.errno}` : `${got.rows.length} rows`}`)
      }
      continue
    }
    if ('errno' in got) {
      disagreements.push(`${v.sql}\n    MySQL: ${v.rows?.length} rows; us: errno ${got.errno}`)
      continue
    }
    const ordered = /ORDER BY 1( DESC)?( LIMIT \d+)?$/.test(v.sql)
    if (JSON.stringify(normal(got.rows, ordered)) !== JSON.stringify(normal(v.rows ?? [], ordered))) {
      disagreements.push(`${v.sql}\n    MySQL: ${JSON.stringify(v.rows)}\n    us:    ${JSON.stringify(got.rows)}`)
    }
  }
  assert.equal(disagreements.length, 0, `${disagreements.length} disagreement(s):\n  ${disagreements.slice(0, 8).join('\n  ')}`)
})

test('M3.16: the corpus exercises what it is for', () => {
  // A corpus with no refusals cannot see a misplaced `ON`, and one with no
  // set operations cannot see `INTERSECT`'s precedence. Asserted, so a
  // regenerated corpus that lost either fails here rather than passing on less.
  const has = (re: RegExp) => fixture.vectors.filter((v) => re.test(v.sql)).length
  assert.ok(fixture.vectors.filter((v) => v.errno === 1054).length >= 50, 'ON-scope refusals')
  assert.ok(has(/FROM [^W]*(,.*JOIN|JOIN.*,)/) >= 80, 'commas beside joins')
  assert.ok(has(/JOIN t\d (INNER |CROSS |LEFT |RIGHT |LEFT OUTER |STRAIGHT_)?JOIN/) >= 40, 'a condition-less join beside another')
  assert.ok(has(/ON [^O]* ON /) >= 40, 'two conditions in a row, which only an absorbed join can take')
  assert.ok(has(/(UNION|EXCEPT).*INTERSECT/) >= 30, 'INTERSECT to the right of UNION or EXCEPT')
  assert.ok(has(/\) (UNION|INTERSECT|EXCEPT)|(UNION|INTERSECT|EXCEPT)( ALL| DISTINCT)? \(/) >= 50, 'parenthesised branches')
})
