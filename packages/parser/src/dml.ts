// M3.4 — `INSERT`, `REPLACE`, `UPDATE`, `DELETE`.
//
// Nearly all of this is M3.3 reused: a multi-table `UPDATE` is table
// references, `INSERT … SELECT` is a query expression, a `VALUES` row is the
// row a `VALUES` statement has, and `WITH` may open an `UPDATE` or a `DELETE`
// as it opens a query. What is left is the clause order each statement fixes,
// and a handful of facts a real 8.4 settled rather than the manual:
//
//   - `UPDATE` and `DELETE` take `LIMIT n`, never `LIMIT m, n` or `OFFSET`.
//   - An `INSERT` column list may be qualified — `INSERT INTO t (t.a)`.
//   - `DELETE t.* FROM t` is `DELETE t FROM t`, and `DELETE FROM t USING …`
//     is the same statement as `DELETE t FROM …`.
import { NODE, type ColumnNode, type Expression } from './ast.ts'
import type { Cursor } from './cursor.ts'
import { parseExpressionFrom } from './expression.ts'
import {
  atParenthesisedQuery,
  atQueryStart,
  parseLimitValue,
  parseOrderBy,
  parseQueryFrom,
  parseTableReference,
  parseValueOrDefault,
} from './query.ts'
import { REF, type OrderItem, type QueryExpression, type TableReference, type With } from './query-ast.ts'
import type { SqlMode } from './sql-mode.ts'
import {
  STATEMENT,
  type Assignment,
  type DeleteNode,
  type InsertNode,
  type TableName,
  type UpdateNode,
} from './statement-ast.ts'

/** `INSERT` or `REPLACE`, with the cursor on the keyword. */
export function parseInsert(c: Cursor, mode: SqlMode): InsertNode {
  const at = c.peek().start
  const replace = c.takeWord('REPLACE')
  if (!replace) c.expectWord('INSERT')
  let priority: InsertNode['priority']
  if (c.takeWord('LOW_PRIORITY')) priority = 'LOW_PRIORITY'
  else if (c.takeWord('DELAYED')) priority = 'DELAYED'
  else if (!replace && c.takeWord('HIGH_PRIORITY')) priority = 'HIGH_PRIORITY'
  const ignore = !replace && c.takeWord('IGNORE')
  c.takeWord('INTO')
  const table = c.expectTableName()
  const partitions = c.takeWord('PARTITION') ? c.expectNameList() : undefined

  // `(a, b)` is a column list unless a query starts inside it:
  // `INSERT INTO t (SELECT …)`.
  let columns: ColumnNode[] | undefined
  if (c.atOp('(') && !atQueryStart(c, 1) && !atParenthesisedQuery(c)) {
    c.skip()
    columns = []
    if (!c.atOp(')')) {
      do columns.push(column(c))
      while (c.takeOp(','))
    }
    c.expectOp(')')
  }

  let values: Expression[][] | undefined
  let set: Assignment[] | undefined
  let query: QueryExpression | undefined
  if (c.takeWord('VALUES') || c.takeWord('VALUE')) {
    values = []
    do {
      c.takeWord('ROW')
      values.push(row(c, mode))
    } while (c.takeOp(','))
  } else if (columns === undefined && c.takeWord('SET')) {
    set = assignments(c, mode)
  } else if (atQueryStart(c) || atParenthesisedQuery(c)) {
    query = parseQueryFrom(c, mode)
  } else {
    c.fail()
  }

  // `AS new [(a, b)]` names the row being inserted, for the update clause to
  // refer to. Not after a query, whose own aliases do that job.
  let rowAlias: InsertNode['rowAlias']
  if (query === undefined && c.takeWord('AS')) {
    const name = c.expectIdentifier()
    rowAlias = c.atOp('(') ? { name, columns: c.expectNameList() } : { name }
  }
  let onDuplicate: Assignment[] | undefined
  if (!replace && c.takeWords('ON', 'DUPLICATE', 'KEY', 'UPDATE')) onDuplicate = assignments(c, mode)

  return {
    kind: STATEMENT.INSERT,
    ...(replace ? { replace } : {}),
    ...(priority === undefined ? {} : { priority }),
    ...(ignore ? { ignore } : {}),
    table,
    ...(partitions === undefined ? {} : { partitions }),
    ...(columns === undefined ? {} : { columns }),
    ...(values === undefined ? {} : { values }),
    ...(set === undefined ? {} : { set }),
    ...(query === undefined ? {} : { query }),
    ...(rowAlias === undefined ? {} : { rowAlias }),
    ...(onDuplicate === undefined ? {} : { onDuplicate }),
    at,
  }
}

/** `UPDATE`, with the cursor on the keyword (or on `WITH`'s, already read). */
export function parseUpdate(c: Cursor, mode: SqlMode, withClause?: With, at = c.peek().start): UpdateNode {
  c.expectWord('UPDATE')
  const priority = c.takeWord('LOW_PRIORITY') ? 'LOW_PRIORITY' : undefined
  const ignore = c.takeWord('IGNORE')
  const tables: TableReference[] = []
  do tables.push(parseTableReference(c, mode))
  while (c.takeOp(','))
  c.expectWord('SET')
  const set = assignments(c, mode)
  const { where, orderBy, limit } = tail(c, mode)
  return {
    kind: STATEMENT.UPDATE,
    ...(withClause === undefined ? {} : { with: withClause }),
    ...(priority === undefined ? {} : { priority }),
    ...(ignore ? { ignore } : {}),
    tables,
    set,
    ...(where === undefined ? {} : { where }),
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(limit === undefined ? {} : { limit }),
    at,
  }
}

