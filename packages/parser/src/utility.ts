// M3.6 — the statements that drive a session rather than its data: `SET`,
// `USE`, `SHOW`, `EXPLAIN`/`DESCRIBE`, transaction control, prepared
// statements and `DO`.
//
// Most of this grammar is small. Where it is not obvious, the facts below came
// from asking a real 8.4.11 rather than from reading the manual:
//
//   - A scope keyword is sticky across a `SET` list and `@@scope.` is not:
//     `SET GLOBAL a = 1, b = 2` sets both globally, `SET @@global.a = 1, b = 2`
//     does not. `SetItem` records the scope each item ends up with.
//   - `SET NAMES` may sit anywhere in an assignment list, but never after a
//     scope keyword, and `SET TRANSACTION` may not sit in a list at all.
//   - `PREPARE … FROM` takes one string literal or one user variable. An
//     introducer, adjacent literals, a function call or `@@x` are all
//     ER_PARSE_ERROR. `EXECUTE … USING` takes user variables only.
//   - `EXPLAIN`'s options come in one order — `ANALYZE`, `FORMAT`, `INTO`,
//     `FOR SCHEMA` — and `ANALYZE` excludes `INTO`.
//   - `START TRANSACTION READ ONLY, READ WRITE` and `COMMIT AND CHAIN RELEASE`
//     are syntax errors, while a repeated characteristic is not.
import { NODE, type Expression, type KeywordNode } from './ast.ts'
import type { Cursor } from './cursor.ts'
import { parseUser } from './ddl.ts'
import { parseDelete, parseInsert, parseUpdate } from './dml.ts'
import { parseExpressionFrom } from './expression.ts'
import { atParenthesisedQuery, atQueryStart, parseLimitValue, parseQueryFrom, parseWithFrom } from './query.ts'
import type { Limit } from './query-ast.ts'
import type { SqlMode } from './sql-mode.ts'
import {
  STATEMENT,
  type AccessMode,
  type CommitNode,
  type DeallocateNode,
  type DescribeNode,
  type DoNode,
  type ExecuteNode,
  type ExplainableStatement,
  type ExplainNode,
  type IsolationLevel,
  type PrepareNode,
  type RollbackNode,
  type SavepointNode,
  type SetItem,
  type SetNode,
  type SetTransactionNode,
  type ShowNode,
  type StartTransactionNode,
  type UseNode,
  type VariableScope,
} from './statement-ast.ts'
import { TOKEN } from './tokens.ts'
import { unsupportedStatement } from './errors.ts'

/** `{ key: value }` when defined, `{}` when not — an absent field, never `undefined`. */
const opt = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

// --- SET -----------------------------------------------------------------------

/** `SET …`, with the cursor on `SET`. */
export function parseSet(c: Cursor, mode: SqlMode): SetNode | SetTransactionNode {
  const at = c.peek().start
  c.expectWord('SET')

  // Statements that begin with `SET` and are not assignments. Named, so the
  // refusal says which one rather than calling it a syntax error.
  for (const words of [['PASSWORD'], ['ROLE'], ['DEFAULT', 'ROLE'], ['RESOURCE', 'GROUP']]) {
    if (c.atWords(...words)) throw unsupportedStatement(`SET ${words.join(' ')}`)
  }

  const scopeWord = scopeKeyword(c, 0)
  if (c.atWord('TRANSACTION', scopeWord === undefined ? 0 : 1)) {
    if (scopeWord !== undefined) c.skip()
    return setTransaction(c, scopeWord, at)
  }

  const items: SetItem[] = []
  let sticky: VariableScope | undefined
  do {
    const scope = scopeKeyword(c, 0)
    if (scope !== undefined) {
      c.skip()
      sticky = scope
      // `SET GLOBAL NAMES …` is ER_PARSE_ERROR: after a scope keyword only a
      // variable name may follow.
      const { base, name } = internalName(c)
      items.push({ type: 'system', scope, ...opt('base', base), name, value: assigned(c, mode, true) })
    } else {
      items.push(setItem(c, mode, sticky))
    }
  } while (c.takeOp(','))
  return { kind: STATEMENT.SET, items, at }
}

