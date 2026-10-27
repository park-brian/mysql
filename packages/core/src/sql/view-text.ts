// M5.12 — a view's query as INFORMATION_SCHEMA.VIEWS prints it.
//
// MySQL stores a view's query as its own reprint of the resolved statement
// (`Item::print`), and VIEW_DEFINITION is that text: every column qualified
// with its schema and table (or the table's alias), each select item
// `expr AS \`name\``, items and arguments joined by a bare comma, every
// operator parenthesized, functions in lower case, and `COUNT(*)` as
// `count(0)` (8.4.11):
//
//   select `vp`.`t`.`id` AS `id`,count(0) AS `n` from `vp`.`t`
//     where ((`vp`.`t`.`c` = 1) and (`vp`.`t`.`name` <> 'it\'s'))
//
// The subset printed here is what views are made of in practice: columns,
// literals, operators, functions, CASE, one table or a join of tables,
// WHERE, GROUP BY, HAVING, ORDER BY and LIMIT. Anything else — a subquery, a
// derived table, a set operation — is `undefined`, and the caller reports the
// view's own text instead, a named divergence rather than a guess.
import type { TableDef } from '@myjs/engine'
import { NODE, QUERY, REF, type Expression, type QueryExpression, type TableReference, quoteName } from '@myjs/parser'
import { Unprintable, printString, printExpression } from './print.ts'
import { someNode } from './ast.ts'
import { AGGREGATE_NAMES } from './compile.ts'


interface Source {
  readonly qualifier: string
  readonly columns: ReadonlySet<string>
  readonly names: readonly string[]
}

/** Resolved view text; omitted `current` means INFORMATION_SCHEMA, explicit string/NULL means SHOW CREATE VIEW. */
export function viewDefinition(query: QueryExpression, names: readonly string[], schema: string, tables: (schema: string, name: string) => TableDef | undefined, source?: string, current?: string | null): string | undefined {
  try {
    if (query.with !== undefined || query.locking !== undefined) return undefined
    const body = query.body
    if (body.kind !== QUERY.SELECT) return undefined
    const sources: Source[] = []
    const fromText = (body.from ?? []).map((r) => from(r)).join(',')
    function from(r: TableReference): string {
      if (r.kind === REF.TABLE) {
        const db = r.table.schema ?? schema
        const def = tables(db, r.table.name)
        if (def === undefined) throw new Unprintable()
        // SHOW CREATE VIEW names a table in the current database without it (8.4.11).
        const named = db === current ? quoteName(r.table.name) : `${quoteName(db)}.${quoteName(r.table.name)}`
        const qualifier = r.alias === undefined ? named : quoteName(r.alias)
        sources.push({ qualifier, columns: new Set(def.columns.map((c) => c.name.toLowerCase())), names: def.columns.map((c) => c.name) })
        return r.alias === undefined ? named : `${named} ${quoteName(r.alias)}`
      }
      if (r.kind === REF.JOIN) {
        if (r.using !== undefined || r.natural === true) throw new Unprintable()
        const kind = r.type === 'LEFT' ? 'left join' : r.type === 'RIGHT' ? 'right join' : 'join'
        const left = from(r.left)
        const right = from(r.right)
        return `(${left} ${kind} ${right}${r.on === undefined ? '' : ` on(${expr(r.on)})`})`
      }
      throw new Unprintable()
    }
    function column(parts: readonly string[]): string {
      const name = parts[parts.length - 1] as string
      const table = parts.length === 1 ? undefined : quoteName(parts[parts.length - 2] as string)
      const owner = sources.find((s) => table === undefined ? s.columns.has(name.toLowerCase()) : s.qualifier === table || s.qualifier.endsWith(`.${table}`))
      if (owner === undefined) throw new Unprintable()
      return `${owner.qualifier}.${quoteName(name)}`
    }
    function expr(e: Expression): string {
      return printExpression(e, { column, string: current === undefined ? (v) => printString(v) : printString, source })
    }
    // `*` expands to the tables' columns, in order.
    const items: string[] = []
    for (const item of body.items) {
      if (item.expr.kind === NODE.COLUMN && item.expr.parts.at(-1) === '*') {
        const table = item.expr.parts.length > 1 ? (item.expr.parts.at(-2) as string) : undefined
        for (const s of sources) if (table === undefined || s.qualifier === quoteName(table) || s.qualifier.endsWith(`.${quoteName(table)}`)) for (const c of s.names) items.push(`${s.qualifier}.${quoteName(c)}`)
      } else items.push(expr(item.expr))
    }
    if (items.length !== names.length) return undefined
    let out = `select ${body.distinct === true ? 'distinct ' : ''}${items.map((x, i) => `${x} AS ${quoteName(names[i] as string)}`).join(',')}`
    if (fromText !== '') out += ` from ${fromText}`
    if (body.where !== undefined) out += ` where ${expr(body.where)}`
    if (body.groupBy !== undefined) {
      if (body.groupBy.rollup === true) return undefined
      out += ` group by ${body.groupBy.items.map((g) => expr(g)).join(',')}`
    }
    if (body.having !== undefined) out += ` having ${expr(body.having)}`
    if (query.orderBy !== undefined) out += ` order by ${query.orderBy.map((o) => `${expr(o.expr)}${o.desc === true ? ' desc' : ''}`).join(',')}`
    if (query.limit !== undefined) {
      const count = query.limit.count
      if (count.kind !== NODE.LITERAL) return undefined
      out += ` limit ${query.limit.offset !== undefined && query.limit.offset.kind === NODE.LITERAL ? `${String(query.limit.offset.value)},` : ''}${String(count.value)}`
    }
    return out
  } catch (e) {
    if (e instanceof Unprintable) return undefined
    throw e
  }
}

/** IS_UPDATABLE: one table, no grouping, aggregate, window, DISTINCT or LIMIT, and a plain column among its items (8.4.11). */
export function viewUpdatable(query: QueryExpression): boolean {
  const body = query.body
  if (body.kind !== QUERY.SELECT || query.limit !== undefined || query.with !== undefined) return false
  if (body.groupBy !== undefined || body.having !== undefined || body.distinct === true) return false
  const from = body.from ?? []
  if (from.length !== 1 || from[0]?.kind !== REF.TABLE) return false
  if (someNode(body.items, (value) => {
    const e = value as Expression
    return e.kind === NODE.CALL && (e.over !== undefined || AGGREGATE_NAMES.has(e.name.toUpperCase())) || undefined
  })) return false
  return body.items.some((i) => i.expr.kind === NODE.COLUMN)
}
