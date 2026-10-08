// M5.9 — CHECK constraints: made, refused, enforced and shown as 8.4.11 does.
//
// A constraint is kept in its table's definition (`options.checks`) as the
// text it was written in, with the name it was given and the character set a
// string in it was read in, and is parsed again where it is needed: compiled
// against the row to enforce it, printed for CHECK_CLAUSE. What the probes
// taught:
//
//   - An unnamed constraint is `<table>_chk_<n>`, numbered in the order the
//     statement writes them, a column's own among the table's; a name is
//     unique in its schema (3822).
//   - The expression must be a condition — a comparison, a logical operator,
//     IN, BETWEEN, LIKE, IS, a boolean literal or a boolean function — not a
//     bare value (3812). It may not name a column the table lacks (3820), an
//     AUTO_INCREMENT column (3818), a variable (3816), a subquery (3815) or a
//     function whose answer is not the row's alone (3814, naming it).
//   - A row is refused when a constraint is FALSE, not NULL: 3819 naming the
//     first violated in name order, before the row is written, so it is not
//     a duplicate first and costs no AUTO_INCREMENT value. IGNORE skips the
//     row with a warning, and it is not counted among the "Records".
//   - NOT ENFORCED keeps a constraint as documentation.
import { requireCollationInfo } from '@myjs/charsets'
import { sqlError } from '@myjs/protocol'
import type { Catalog, ColumnDef, FieldBytes, TableDef, TableSpec } from '@myjs/engine'
import { NODE, TOKEN, lex, parseExpression, type CheckConstraint, type CreateTableNode, type Expression, type Token } from '@myjs/parser'
import { decodeField, truth } from '@myjs/types'
import { compile, type Compiled } from './compile.ts'
import { escapeString, printExpression } from './print.ts'
import { compileContext, type Run } from './query.ts'
import { TableScope } from './scope.ts'

export interface CheckDef {
  readonly name: string
  /** The condition, as written. */
  readonly text: string
  readonly enforced: boolean
  /** The character set its strings were read in: the connection's at CREATE. */
  readonly charset: string
}

export function checksOf(def: { readonly options?: Readonly<Record<string, unknown>> }): CheckDef[] {
  const stored = def.options?.['checks']
  return Array.isArray(stored) ? (stored as CheckDef[]) : []
}

/** The constraints a CREATE TABLE writes, table-level and column-level, in the order it writes them. */
export function checkClauses(node: CreateTableNode): CheckConstraint[] {
  const all = [...node.checks, ...node.columns.flatMap((c) => (c.check === undefined ? [] : [c.check]))]
  return all.sort((a, b) => a.at - b.at)
}

/** The text of a CHECK's condition, from the statement it is in: what lies between `CHECK (` and its `)`. */
function conditionText(sql: string, tokens: readonly Token[], check: CheckConstraint): string {
  let i = tokens.findIndex((t) => t.start >= check.at && t.kind === TOKEN.IDENTIFIER && t.text.toUpperCase() === 'CHECK')
  i++ // the (
  const open = tokens[i] as Token
  let depth = 0
  for (let j = i; j < tokens.length; j++) {
    const t = tokens[j] as Token
    if (t.kind !== TOKEN.OPERATOR) continue
    if (t.text === '(') depth++
    else if (t.text === ')' && --depth === 0) return sql.slice(open.end, t.start).trim()
  }
  return sql.slice(open.end).trim()
}

/** Functions whose answer is not the row's alone: what 3814 names. */
const DISALLOWED = new Set([
  'NOW', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'SYSDATE', 'CURDATE', 'CURRENT_DATE', 'CURTIME', 'CURRENT_TIME', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'UNIX_TIMESTAMP',
  'RAND', 'UUID', 'UUID_SHORT', 'RANDOM_BYTES', 'CONNECTION_ID', 'CURRENT_USER', 'USER', 'SESSION_USER', 'SYSTEM_USER', 'CURRENT_ROLE', 'DATABASE', 'SCHEMA', 'FOUND_ROWS', 'LAST_INSERT_ID', 'ROW_COUNT',
  'GET_LOCK', 'RELEASE_LOCK', 'RELEASE_ALL_LOCKS', 'IS_FREE_LOCK', 'IS_USED_LOCK', 'SLEEP', 'BENCHMARK', 'LOAD_FILE', 'MASTER_POS_WAIT', 'SOURCE_POS_WAIT', 'VERSION',
])

/** The functions that are conditions themselves, as a comparison is. */
const BOOLEAN_FUNCTIONS = new Set(['JSON_VALID', 'REGEXP_LIKE', 'ISNULL'])
const CONDITIONS = new Set(['=', '<>', '!=', '<', '<=', '>', '>=', '<=>', 'AND', '&&', 'OR', '||', 'XOR', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'LIKE', 'NOT LIKE', 'REGEXP', 'NOT REGEXP', 'RLIKE', 'NOT RLIKE', 'IS', 'IS NOT'])

function isCondition(e: Expression): boolean {
  switch (e.kind) {
    case NODE.BINARY:
      return CONDITIONS.has(e.op.toUpperCase())
    case NODE.UNARY:
      return e.op === 'NOT' || e.op === '!' || e.op.startsWith('IS ')
    case NODE.LITERAL:
      return e.type === 'bool'
    case NODE.CALL:
      return BOOLEAN_FUNCTIONS.has(e.name.toUpperCase())
    case NODE.ROW:
      return e.items.length === 1 && isCondition(e.items[0] as Expression)
    default:
      return false
  }
}

