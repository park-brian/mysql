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
import { NODE, QUERY, REF, type Expression, type QueryExpression, type TableReference } from '@myjs/parser'

const q = (name: string): string => `\`${name.replace(/`/g, '``')}\``

const OPERATORS: Readonly<Record<string, string>> = { AND: 'and', '&&': 'and', OR: 'or', '||': 'or', XOR: 'xor', LIKE: 'like', 'NOT LIKE': 'not like', REGEXP: 'regexp', DIV: 'DIV', MOD: '%', IS: 'is', 'IS NOT': 'is not' }

class Unprintable extends Error {}

interface Source {
  readonly qualifier: string
  readonly columns: ReadonlySet<string>
  readonly names: readonly string[]
}

/** VIEW_DEFINITION for `query`, resolved in `schema` against `tables`; `undefined` past the subset. */
export function viewDefinition(query: QueryExpression, names: readonly string[], schema: string, tables: (schema: string, name: string) => TableDef | undefined): string | undefined {
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
        const qualifier = r.alias === undefined ? `${q(db)}.${q(r.table.name)}` : q(r.alias)
        sources.push({ qualifier, columns: new Set(def.columns.map((c) => c.name.toLowerCase())), names: def.columns.map((c) => c.name) })
        return r.alias === undefined ? `${q(db)}.${q(r.table.name)}` : `${q(db)}.${q(r.table.name)} ${q(r.alias)}`
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
      if (parts.length === 1) {
        const owner = sources.find((s) => s.columns.has(name.toLowerCase()))
        if (owner === undefined) throw new Unprintable()
        return `${owner.qualifier}.${q(name)}`
      }
      const table = parts[parts.length - 2] as string
      const owner = sources.find((s) => s.qualifier === q(table) || s.qualifier.endsWith(`.${q(table)}`))
      if (owner === undefined) throw new Unprintable()
      return `${owner.qualifier}.${q(name)}`
    }
    function expr(e: Expression): string {
      switch (e.kind) {
        case NODE.COLUMN:
          return column(e.parts)
        case NODE.LITERAL:
          if (e.type === 'null') return 'NULL'
          if (e.type === 'bool') return e.value === true ? 'true' : 'false'
          if (e.type === 'string') return `'${String(e.value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
          if (e.type === 'int' || e.type === 'decimal') return String(e.value)
          throw new Unprintable()
        case NODE.UNARY:
          if (e.op === '-') return `-(${expr(e.operand)})`
          // The optimizer's rewrite is what is stored: NOT c is (0 = c).
          if (e.op === 'NOT' || e.op === '!') return e.operand.kind === NODE.COLUMN ? `(0 = ${expr(e.operand)})` : `(not(${expr(e.operand)}))`
          if (e.op === 'IS NULL' || e.op === 'IS NOT NULL') return `(${expr(e.operand)} ${e.op.toLowerCase()})`
          throw new Unprintable()
        case NODE.BINARY: {
          if (e.op === 'IN' || e.op === 'NOT IN') {
            if (e.right.kind !== NODE.ROW) throw new Unprintable()
            return `(${expr(e.left)} ${e.op.toLowerCase()} (${e.right.items.map(expr).join(',')}))`
          }
          if (e.op === 'BETWEEN' || e.op === 'NOT BETWEEN') return `(${expr(e.left)} ${e.op.toLowerCase()} ${expr(e.right)} and ${expr(e.extra as Expression)})`
          return `(${expr(e.left)} ${OPERATORS[e.op] ?? e.op} ${expr(e.right)})`
        }
        case NODE.CALL: {
          if (e.over !== undefined || e.distinct === true || e.orderBy !== undefined) throw new Unprintable()
          const star = e.args.length === 1 && e.args[0]?.kind === NODE.COLUMN && e.args[0].parts.at(-1) === '*'
          return `${e.name.toLowerCase()}(${star ? '0' : e.args.map(expr).join(',')})`
        }
        case NODE.CASE:
          return `(case ${e.operand === undefined ? '' : `${expr(e.operand)} `}${e.whens.map((w) => `when ${expr(w.when)} then ${expr(w.then)}`).join(' ')}${e.else === undefined ? '' : ` else ${expr(e.else)}`} end)`
        default:
          throw new Unprintable()
      }
    }
    // `*` expands to the tables' columns, in order.
    const items: string[] = []
    for (const item of body.items) {
      if (item.expr.kind === NODE.COLUMN && item.expr.parts.at(-1) === '*') {
        const table = item.expr.parts.length > 1 ? (item.expr.parts.at(-2) as string) : undefined
        for (const s of sources) if (table === undefined || s.qualifier === q(table) || s.qualifier.endsWith(`.${q(table)}`)) for (const c of s.names) items.push(`${s.qualifier}.${q(c)}`)
      } else items.push(expr(item.expr))
    }
    if (items.length !== names.length) return undefined
    let out = `select ${body.distinct === true ? 'distinct ' : ''}${items.map((x, i) => `${x} AS ${q(names[i] as string)}`).join(',')}`
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
  const aggregates = /"kind":"call","name":"(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|JSON_ARRAYAGG|JSON_OBJECTAGG|BIT_AND|BIT_OR|BIT_XOR|STD|STDDEV|VARIANCE)"|"over":/i
  if (body.items.some((i) => aggregates.test(JSON.stringify(i.expr, (_k, v) => (typeof v === 'bigint' ? String(v) : v))))) return false
  return body.items.some((i) => i.expr.kind === NODE.COLUMN)
}