/** `GLOBAL`, `SESSION`, `LOCAL`, `PERSIST` or `PERSIST_ONLY` at `ahead`, as a scope. */
function scopeKeyword(c: Cursor, ahead: number): VariableScope | undefined {
  if (c.atWord('GLOBAL', ahead)) return 'GLOBAL'
  if (c.atWord('SESSION', ahead) || c.atWord('LOCAL', ahead)) return 'SESSION'
  if (c.atWord('PERSIST', ahead)) return 'PERSIST'
  if (c.atWord('PERSIST_ONLY', ahead)) return 'PERSIST_ONLY'
  return undefined
}

function setItem(c: Cursor, mode: SqlMode, sticky: VariableScope | undefined): SetItem {
  if (c.takeWord('NAMES')) {
    if (c.takeWord('DEFAULT')) return { type: 'names' }
    const charset = charsetName(c)
    if (!c.takeWord('COLLATE')) return { type: 'names', charset }
    return { type: 'names', charset, collation: nameOrString(c) }
  }
  if (c.takeWords('CHARACTER', 'SET') || c.takeWord('CHARSET')) {
    return c.takeWord('DEFAULT') ? { type: 'charset' } : { type: 'charset', charset: charsetName(c) }
  }

  const t = c.peek()
  if (t.kind === TOKEN.VARIABLE && !t.text.startsWith('@@')) {
    c.skip()
    return { type: 'user', name: t.text.slice(1), value: assigned(c, mode, false) }
  }
  if (t.kind === TOKEN.VARIABLE) {
    const { scope, base, name } = systemVariable(c)
    return { type: 'system', ...opt('scope', scope), ...opt('base', base), name, value: assigned(c, mode, true) }
  }

  const { base, name } = internalName(c)
  const value = assigned(c, mode, true)
  // A bare name inherits the last scope keyword written before it.
  if (sticky !== undefined) return { type: 'system', scope: sticky, ...opt('base', base), name, value }
  return { type: 'name', ...opt('base', base), name, value }
}

/** A charset name: a word, a string, or `BINARY`, which is reserved. */
function charsetName(c: Cursor): string {
  if (c.takeWord('BINARY')) return 'binary'
  return nameOrString(c)
}

function nameOrString(c: Cursor): string {
  return c.peek().kind === TOKEN.STRING ? c.take().text : c.expectIdentifier()
}

/**
 * `@@x`, `@@global.x`, `@@global.base.x`, `@@global . x`.
 *
 * The lexer reads the whole dotted run as one variable token, and a quoted part
 * as a separate token after it, so both shapes are reassembled here.
 */
function systemVariable(c: Cursor): { scope?: VariableScope; base?: string; name: string } {
  const parts = c.take().text.slice(2).split('.')
  // `@@session.`x``: the lexer stops at the quote, leaving a trailing `.`.
  if (parts[parts.length - 1] === '') {
    parts.pop()
    parts.push(c.expectNamePart())
  }
  // `@@global . x` and `@@global.`a b`.x`: the rest are tokens of their own.
  while (parts.length < 3 && c.takeOp('.')) parts.push(c.expectNamePart())

  let scope: VariableScope | undefined
  const first = parts[0]?.toUpperCase()
  if (parts.length > 1) {
    if (first === 'GLOBAL') scope = 'GLOBAL'
    else if (first === 'SESSION' || first === 'LOCAL') scope = 'SESSION'
    else if (first === 'PERSIST') scope = 'PERSIST'
    else if (first === 'PERSIST_ONLY') scope = 'PERSIST_ONLY'
    if (scope !== undefined) parts.shift()
  }
  if (parts.length === 0 || parts.length > 2 || parts.some((p) => p === '')) c.fail()
  const name = parts[parts.length - 1] as string
  return parts.length === 2 ? { ...opt('scope', scope), base: parts[0] as string, name } : { ...opt('scope', scope), name }
}