/** Every node of an expression tree, depth first. */
function* nodes(root: unknown): Generator<{ readonly kind: string } & Record<string, unknown>> {
  if (root === null || typeof root !== 'object') return
  if (Array.isArray(root)) {
    for (const x of root) yield* nodes(x)
    return
  }
  const n = root as { kind?: unknown } & Record<string, unknown>
  if (typeof n.kind === 'string') yield n as { kind: string } & Record<string, unknown>
  for (const v of Object.values(n)) if (typeof v === 'object') yield* nodes(v)
}

/**
 * `spec` with its CHECK constraints named, checked and stored. `sql` is the
 * statement they were written in, `charset` the connection's character set.
 */
export function withChecks(catalog: Catalog, schema: string, spec: TableSpec, sql: string, clauses: readonly CheckConstraint[], charset: number): TableSpec {
  if (clauses.length === 0) return spec
  const tokens = lex(sql)
  const taken = new Set<string>()
  for (const t of catalog.tables(schema)) if (t.name !== spec.name) for (const c of checksOf(t)) taken.add(c.name.toLowerCase())
  const columns = new Map(spec.columns.map((c) => [c.name.toLowerCase(), c] as const))
  const made: CheckDef[] = []
  const existing = checksOf(spec)
  for (const c of existing) taken.add(c.name.toLowerCase())
  // An ALTER's new constraint continues from the table's highest number (8.4.11).
  const prefix = `${spec.name}_chk_`
  let n = Math.max(0, ...existing.map((c) => (c.name.startsWith(prefix) && /^\d+$/.test(c.name.slice(prefix.length)) ? Number(c.name.slice(prefix.length)) : 0)))
  for (const clause of clauses) {
    const name = clause.name ?? `${spec.name}_chk_${++n}`
    if (taken.has(name.toLowerCase())) throw sqlError('ER_CHECK_CONSTRAINT_DUP_NAME', `Duplicate check constraint name '${name}'.`)
    taken.add(name.toLowerCase())
    const e = clause.expr
    for (const node of nodes(e)) {
      if (node.kind === NODE.COLUMN) {
        const parts = node['parts'] as readonly string[]
        const column = columns.get((parts[parts.length - 1] as string).toLowerCase())
        if (column === undefined) throw sqlError('ER_CHECK_CONSTRAINT_REFERS_UNKNOWN_COLUMN', `Check constraint '${name}' refers to non-existing column '${parts[parts.length - 1]}'.`)
        if (column.autoIncrement === true) throw sqlError('ER_CHECK_CONSTRAINT_REFERS_AUTO_INCREMENT_COLUMN', `Check constraint '${name}' cannot refer to an auto-increment column.`)
      } else if (node.kind === NODE.SUBQUERY) {
        throw sqlError('ER_CHECK_CONSTRAINT_FUNCTION_IS_NOT_ALLOWED', `An expression of a check constraint '${name}' contains disallowed function.`)
      } else if (node.kind === NODE.VARIABLE) {
        throw sqlError('ER_CHECK_CONSTRAINT_VARIABLES', `An expression of a check constraint '${name}' cannot refer to a user or system variable.`)
      } else if (node.kind === NODE.CALL && DISALLOWED.has(String(node['name']).toUpperCase())) {
        throw sqlError('ER_CHECK_CONSTRAINT_NAMED_FUNCTION_IS_NOT_ALLOWED', `An expression of a check constraint '${name}' contains disallowed function: ${String(node['name']).toLowerCase()}.`)
      }
    }
    if (!isCondition(e)) throw sqlError('ER_NON_BOOLEAN_EXPR_FOR_CHECK_CONSTRAINT', `An expression of non-boolean type specified to a check constraint '${name}'.`)
    made.push({ name, text: conditionText(sql, tokens, clause), enforced: clause.enforced, charset: requireCollationInfo(charset).charset })
  }
  return { ...spec, options: { ...(spec.options ?? {}), checks: [...existing, ...made] } }
}

/** CHECK_CLAUSE: the condition as the server reprints it, then escaped as INFORMATION_SCHEMA shows it. */
export function checkClause(check: CheckDef): string | null {
  let printed: string
  try {
    printed = printExpression(parseExpression(check.text), {
      column: (parts) => `\`${(parts[parts.length - 1] as string).replace(/`/g, '``')}\``,
      string: (v, cs) => `_${cs ?? check.charset}'${escapeString(v)}'`,
      source: check.text,
    })
  } catch {
    return check.text
  }
  return printed.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * A table's enforced constraints, compiled, in name order: a function from a
 * row's fields to the first one it violates, or `undefined`.
 */
export function checker(run: Run, def: TableDef): ((fields: readonly FieldBytes[]) => string | undefined) | undefined {
  const enforced = checksOf(def)
    .filter((c) => c.enforced)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  if (enforced.length === 0) return undefined
  const ctx = compileContext(run, new TableScope([{ alias: def.name, def }]), 'check constraint')
  const compiled: [string, Compiled][] = enforced.map((c) => [c.name, compile(parseExpression(c.text), ctx)])
  return (fields) => {
    const row = def.columns.map((c: ColumnDef, i) => decodeField(fields[i] ?? null, c.type))
    for (const [name, c] of compiled) if (truth(c.eval(row, run.env)) === false) return name
    return undefined
  }
}

export const checkViolated = (name: string) => sqlError('ER_CHECK_CONSTRAINT_VIOLATED', `Check constraint '${name}' is violated.`)