/** `DELETE`, with the cursor on the keyword (or on `WITH`'s, already read). */
export function parseDelete(c: Cursor, mode: SqlMode, withClause?: With, at = c.peek().start): DeleteNode {
  c.expectWord('DELETE')
  let priority: 'LOW_PRIORITY' | undefined
  let quick = false
  let ignore = false
  for (;;) {
    if (c.takeWord('LOW_PRIORITY')) priority = 'LOW_PRIORITY'
    else if (c.takeWord('QUICK')) quick = true
    else if (c.takeWord('IGNORE')) ignore = true
    else break
  }

  let targets: TableName[] | undefined
  let tables: TableReference[]
  if (c.takeWord('FROM')) {
    const first = targetName(c)
    if (c.atOp(',') || c.atWord('USING')) {
      // `DELETE FROM t1, t2 USING <references>`.
      targets = [first]
      while (c.takeOp(',')) targets.push(targetName(c))
      c.expectWord('USING')
      tables = references(c, mode)
    } else {
      // The single-table form: one table, an alias, partitions.
      const ref = singleTable(c, first, at)
      tables = [ref]
    }
  } else {
    // `DELETE t1, t2 FROM <references>`.
    targets = []
    do targets.push(targetName(c))
    while (c.takeOp(','))
    c.expectWord('FROM')
    tables = references(c, mode)
  }

  const { where, orderBy, limit } = tail(c, mode)
  return {
    kind: STATEMENT.DELETE,
    ...(withClause === undefined ? {} : { with: withClause }),
    ...(priority === undefined ? {} : { priority }),
    ...(quick ? { quick } : {}),
    ...(ignore ? { ignore } : {}),
    ...(targets === undefined ? {} : { targets }),
    tables,
    ...(where === undefined ? {} : { where }),
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(limit === undefined ? {} : { limit }),
    at,
  }
}

// --- shared pieces ----------------------------------------------------------

function tail(c: Cursor, mode: SqlMode): { where?: Expression; orderBy?: OrderItem[]; limit?: Expression } {
  const where = c.takeWord('WHERE') ? parseExpressionFrom(c, mode) : undefined
  const orderBy = c.atWords('ORDER', 'BY') ? parseOrderBy(c, mode) : undefined
  const limit = c.takeWord('LIMIT') ? parseLimitValue(c) : undefined
  return {
    ...(where === undefined ? {} : { where }),
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(limit === undefined ? {} : { limit }),
  }
}

/** `a = 1, t.b = DEFAULT`. */
export function assignments(c: Cursor, mode: SqlMode): Assignment[] {
  const out: Assignment[] = []
  do {
    const col = column(c)
    // `:=` is accepted here as well as `=`; they mean the same thing.
    if (!c.takeOp('=')) c.expectOp(':=')
    out.push({ column: col, value: parseValueOrDefault(c, mode) })
  } while (c.takeOp(','))
  return out
}

/** `(1, DEFAULT, a + 1)`. */
function row(c: Cursor, mode: SqlMode): Expression[] {
  c.expectOp('(')
  const out: Expression[] = []
  if (!c.atOp(')')) {
    do out.push(parseValueOrDefault(c, mode))
    while (c.takeOp(','))
  }
  c.expectOp(')')
  return out
}

/** `a`, `t.a` or `db.t.a`, as a column node. */
export function column(c: Cursor): ColumnNode {
  const at = c.peek().start
  const parts = [c.expectIdentifier()]
  while (c.takeOp('.')) parts.push(c.expectNamePart())
  if (parts.length > 3) c.fail()
  return { kind: NODE.COLUMN, parts, at }
}

/** A delete target: `t`, `db.t`, and `t.*`, which is the same target. */
function targetName(c: Cursor): TableName {
  const first = c.expectIdentifier()
  let name: TableName = { name: first }
  if (c.atOp('.') && !c.atOp('*', 1)) {
    c.skip()
    name = { schema: first, name: c.expectNamePart() }
  }
  if (c.atOp('.') && c.atOp('*', 1)) {
    c.skip()
    c.skip()
  }
  return name
}

/** The single-table delete's table: `t [AS x] [PARTITION (p)]`. */
function singleTable(c: Cursor, table: TableName, at: number): TableReference {
  let alias: string | undefined
  if (c.takeWord('AS')) alias = c.expectIdentifier()
  else if (c.atIdentifier()) alias = c.take().text
  const partitions = c.takeWord('PARTITION') ? c.expectNameList() : undefined
  return {
    kind: REF.TABLE,
    table,
    ...(partitions === undefined ? {} : { partitions }),
    ...(alias === undefined ? {} : { alias }),
    at,
  }
}

function references(c: Cursor, mode: SqlMode): TableReference[] {
  const out: TableReference[] = []
  do out.push(parseTableReference(c, mode))
  while (c.takeOp(','))
  return out
}