/** `x`, `base.x`, or `DEFAULT.x`: a system variable written without `@@`. */
function internalName(c: Cursor): { base?: string; name: string } {
  if (c.atWord('DEFAULT') && c.atOp('.', 1)) {
    c.skip()
    c.skip()
    return { base: 'default', name: c.expectNamePart() }
  }
  const first = c.expectIdentifier()
  return c.takeOp('.') ? { base: first, name: c.expectNamePart() } : { name: first }
}

/** Reserved words a system variable may be set to, as a keyword rather than an expression. */
const VALUE_KEYWORDS = new Set(['DEFAULT', 'ON', 'ALL', 'BINARY', 'ROW', 'SYSTEM'])

/** `= value` or `:= value`. */
function assigned(c: Cursor, mode: SqlMode, system: boolean): Expression | KeywordNode {
  if (!c.takeOp('=')) c.expectOp(':=')
  const t = c.peek()
  // Only where the item ends: `BINARY 'a'`, `ROW(1, 2)` and `DEFAULT(a)` are
  // expressions, and a reserved word cannot be a name, so this is never
  // ambiguous.
  if (system && t.kind === TOKEN.IDENTIFIER && t.quoted !== true && VALUE_KEYWORDS.has(t.text.toUpperCase()) && atItemEnd(c, 1)) {
    c.skip()
    return { kind: NODE.KEYWORD, word: t.text.toUpperCase(), at: t.start }
  }
  return parseExpressionFrom(c, mode)
}

function atItemEnd(c: Cursor, ahead: number): boolean {
  const t = c.peek(ahead)
  return t.kind === TOKEN.EOF || (t.kind === TOKEN.OPERATOR && (t.text === ',' || t.text === ';'))
}

/** `SET [scope] TRANSACTION characteristic [, characteristic]`, with the cursor on `TRANSACTION`. */
function setTransaction(c: Cursor, scope: VariableScope | undefined, at: number): SetTransactionNode {
  c.expectWord('TRANSACTION')
  let isolation: IsolationLevel | undefined
  let access: AccessMode | undefined
  do {
    if (c.takeWords('ISOLATION', 'LEVEL')) {
      if (isolation !== undefined) c.fail()
      isolation = isolationLevel(c)
    } else {
      if (access !== undefined) c.fail()
      access = accessMode(c) ?? c.fail()
    }
  } while (c.takeOp(','))
  return { kind: STATEMENT.SET_TRANSACTION, ...opt('scope', scope), ...opt('isolation', isolation), ...opt('access', access), at }
}

function isolationLevel(c: Cursor): IsolationLevel {
  if (c.takeWords('REPEATABLE', 'READ')) return 'REPEATABLE READ'
  if (c.takeWords('READ', 'COMMITTED')) return 'READ COMMITTED'
  if (c.takeWords('READ', 'UNCOMMITTED')) return 'READ UNCOMMITTED'
  if (c.takeWord('SERIALIZABLE')) return 'SERIALIZABLE'
  return c.fail()
}

function accessMode(c: Cursor): AccessMode | undefined {
  if (c.takeWords('READ', 'ONLY')) return 'READ ONLY'
  if (c.takeWords('READ', 'WRITE')) return 'READ WRITE'
  return undefined
}

// --- USE, DO -------------------------------------------------------------------

export function parseUse(c: Cursor): UseNode {
  const at = c.peek().start
  c.expectWord('USE')
  return { kind: STATEMENT.USE, database: c.expectIdentifier(), at }
}

export function parseDo(c: Cursor, mode: SqlMode): DoNode {
  const at = c.peek().start
  c.expectWord('DO')
  const exprs = [parseExpressionFrom(c, mode)]
  while (c.takeOp(',')) exprs.push(parseExpressionFrom(c, mode))
  return { kind: STATEMENT.DO, exprs, at }
}

// --- transactions --------------------------------------------------------------

/** `START TRANSACTION …` or `BEGIN [WORK]`. */
export function parseStartTransaction(c: Cursor): StartTransactionNode {
  const at = c.peek().start
  if (c.takeWord('BEGIN')) {
    c.takeWord('WORK')
    return { kind: STATEMENT.START_TRANSACTION, at }
  }
  c.expectWord('START')
  c.expectWord('TRANSACTION')
  let consistentSnapshot = false
  let access: AccessMode | undefined
  if (!c.atEnd() && !c.atOp(';')) {
    do {
      if (c.takeWords('WITH', 'CONSISTENT', 'SNAPSHOT')) {
        consistentSnapshot = true
        continue
      }
      const mode = accessMode(c) ?? c.fail()
      if (access !== undefined && access !== mode) c.fail()
      access = mode
    } while (c.takeOp(','))
  }
  return {
    kind: STATEMENT.START_TRANSACTION,
    ...(consistentSnapshot ? { consistentSnapshot } : {}),
    ...opt('access', access),
    at,
  }
}

export function parseCommit(c: Cursor): CommitNode {
  const at = c.peek().start
  c.expectWord('COMMIT')
  c.takeWord('WORK')
  return { kind: STATEMENT.COMMIT, ...completion(c), at }
}

export function parseRollback(c: Cursor): RollbackNode {
  const at = c.peek().start
  c.expectWord('ROLLBACK')
  c.takeWord('WORK')
  if (c.takeWord('TO')) {
    c.takeWord('SAVEPOINT')
    return { kind: STATEMENT.ROLLBACK, savepoint: c.expectIdentifier(), at }
  }
  return { kind: STATEMENT.ROLLBACK, ...completion(c), at }
}

/** `[AND [NO] CHAIN] [[NO] RELEASE]`, refusing `AND CHAIN RELEASE` as 8.4 does. */
function completion(c: Cursor): { chain?: boolean; release?: boolean } {
  let chain: boolean | undefined
  let release: boolean | undefined
  if (c.takeWord('AND')) {
    chain = !c.takeWord('NO')
    c.expectWord('CHAIN')
  }
  if (c.takeWords('NO', 'RELEASE')) release = false
  else if (c.takeWord('RELEASE')) {
    if (chain === true) c.fail()
    release = true
  }
  return { ...opt('chain', chain), ...opt('release', release) }
}

export function parseSavepoint(c: Cursor): SavepointNode {
  const at = c.peek().start
  if (c.takeWord('RELEASE')) {
    c.expectWord('SAVEPOINT')
    return { kind: STATEMENT.RELEASE_SAVEPOINT, name: c.expectIdentifier(), at }
  }
  c.expectWord('SAVEPOINT')
  return { kind: STATEMENT.SAVEPOINT, name: c.expectIdentifier(), at }
}

// --- prepared statements -------------------------------------------------------

export function parsePrepare(c: Cursor): PrepareNode {
  const at = c.peek().start
  c.expectWord('PREPARE')
  const name = c.expectIdentifier()
  c.expectWord('FROM')
  const t = c.peek()
  if (t.kind === TOKEN.STRING) return { kind: STATEMENT.PREPARE, name, text: c.take().text, at }
  return { kind: STATEMENT.PREPARE, name, variable: userVariable(c), at }
}

export function parseExecute(c: Cursor): ExecuteNode {
  const at = c.peek().start
  c.expectWord('EXECUTE')
  const name = c.expectIdentifier()
  if (!c.takeWord('USING')) return { kind: STATEMENT.EXECUTE, name, at }
  const using = [userVariable(c)]
  while (c.takeOp(',')) using.push(userVariable(c))
  return { kind: STATEMENT.EXECUTE, name, using, at }
}

/** `DEALLOCATE PREPARE s` or `DROP PREPARE s`. */
export function parseDeallocate(c: Cursor): DeallocateNode {
  const at = c.peek().start
  if (!c.takeWord('DROP')) c.expectWord('DEALLOCATE')
  c.expectWord('PREPARE')
  return { kind: STATEMENT.DEALLOCATE, name: c.expectIdentifier(), at }
}

/** `@name`, as its name. `@@x` is a system variable and is refused here. */
function userVariable(c: Cursor): string {
  const t = c.peek()
  if (t.kind !== TOKEN.VARIABLE || t.text.startsWith('@@')) c.fail()
  c.skip()
  return t.text.slice(1)
}

// --- EXPLAIN and DESCRIBE ------------------------------------------------------

/** True at a statement `EXPLAIN` can explain. */
function atExplainable(c: Cursor): boolean {
  return (
    atQueryStart(c) ||
    atParenthesisedQuery(c) ||
    c.atWord('INSERT') ||
    c.atWord('REPLACE') ||
    c.atWord('UPDATE') ||
    c.atWord('DELETE')
  )
}

/**
 * A query, `INSERT`, `REPLACE`, `UPDATE` or `DELETE`, possibly opened by
 * `WITH`. The same set the statement dispatcher handles, so it uses this too.
 */
export function parseExplainable(c: Cursor, mode: SqlMode): ExplainableStatement {
  if (c.atWord('INSERT') || c.atWord('REPLACE')) return parseInsert(c, mode)
  if (c.atWord('UPDATE')) return parseUpdate(c, mode)
  if (c.atWord('DELETE')) return parseDelete(c, mode)
  if (c.atWord('WITH')) {
    const at = c.peek().start
    const withClause = parseWithFrom(c, mode)
    if (c.atWord('UPDATE')) return parseUpdate(c, mode, withClause, at)
    if (c.atWord('DELETE')) return parseDelete(c, mode, withClause, at)
    return parseQueryFrom(c, mode, true, withClause, at)
  }
  return parseQueryFrom(c, mode, true)
}

/** `EXPLAIN …`, `DESCRIBE …` or `DESC …`, with the cursor on the keyword. */
export function parseExplain(c: Cursor, mode: SqlMode): ExplainNode | DescribeNode {
  const at = c.peek().start
  c.skip()

  const hasOptions = c.atWord('ANALYZE') || (c.atWord('FORMAT') && c.atOp('=', 1)) || c.atWord('INTO') || c.atWord('FOR')
  if (!hasOptions && !atExplainable(c)) return describe(c, at)

  const analyze = c.takeWord('ANALYZE')
  let format: string | undefined
  if (c.takeWord('FORMAT')) {
    c.expectOp('=')
    format = nameOrString(c).toUpperCase()
  }
  let into: string | undefined
  if (!analyze && c.takeWord('INTO')) into = userVariable(c)

  if (c.atWords('FOR', 'CONNECTION')) {
    c.skip()
    c.skip()
    return {
      kind: STATEMENT.EXPLAIN,
      ...(analyze ? { analyze } : {}),
      ...opt('format', format),
      ...opt('into', into),
      connection: unsignedInteger(c),
      at,
    }
  }
  let schema: string | undefined
  if (c.takeWord('FOR')) {
    if (!c.takeWord('SCHEMA')) c.expectWord('DATABASE')
    schema = c.expectIdentifier()
  }
  if (!atExplainable(c)) c.fail()
  return {
    kind: STATEMENT.EXPLAIN,
    ...(analyze ? { analyze } : {}),
    ...opt('format', format),
    ...opt('into', into),
    ...opt('schema', schema),
    statement: parseExplainable(c, mode),
    at,
  }
}

function describe(c: Cursor, at: number): DescribeNode {
  const table = c.expectTableName()
  const t = c.peek()
  let column: string | undefined
  if (t.kind === TOKEN.STRING) column = c.take().text
  else if (c.atIdentifier()) column = c.take().text
  return { kind: STATEMENT.DESCRIBE, table, ...opt('column', column), at }
}

function unsignedInteger(c: Cursor): bigint {
  const t = c.peek()
  if (t.kind !== TOKEN.NUMBER || !/^\d+$/.test(t.text)) c.fail()
  c.skip()
  return BigInt(t.text)
}

// --- SHOW ----------------------------------------------------------------------

/**
 * What may follow each listing form. `database` is `FROM db`, `filter` is
 * `LIKE 'p'` or `WHERE expr`, and `full`, `extended` and `scope` are the
 * modifiers written before the form's name.
 */
interface ShowForm {
  readonly what: string
  readonly database?: true
  readonly filter?: true
  readonly full?: true
  readonly extended?: true
  readonly scope?: true
}

/** The listing forms, by their spellings. A spelling's first match wins, so longer ones come first. */
const SHOW_FORMS: readonly (readonly [readonly string[], ShowForm])[] = [
  [['TABLE', 'STATUS'], { what: 'TABLE STATUS', database: true, filter: true }],
  [['TABLES'], { what: 'TABLES', database: true, filter: true, full: true, extended: true }],
  [['OPEN', 'TABLES'], { what: 'OPEN TABLES', database: true, filter: true }],
  [['TRIGGERS'], { what: 'TRIGGERS', database: true, filter: true, full: true }],
  [['EVENTS'], { what: 'EVENTS', database: true, filter: true }],
  [['DATABASES'], { what: 'DATABASES', filter: true }],
  [['SCHEMAS'], { what: 'DATABASES', filter: true }],
  [['VARIABLES'], { what: 'VARIABLES', filter: true, scope: true }],
  [['STATUS'], { what: 'STATUS', filter: true, scope: true }],
  [['CHARACTER', 'SET'], { what: 'CHARACTER SET', filter: true }],
  [['CHARSET'], { what: 'CHARACTER SET', filter: true }],
  [['COLLATION'], { what: 'COLLATION', filter: true }],
  [['PROCEDURE', 'STATUS'], { what: 'PROCEDURE STATUS', filter: true }],
  [['FUNCTION', 'STATUS'], { what: 'FUNCTION STATUS', filter: true }],
  [['STORAGE', 'ENGINES'], { what: 'ENGINES' }],
  [['ENGINES'], { what: 'ENGINES' }],
  [['PLUGINS'], { what: 'PLUGINS' }],
  [['PRIVILEGES'], { what: 'PRIVILEGES' }],
  [['PROCESSLIST'], { what: 'PROCESSLIST', full: true }],
  [['BINARY', 'LOG', 'STATUS'], { what: 'BINARY LOG STATUS' }],
  [['BINARY', 'LOGS'], { what: 'BINARY LOGS' }],
]

/** `SHOW CREATE <object> name`. `SCHEMA` is `DATABASE`. */
const SHOW_CREATE: readonly (readonly [string, string])[] = [
  ['TABLE', 'TABLE'],
  ['VIEW', 'VIEW'],
  ['DATABASE', 'DATABASE'],
  ['SCHEMA', 'DATABASE'],
  ['PROCEDURE', 'PROCEDURE'],
  ['FUNCTION', 'FUNCTION'],
  ['TRIGGER', 'TRIGGER'],
  ['EVENT', 'EVENT'],
]

/** `SHOW …`, with the cursor on `SHOW`. */
export function parseShow(c: Cursor, mode: SqlMode): ShowNode {
  const at = c.peek().start
  c.expectWord('SHOW')

  if (c.takeWord('CREATE')) return showCreate(c, at)

  if (c.atWord('WARNINGS') || c.atWord('ERRORS')) {
    const what = c.take().text.toUpperCase()
    const limit = c.takeWord('LIMIT') ? showLimit(c) : undefined
    return { kind: STATEMENT.SHOW, what, ...opt('limit', limit), at }
  }
  if (c.atWord('COUNT') && c.atOp('(', 1)) {
    c.skip()
    c.skip()
    c.expectOp('*')
    c.expectOp(')')
    if (!c.atWord('WARNINGS') && !c.atWord('ERRORS')) c.fail()
    return { kind: STATEMENT.SHOW, what: c.take().text.toUpperCase(), count: true, at }
  }
  if (c.takeWord('GRANTS')) {
    if (!c.takeWord('FOR')) return { kind: STATEMENT.SHOW, what: 'GRANTS', at }
    const user = parseUser(c)
    if (c.atWord('USING')) throw unsupportedStatement('SHOW GRANTS … USING')
    return { kind: STATEMENT.SHOW, what: 'GRANTS', user, at }
  }

  // The modifiers, in the one order MySQL accepts: `SHOW EXTENDED FULL TABLES`
  // parses and `SHOW FULL EXTENDED TABLES` does not.
  const extended = c.takeWord('EXTENDED')
  const full = c.takeWord('FULL')
  let scope: 'GLOBAL' | 'SESSION' | undefined
  if (c.takeWord('GLOBAL')) scope = 'GLOBAL'
  else if (c.takeWord('SESSION') || c.takeWord('LOCAL')) scope = 'SESSION'

  if (c.takeWord('COLUMNS') || c.takeWord('FIELDS')) {
    if (scope !== undefined) c.fail()
    return { kind: STATEMENT.SHOW, what: 'COLUMNS', ...flags(full, extended), name: tableFrom(c), ...filter(c, mode, true), at }
  }
  if (c.takeWord('INDEX') || c.takeWord('INDEXES') || c.takeWord('KEYS')) {
    if (scope !== undefined || full) c.fail()
    return { kind: STATEMENT.SHOW, what: 'INDEX', ...flags(false, extended), name: tableFrom(c), ...filter(c, mode, false), at }
  }

  const match = SHOW_FORMS.find(([words]) => c.atWords(...words))
  if (match === undefined) {
    if (extended || full || scope !== undefined) c.fail()
    throw unsupportedStatement(`SHOW ${c.peek().text.toUpperCase()}`)
  }
  const [words, form] = match
  if ((full && form.full !== true) || (extended && form.extended !== true) || (scope !== undefined && form.scope !== true)) c.fail()
  c.at += words.length
  const database = form.database === true && (c.takeWord('FROM') || c.takeWord('IN')) ? c.expectIdentifier() : undefined
  return {
    kind: STATEMENT.SHOW,
    what: form.what,
    ...flags(full, extended),
    ...opt('scope', scope),
    ...opt('database', database),
    ...(form.filter === true ? filter(c, mode, true) : {}),
    at,
  }
}

const flags = (full: boolean, extended: boolean): { full?: boolean; extended?: boolean } => ({
  ...(full ? { full } : {}),
  ...(extended ? { extended } : {}),
})

function showCreate(c: Cursor, at: number): ShowNode {
  if (c.takeWord('USER')) return { kind: STATEMENT.SHOW, what: 'CREATE USER', user: parseUser(c), at }
  const object = SHOW_CREATE.find(([word]) => c.atWord(word))
  if (object === undefined) throw unsupportedStatement(`SHOW CREATE ${c.peek().text.toUpperCase()}`)
  c.skip()
  const what = `CREATE ${object[1]}`
  if (what === 'CREATE DATABASE') {
    const ifNotExists = c.takeWords('IF', 'NOT', 'EXISTS')
    return { kind: STATEMENT.SHOW, what, ...(ifNotExists ? { ifNotExists } : {}), name: { name: c.expectIdentifier() }, at }
  }
  return { kind: STATEMENT.SHOW, what, name: c.expectTableName(), at }
}

/** `FROM t [FROM db]`, folded into one name — the second `FROM` wins. */
function tableFrom(c: Cursor): { schema?: string; name: string } {
  if (!c.takeWord('FROM')) c.expectWord('IN')
  const table = c.expectTableName()
  if (!c.takeWord('FROM') && !c.takeWord('IN')) return table
  return { schema: c.expectIdentifier(), name: table.name }
}

/** `LIKE 'p'` or `WHERE expr` — or only `WHERE`, for `SHOW INDEX`. */
function filter(c: Cursor, mode: SqlMode, like: boolean): { like?: string; where?: Expression } {
  if (like && c.takeWord('LIKE')) return { like: c.expectString() }
  if (c.takeWord('WHERE')) return { where: parseExpressionFrom(c, mode) }
  return {}
}

/** `LIMIT n`, `LIMIT m, n` or `LIMIT n OFFSET m`, for `SHOW WARNINGS` and `SHOW ERRORS`. */
function showLimit(c: Cursor): Limit {
  const first = parseLimitValue(c)
  if (c.takeOp(',')) return { count: parseLimitValue(c), offset: first }
  if (c.takeWord('OFFSET')) return { count: first, offset: parseLimitValue(c) }
  return { count: first }
}
