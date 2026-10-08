// M3.17 — administration statements: table maintenance, `FLUSH`, `TRUNCATE`,
// table and instance locks, `RENAME TABLE`, `LOAD DATA`, privileges, accounts
// and roles, and `RESET`.
//
// Parsed in full and kept as written. None of it changes what a statement
// *means* to the executor's data, which is why M3's exit criterion did not need
// it; it was the census's not-implemented list that did. Every acceptance and
// refusal here was put to a real 8.4.11 first, and the ones a reader would get
// wrong from the manual are these:
//
//   - `FLUSH TABLES t, PRIVILEGES` flushes a *table* named `PRIVILEGES`: the
//     `TABLES` form takes a table list and nothing else, so `FLUSH TABLES,
//     PRIVILEGES` is ER_PARSE_ERROR, and `FOR EXPORT` needs a table.
//   - `CHECK` and `CHECKSUM` take no `LOCAL`; `CHECKSUM` takes one of `QUICK`
//     and `EXTENDED`, while `CHECK` and `REPAIR` take any run of theirs, repeats
//     included. `FOR UPGRADE` is `CHECK`'s alone.
//   - A histogram's `USING DATA` excludes `WITH n BUCKETS` and `AUTO UPDATE`,
//     and `MANUAL UPDATE` comes after the buckets, never before.
//   - In `GRANT`, anything that is not a static privilege is a name — a dynamic
//     privilege or a role — so `GRANT SELECT, r1 ON t …` parses and is refused
//     only later. Column lists belong to `SELECT`, `INSERT`, `UPDATE` and
//     `REFERENCES`, and `ALL` stands alone.
//   - `REVOKE ALL FROM u` is ER_PARSE_ERROR: the form needs `, GRANT OPTION`.
//   - `CREATE USER`'s clauses come in one order (`DEFAULT ROLE`, `REQUIRE`,
//     `WITH`, password and lock options, then one `COMMENT` or `ATTRIBUTE`),
//     and `AND IDENTIFIED` is `CREATE`'s while `REPLACE`, `RETAIN CURRENT
//     PASSWORD` and `DISCARD OLD PASSWORD` are `ALTER`'s.
//   - A `LOAD DATA` delimiter is one literal — `',' ','` is refused, unlike in
//     an expression — and `ROWS IDENTIFIED BY` sits before `FIELDS`.
//   - `RESET MASTER`, `RESET SLAVE`, `FLUSH HOSTS` and `RESET QUERY CACHE` are
//     gone from 8.4: refused as syntax errors, which is what 8.4.11 answers.
import { LITERAL, NODE, type ColumnNode, type LiteralNode } from './ast.ts'
import { flag, opt, type Cursor } from './cursor.ts'
import { hexBytes } from './data-type.ts'
import { assignments, column } from './dml.ts'
import { charsetName } from './utility.ts'
import {
  STATEMENT,
  type Account,
  type AccountOptions,
  type AccountOrCurrent,
  type AlterUserNode,
  type CreateRoleNode,
  type CreateUserNode,
  type DropUserNode,
  type FlushNode,
  type FlushOption,
  type GrantNode,
  type Histogram,
  type Identification,
  type LoadDataNode,
  type LoadDelimiter,
  type LockedTable,
  type LockTablesNode,
  type Privilege,
  type PrivilegeLevel,
  type RenameTableNode,
  type RenameUserNode,
  type ResetNode,
  type RevokeNode,
  type RoleSpec,
  type SetDefaultRoleNode,
  type SetPasswordNode,
  type SetRoleNode,
  type TableMaintenanceNode,
  type TableName,
  type TruncateNode,
  type UnlockTablesNode,
  type UserSpec,
} from './statement-ast.ts'
import { TOKEN } from './tokens.ts'
import type { SqlMode } from './sql-mode.ts'

// --- small pieces --------------------------------------------------------------

/** An unsigned integer literal, as written: `10`, and where the grammar allows it, `0x1`. */
function unsigned(c: Cursor, hex = false): string {
  const t = c.peek()
  if (t.kind === TOKEN.NUMBER && /^\d+$/.test(t.text)) return c.take().text
  if (hex && t.kind === TOKEN.HEX) return `0x${c.take().text}`
  c.fail()
}

/** `t, db.t2, …`. */
function tableList(c: Cursor): TableName[] {
  const out = [c.expectTableName()]
  while (c.takeOp(',')) out.push(c.expectTableName())
  return out
}

/** One string literal, not concatenated with the next. */
function stringLiteral(c: Cursor): string {
  return c.expectString()
}

/**
 * An account or a role: `'u'@'h'`, `u@h`, `'u'`. The host is the variable
 * token the lexer makes of `@h`. A role may not be an unquoted `NONE`, which
 * is `SET ROLE NONE`'s word, while a user may (`GRANT r1 TO none`, 8.4.11).
 */
function account(c: Cursor, role = false): Account {
  const u = c.peek()
  const named = u.kind === TOKEN.STRING || (c.atIdentifier() && !c.atWord('CURRENT_USER') && !(role && c.atWord('NONE')))
  if (!named) c.fail()
  c.skip()
  const h = c.peek()
  if (h.kind === TOKEN.VARIABLE && h.text.startsWith('@') && !h.text.startsWith('@@')) {
    c.skip()
    return { user: u.text, host: h.text.slice(1) }
  }
  return { user: u.text }
}

/** An account, or `CURRENT_USER` / `CURRENT_USER()`. */
function accountOrCurrent(c: Cursor): AccountOrCurrent {
  if (c.takeWord('CURRENT_USER')) {
    if (c.takeOp('(')) c.expectOp(')')
    return 'CURRENT_USER'
  }
  return account(c)
}

function accounts(c: Cursor): AccountOrCurrent[] {
  const out = [accountOrCurrent(c)]
  while (c.takeOp(',')) out.push(accountOrCurrent(c))
  return out
}

function roles(c: Cursor): Account[] {
  const out = [account(c, true)]
  while (c.takeOp(',')) out.push(account(c, true))
  return out
}

/** `NONE`, `ALL [EXCEPT r, …]`, or `r, …`; `DEFAULT` only where `allowDefault`, `EXCEPT` only where `allowExcept`. */
function roleSpec(c: Cursor, allowDefault: boolean, allowExcept: boolean): RoleSpec {
  if (allowDefault && c.takeWord('DEFAULT')) return { which: 'DEFAULT' }
  if (c.takeWord('NONE')) return { which: 'NONE' }
  if (c.takeWord('ALL')) {
    if (allowExcept && c.takeWord('EXCEPT')) return { which: 'ALL', except: roles(c) }
    return { which: 'ALL' }
  }
  return { roles: roles(c) }
}

// --- table maintenance -----------------------------------------------------------

const MAINTENANCE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  CHECK: ['QUICK', 'FAST', 'MEDIUM', 'EXTENDED', 'CHANGED'],
  REPAIR: ['QUICK', 'EXTENDED', 'USE_FRM'],
  CHECKSUM: ['QUICK', 'EXTENDED'],
}

/** True at `ANALYZE`, `CHECK`, `CHECKSUM`, `OPTIMIZE` or `REPAIR` opening a statement. */
export function atTableMaintenance(c: Cursor): boolean {
  return ['ANALYZE', 'CHECK', 'CHECKSUM', 'OPTIMIZE', 'REPAIR'].some((w) => c.atWord(w))
}

export function parseTableMaintenance(c: Cursor): TableMaintenanceNode {
  const at = c.peek().start
  const op = c.take().text.toUpperCase() as TableMaintenanceNode['op']
  const noWriteToBinlog = op !== 'CHECK' && op !== 'CHECKSUM' && (c.takeWord('NO_WRITE_TO_BINLOG') || c.takeWord('LOCAL'))
  if (!c.takeWord('TABLE')) c.expectWord('TABLES')
  const tables = tableList(c)
  const options: string[] = []
  let histogram: Histogram | undefined
  if (op === 'ANALYZE') {
    histogram = parseHistogram(c)
  } else if (op === 'CHECKSUM') {
    if (c.atWord('QUICK') || c.atWord('EXTENDED')) options.push(c.take().text.toUpperCase())
  } else {
    const words = MAINTENANCE_OPTIONS[op] ?? []
    for (;;) {
      if (op === 'CHECK' && c.takeWords('FOR', 'UPGRADE')) options.push('FOR UPGRADE')
      else if (words.some((w) => c.atWord(w))) options.push(c.take().text.toUpperCase())
      else break
    }
  }
  return {
    kind: STATEMENT.TABLE_MAINTENANCE,
    op,
    ...flag('noWriteToBinlog', noWriteToBinlog),
    tables,
    ...(options.length > 0 ? { options } : {}),
    ...opt('histogram', histogram),
    at,
  }
}

function parseHistogram(c: Cursor): Histogram | undefined {
  const action = c.takeWord('UPDATE') ? 'UPDATE' : c.takeWord('DROP') ? 'DROP' : undefined
  if (action === undefined) return undefined
  c.expectWord('HISTOGRAM')
  c.expectWord('ON')
  const columns = [c.expectIdentifier()]
  while (c.takeOp(',')) columns.push(c.expectIdentifier())
  if (action === 'DROP') return { action, columns }
  if (c.takeWords('USING', 'DATA')) {
    const t = c.peek()
    if (t.kind !== TOKEN.STRING) c.fail()
    return { action, columns, data: c.take().text }
  }
  let buckets: string | undefined
  if (c.takeWord('WITH')) {
    buckets = unsigned(c)
    c.expectWord('BUCKETS')
  }
  let update: 'AUTO' | 'MANUAL' | undefined
  if (c.takeWords('AUTO', 'UPDATE')) update = 'AUTO'
  else if (c.takeWords('MANUAL', 'UPDATE')) update = 'MANUAL'
  return { action, columns, ...opt('buckets', buckets), ...opt('update', update) }
}

// --- FLUSH -------------------------------------------------------------------------

/** The `FLUSH` options 8.4 has, each spelled as its words. */
const FLUSH_OPTIONS: readonly (readonly string[])[] = [
  ['BINARY', 'LOGS'],
  ['ENGINE', 'LOGS'],
  ['ERROR', 'LOGS'],
  ['GENERAL', 'LOGS'],
  ['RELAY', 'LOGS'],
  ['SLOW', 'LOGS'],
  ['LOGS'],
  ['PRIVILEGES'],
  ['STATUS'],
  ['OPTIMIZER_COSTS'],
  ['USER_RESOURCES'],
]

export function parseFlush(c: Cursor): FlushNode {
  const at = c.peek().start
  c.expectWord('FLUSH')
  const noWriteToBinlog = c.takeWord('NO_WRITE_TO_BINLOG') || c.takeWord('LOCAL')
  if (c.takeWord('TABLE') || c.takeWord('TABLES')) {
    const tables = c.atIdentifier() ? tableList(c) : []
    let lock: 'READ' | 'EXPORT' | undefined
    if (c.takeWords('WITH', 'READ', 'LOCK')) lock = 'READ'
    else if (tables.length > 0 && c.takeWords('FOR', 'EXPORT')) lock = 'EXPORT'
    return { kind: STATEMENT.FLUSH, ...flag('noWriteToBinlog', noWriteToBinlog), tables, ...opt('lock', lock), at }
  }
  const options: FlushOption[] = []
  do {
    const words = FLUSH_OPTIONS.find((w) => c.atWords(...w))
    if (words === undefined) c.fail()
    c.takeWords(...words)
    const option = words.join(' ')
    const channel = option === 'RELAY LOGS' && c.takeWords('FOR', 'CHANNEL') ? stringLiteral(c) : undefined
    options.push({ option, ...opt('channel', channel) })
  } while (c.takeOp(','))
  return { kind: STATEMENT.FLUSH, ...flag('noWriteToBinlog', noWriteToBinlog), options, at }
}

// --- TRUNCATE, LOCK, RENAME TABLE, RESET -------------------------------------------

export function parseTruncate(c: Cursor): TruncateNode {
  const at = c.peek().start
  c.expectWord('TRUNCATE')
  c.takeWord('TABLE')
  return { kind: STATEMENT.TRUNCATE, table: c.expectTableName(), at }
}

/** `LOCK TABLES …` or `LOCK INSTANCE FOR BACKUP`. */
export function parseLock(c: Cursor): LockTablesNode | UnlockTablesNode {
  const at = c.peek().start
  c.expectWord('LOCK')
  if (c.takeWord('INSTANCE')) {
    c.expectWord('FOR')
    c.expectWord('BACKUP')
    return { kind: STATEMENT.LOCK_INSTANCE, at }
  }
  if (!c.takeWord('TABLE')) c.expectWord('TABLES')
  const tables: LockedTable[] = []
  do {
    const table = c.expectTableName()
    let alias: string | undefined
    if (c.takeWord('AS') || c.atIdentifier()) alias = c.expectIdentifier()
    let lock: LockedTable['lock']
    if (c.takeWord('READ')) lock = c.takeWord('LOCAL') ? 'READ LOCAL' : 'READ'
    else {
      c.expectWord('WRITE')
      lock = 'WRITE'
    }
    tables.push({ table, ...opt('alias', alias), lock })
  } while (c.takeOp(','))
  return { kind: STATEMENT.LOCK_TABLES, tables, at }
}

/** `UNLOCK TABLES` or `UNLOCK INSTANCE`. */
export function parseUnlock(c: Cursor): UnlockTablesNode {
  const at = c.peek().start
  c.expectWord('UNLOCK')
  if (c.takeWord('INSTANCE')) return { kind: STATEMENT.UNLOCK_INSTANCE, at }
  if (!c.takeWord('TABLE')) c.expectWord('TABLES')
  return { kind: STATEMENT.UNLOCK_TABLES, at }
}

/** `RENAME TABLE …` or `RENAME USER …`. */
export function parseRename(c: Cursor): RenameTableNode | RenameUserNode {
  const at = c.peek().start
  c.expectWord('RENAME')
  if (c.takeWord('USER')) {
    const pairs: { from: AccountOrCurrent; to: AccountOrCurrent }[] = []
    do {
      const from = accountOrCurrent(c)
      c.expectWord('TO')
      pairs.push({ from, to: accountOrCurrent(c) })
    } while (c.takeOp(','))
    return { kind: STATEMENT.RENAME_USER, pairs, at }
  }
  if (!c.takeWord('TABLE')) c.expectWord('TABLES')
  const pairs: { from: TableName; to: TableName }[] = []
  do {
    const from = c.expectTableName()
    c.expectWord('TO')
    pairs.push({ from, to: c.expectTableName() })
  } while (c.takeOp(','))
  return { kind: STATEMENT.RENAME_TABLE, pairs, at }
}

export function parseReset(c: Cursor): ResetNode {
  const at = c.peek().start
  c.expectWord('RESET')
  if (c.takeWord('PERSIST')) {
    if (c.takeWords('IF', 'EXISTS')) return { kind: STATEMENT.RESET, persist: true, ifExists: true, name: persistName(c), at }
    return { kind: STATEMENT.RESET, persist: true, ...(c.atIdentifier() ? { name: persistName(c) } : {}), at }
  }
  const options: Extract<ResetNode, { options: unknown }>['options'][number][] = []
  do {
    if (c.takeWord('REPLICA')) {
      const all = c.takeWord('ALL')
      const channel = c.takeWords('FOR', 'CHANNEL') ? stringLiteral(c) : undefined
      options.push({ option: 'REPLICA', ...flag('all', all), ...opt('channel', channel) })
    } else {
      c.expectWord('BINARY')
      c.expectWord('LOGS')
      c.expectWord('AND')
      c.expectWord('GTIDS')
      const to = c.takeWord('TO') ? unsigned(c) : undefined
      options.push({ option: 'BINARY LOGS AND GTIDS', ...opt('to', to) })
    }
  } while (c.takeOp(','))
  return { kind: STATEMENT.RESET, options, at }
}

/** A persisted variable's name: `x`, or a component's `component.x`. */
function persistName(c: Cursor): string {
  let name = c.expectIdentifier()
  if (c.takeOp('.')) name += '.' + c.expectNamePart()
  return name
}

// --- LOAD DATA ---------------------------------------------------------------------

/** A delimiter: one string, hex or bit literal — never two strings run together. */
function delimiter(c: Cursor): LiteralNode {
  const t = c.peek()
  if (t.kind === TOKEN.STRING) {
    c.skip()
    return { kind: NODE.LITERAL, type: LITERAL.STRING, value: t.text, at: t.start }
  }
  if (t.kind === TOKEN.HEX) {
    c.skip()
    return { kind: NODE.LITERAL, type: LITERAL.HEX, value: hexBytes(t.text), at: t.start }
  }
  if (t.kind === TOKEN.BIT) {
    c.skip()
    return { kind: NODE.LITERAL, type: LITERAL.BIT, value: t.text === '' ? 0n : BigInt('0b' + t.text), at: t.start }
  }
  c.fail()
}

function fieldDelimiters(c: Cursor): LoadDelimiter[] {
  const out: LoadDelimiter[] = []
  for (;;) {
    let what: string
    if (c.takeWords('TERMINATED', 'BY')) what = 'TERMINATED'
    else if (c.takeWords('OPTIONALLY', 'ENCLOSED', 'BY')) what = 'OPTIONALLY ENCLOSED'
    else if (c.takeWords('ENCLOSED', 'BY')) what = 'ENCLOSED'
    else if (c.takeWords('ESCAPED', 'BY')) what = 'ESCAPED'
    else break
    out.push({ what, value: delimiter(c) })
  }
  if (out.length === 0) c.fail()
  return out
}

function lineDelimiters(c: Cursor): LoadDelimiter[] {
  const out: LoadDelimiter[] = []
  for (;;) {
    let what: string
    if (c.takeWords('TERMINATED', 'BY')) what = 'TERMINATED'
    else if (c.takeWords('STARTING', 'BY')) what = 'STARTING'
    else break
    out.push({ what, value: delimiter(c) })
  }
  if (out.length === 0) c.fail()
  return out
}

export function parseLoad(c: Cursor, mode: SqlMode): LoadDataNode {
  const at = c.peek().start
  c.expectWord('LOAD')
  let format: 'DATA' | 'XML' = 'DATA'
  if (c.takeWord('XML')) format = 'XML'
  else c.expectWord('DATA')
  const priority: LoadDataNode['priority'] = c.takeWord('LOW_PRIORITY') ? 'LOW_PRIORITY' : c.takeWord('CONCURRENT') ? 'CONCURRENT' : undefined
  const local = c.takeWord('LOCAL')
  c.takeWord('FROM')
  let source: LoadDataNode['source'] = 'S3'
  if (c.takeWord('INFILE')) source = 'INFILE'
  else if (c.takeWord('URL')) source = 'URL'
  else c.expectWord('S3')
  const file = stringLiteral(c)
  const count = c.takeWord('COUNT') ? unsigned(c) : undefined
  const inPrimaryKeyOrder = c.takeWords('IN', 'PRIMARY', 'KEY', 'ORDER')
  const duplicates: LoadDataNode['duplicates'] = c.takeWord('REPLACE') ? 'REPLACE' : c.takeWord('IGNORE') ? 'IGNORE' : undefined
  c.expectWord('INTO')
  c.expectWord('TABLE')
  const table = c.expectTableName()
  const partitions = c.takeWord('PARTITION') ? c.expectNameList() : undefined
  const charset = c.takeWords('CHARACTER', 'SET') || c.takeWord('CHARSET') ? charsetName(c) : undefined
  const rowsIdentifiedBy = c.takeWords('ROWS', 'IDENTIFIED', 'BY') ? stringLiteral(c) : undefined
  const fields = c.takeWord('FIELDS') || c.takeWord('COLUMNS') ? fieldDelimiters(c) : undefined
  const lines = c.takeWord('LINES') ? lineDelimiters(c) : undefined
  let ignoreLines: string | undefined
  if (c.takeWord('IGNORE')) {
    ignoreLines = unsigned(c)
    if (!c.takeWord('LINES')) c.expectWord('ROWS')
  }
  let columns: (ColumnNode | { variable: string })[] | undefined
  if (c.takeOp('(')) {
    columns = []
    if (!c.atOp(')')) {
      do {
        const t = c.peek()
        if (t.kind === TOKEN.VARIABLE) {
          if (t.text.startsWith('@@')) c.fail()
          c.skip()
          columns.push({ variable: t.text.slice(1) })
        } else columns.push(column(c))
      } while (c.takeOp(','))
    }
    c.expectOp(')')
  }
  const set = c.takeWord('SET') ? assignments(c, mode) : undefined
  let parallel: string | undefined
  if (c.takeWord('PARALLEL')) {
    c.expectOp('=')
    parallel = unsigned(c)
  }
  let memory: string | undefined
  if (c.takeWord('MEMORY')) {
    c.expectOp('=')
    // `100`, or a size the lexer reads as one identifier: `100M`, `1G`.
    const t = c.peek()
    if (t.kind === TOKEN.NUMBER && /^\d+$/.test(t.text)) memory = c.take().text
    else memory = c.expectIdentifier()
  }
  let algorithm: 'BULK' | undefined
  if (c.takeWord('ALGORITHM')) {
    c.expectOp('=')
    c.expectWord('BULK')
    algorithm = 'BULK'
  }
  return {
    kind: STATEMENT.LOAD_DATA,
    format,
    ...opt('priority', priority),
    ...flag('local', local),
    source,
    file,
    ...opt('count', count),
    ...flag('inPrimaryKeyOrder', inPrimaryKeyOrder),
    ...opt('duplicates', duplicates),
    table,
    ...opt('partitions', partitions),
    ...opt('charset', charset),
    ...opt('rowsIdentifiedBy', rowsIdentifiedBy),
    ...opt('fields', fields),
    ...opt('lines', lines),
    ...opt('ignoreLines', ignoreLines),
    ...opt('columns', columns),
    ...opt('set', set),
    ...opt('parallel', parallel),
    ...opt('memory', memory),
    ...opt('algorithm', algorithm),
    at,
  }
}

// --- GRANT and REVOKE ----------------------------------------------------------------

/**
 * The static privileges, longest spelling first so `CREATE TEMPORARY TABLES`
 * is not read as `CREATE` followed by garbage. Which of them take a column
 * list is the grammar's choice, not the manual's: `DELETE (a)` is a syntax
 * error and `REFERENCES (a)` is not.
 */
const STATIC_PRIVILEGES: readonly (readonly string[])[] = [
  ['CREATE', 'TEMPORARY', 'TABLES'],
  ['CREATE', 'ROUTINE'],
  ['CREATE', 'TABLESPACE'],
  ['CREATE', 'USER'],
  ['CREATE', 'VIEW'],
  ['CREATE', 'ROLE'],
  ['ALTER', 'ROUTINE'],
  ['DROP', 'ROLE'],
  ['GRANT', 'OPTION'],
  ['LOCK', 'TABLES'],
  ['REPLICATION', 'CLIENT'],
  ['REPLICATION', 'SLAVE'],
  ['SHOW', 'DATABASES'],
  ['SHOW', 'VIEW'],
  ['SELECT'],
  ['INSERT'],
  ['UPDATE'],
  ['DELETE'],
  ['REFERENCES'],
  ['USAGE'],
  ['INDEX'],
  ['ALTER'],
  ['CREATE'],
  ['DROP'],
  ['EXECUTE'],
  ['RELOAD'],
  ['SHUTDOWN'],
  ['PROCESS'],
  ['FILE'],
  ['SUPER'],
  ['EVENT'],
  ['TRIGGER'],
]

const WITH_COLUMNS = new Set(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'])

/** `GRANT`'s and `REVOKE`'s list: `ALL [PRIVILEGES]` alone, or privileges and names. */
function privileges(c: Cursor): Privilege[] {
  if (c.takeWord('ALL')) {
    c.takeWord('PRIVILEGES')
    return [{ privilege: 'ALL' }]
  }
  const out: Privilege[] = []
  do {
    const words = STATIC_PRIVILEGES.find((w) => c.atWords(...w))
    if (words !== undefined) {
      c.takeWords(...words)
      const privilege = words.join(' ')
      const columns = WITH_COLUMNS.has(privilege) && c.atOp('(') ? c.expectNameList() : undefined
      out.push({ privilege, ...opt('columns', columns) })
    } else {
      const { user, host } = account(c, true)
      out.push({ name: user, ...opt('host', host) })
    }
  } while (c.takeOp(','))
  return out
}

function objectType(c: Cursor): 'TABLE' | 'FUNCTION' | 'PROCEDURE' | undefined {
  if (c.takeWord('TABLE')) return 'TABLE'
  if (c.takeWord('FUNCTION')) return 'FUNCTION'
  if (c.takeWord('PROCEDURE')) return 'PROCEDURE'
  return undefined
}

/** `*`, `*.*`, `db.*`, `db.t`, `t`. A quoted `` `*` `` is a name. */
function privilegeLevel(c: Cursor): PrivilegeLevel {
  if (c.takeOp('*')) {
    if (!c.takeOp('.')) return { level: 'default' }
    c.expectOp('*')
    return { level: 'global' }
  }
  const first = c.expectIdentifier()
  if (!c.takeOp('.')) return { level: 'object', name: { name: first } }
  if (c.takeOp('*')) return { level: 'schema', schema: first }
  return { level: 'object', name: { schema: first, name: c.expectNamePart() } }
}

/** A routine has no columns: `SELECT (a) ON PROCEDURE p` is ER_PARSE_ERROR on 8.4.11. */
function routineColumns(c: Cursor, type: string | undefined, items: readonly Privilege[]): void {
  if ((type === 'FUNCTION' || type === 'PROCEDURE') && items.some((p) => 'columns' in p)) c.fail()
}

/** True if every item may name a role: none is a static privilege, none has a column list. */
const allNames = (items: readonly Privilege[]): items is readonly { name: string; host?: string }[] => items.every((p) => 'name' in p)

const asRole = (p: { name: string; host?: string }): Account => ({ user: p.name, ...opt('host', p.host) })

export function parseGrant(c: Cursor): GrantNode {
  const at = c.peek().start
  c.expectWord('GRANT')
  if (c.takeWord('PROXY')) {
    c.expectWord('ON')
    const proxy = accountOrCurrent(c)
    c.expectWord('TO')
    const to = accounts(c)
    const withGrantOption = c.takeWords('WITH', 'GRANT', 'OPTION')
    return { kind: STATEMENT.GRANT, proxy, to, ...flag('withGrantOption', withGrantOption), at }
  }
  const items = privileges(c)
  if (!c.takeWord('ON')) {
    if (!allNames(items)) c.fail()
    c.expectWord('TO')
    const to = accounts(c)
    const withAdminOption = c.takeWords('WITH', 'ADMIN', 'OPTION')
    return { kind: STATEMENT.GRANT, roles: items.map(asRole), to, ...flag('withAdminOption', withAdminOption), at }
  }
  const type = objectType(c)
  routineColumns(c, type, items)
  const on = privilegeLevel(c)
  c.expectWord('TO')
  const to = accounts(c)
  const withGrantOption = c.takeWords('WITH', 'GRANT', 'OPTION')
  let as: AccountOrCurrent | undefined
  let withRole: RoleSpec | undefined
  if (c.takeWord('AS')) {
    as = accountOrCurrent(c)
    if (c.takeWords('WITH', 'ROLE')) withRole = roleSpec(c, true, true)
  }
  return {
    kind: STATEMENT.GRANT,
    privileges: items,
    ...opt('objectType', type),
    on,
    to,
    ...flag('withGrantOption', withGrantOption),
    ...opt('as', as),
    ...opt('withRole', withRole),
    at,
  }
}

export function parseRevoke(c: Cursor): RevokeNode {
  const at = c.peek().start
  c.expectWord('REVOKE')
  const ifExists = c.takeWords('IF', 'EXISTS')
  const tail = (): { from: AccountOrCurrent[]; ignoreUnknownUser?: true } => {
    c.expectWord('FROM')
    const from = accounts(c)
    return { from, ...flag('ignoreUnknownUser', c.takeWords('IGNORE', 'UNKNOWN', 'USER')) }
  }
  const head = { kind: STATEMENT.REVOKE, ...flag('ifExists', ifExists) }
  if (c.takeWord('PROXY')) {
    c.expectWord('ON')
    const proxy = accountOrCurrent(c)
    return { ...head, proxy, ...tail(), at }
  }
  // `ALL [PRIVILEGES], GRANT OPTION FROM …` revokes everything everywhere;
  // `ALL [PRIVILEGES] ON …` is an ordinary privilege list.
  if (c.atWord('ALL') && (c.atOp(',', 1) || (c.atWord('PRIVILEGES', 1) && c.atOp(',', 2)))) {
    c.takeWord('ALL')
    c.takeWord('PRIVILEGES')
    c.expectOp(',')
    c.expectWord('GRANT')
    c.expectWord('OPTION')
    return { ...head, all: true, ...tail(), at }
  }
  const items = privileges(c)
  if (!c.takeWord('ON')) {
    if (!allNames(items)) c.fail()
    return { ...head, roles: items.map(asRole), ...tail(), at }
  }
  const type = objectType(c)
  routineColumns(c, type, items)
  const on = privilegeLevel(c)
  return { ...head, privileges: items, ...opt('objectType', type), on, ...tail(), at }
}

// --- accounts and roles ----------------------------------------------------------------

/** `IDENTIFIED BY …` or `IDENTIFIED WITH plugin [BY … | AS 'hash']`, after `IDENTIFIED`. */
function identification(c: Cursor): Identification {
  if (c.takeWord('BY')) return byPassword(c)
  c.expectWord('WITH')
  const t = c.peek()
  if (t.kind !== TOKEN.STRING && t.kind !== TOKEN.IDENTIFIER) c.fail()
  const plugin = c.take().text
  if (c.takeWord('BY')) return { plugin, ...byPassword(c) }
  if (c.takeWord('AS')) return { plugin, hash: stringLiteral(c) }
  return { plugin }
}

function byPassword(c: Cursor): Identification {
  if (c.takeWords('RANDOM', 'PASSWORD')) return { random: true }
  return { password: stringLiteral(c) }
}

/** One user of a `CREATE USER` (`create`) or an `ALTER USER`. */
function userSpec(c: Cursor, create: boolean): UserSpec {
  const who = accountOrCurrent(c)
  if (!create && c.takeWords('DISCARD', 'OLD', 'PASSWORD')) return { account: who, discardOldPassword: true }
  if (!c.takeWord('IDENTIFIED')) return { account: who }
  const auth = [identification(c)]
  if (create) {
    while (c.takeWords('AND', 'IDENTIFIED')) auth.push(identification(c))
    return { account: who, auth }
  }
  const replace = c.takeWord('REPLACE') ? stringLiteral(c) : undefined
  const retain = c.takeWords('RETAIN', 'CURRENT', 'PASSWORD')
  return { account: who, auth, ...opt('replace', replace), ...flag('retainCurrentPassword', retain) }
}

const RESOURCES = new Set(['MAX_QUERIES_PER_HOUR', 'MAX_UPDATES_PER_HOUR', 'MAX_CONNECTIONS_PER_HOUR', 'MAX_USER_CONNECTIONS'])

/** One password or lock option, as its words in upper case, or `undefined` if none is here. */
function passwordOption(c: Cursor): string | undefined {
  if (c.takeWords('ACCOUNT', 'LOCK')) return 'ACCOUNT LOCK'
  if (c.takeWords('ACCOUNT', 'UNLOCK')) return 'ACCOUNT UNLOCK'
  if (c.takeWord('FAILED_LOGIN_ATTEMPTS')) return `FAILED_LOGIN_ATTEMPTS ${unsigned(c, true)}`
  if (c.takeWord('PASSWORD_LOCK_TIME')) return `PASSWORD_LOCK_TIME ${c.takeWord('UNBOUNDED') ? 'UNBOUNDED' : unsigned(c, true)}`
  if (c.takeWords('PASSWORD', 'EXPIRE')) {
    if (c.takeWord('DEFAULT')) return 'PASSWORD EXPIRE DEFAULT'
    if (c.takeWord('NEVER')) return 'PASSWORD EXPIRE NEVER'
    if (c.takeWord('INTERVAL')) {
      const n = unsigned(c, true)
      c.expectWord('DAY')
      return `PASSWORD EXPIRE INTERVAL ${n} DAY`
    }
    return 'PASSWORD EXPIRE'
  }
  if (c.takeWords('PASSWORD', 'HISTORY')) return `PASSWORD HISTORY ${c.takeWord('DEFAULT') ? 'DEFAULT' : unsigned(c, true)}`
  if (c.takeWords('PASSWORD', 'REUSE', 'INTERVAL')) {
    if (c.takeWord('DEFAULT')) return 'PASSWORD REUSE INTERVAL DEFAULT'
    const n = unsigned(c, true)
    c.expectWord('DAY')
    return `PASSWORD REUSE INTERVAL ${n} DAY`
  }
  if (c.takeWords('PASSWORD', 'REQUIRE', 'CURRENT')) {
    if (c.takeWord('DEFAULT')) return 'PASSWORD REQUIRE CURRENT DEFAULT'
    if (c.takeWord('OPTIONAL')) return 'PASSWORD REQUIRE CURRENT OPTIONAL'
    return 'PASSWORD REQUIRE CURRENT'
  }
  return undefined
}

/** `REQUIRE …`, `WITH …`, password and lock options, then `COMMENT` or `ATTRIBUTE`. */
function accountOptions(c: Cursor): AccountOptions {
  let require: AccountOptions['require']
  if (c.takeWord('REQUIRE')) {
    if (c.takeWord('NONE')) require = 'NONE'
    else if (c.takeWord('SSL')) require = 'SSL'
    else if (c.takeWord('X509')) require = 'X509'
    else {
      const items: { what: 'ISSUER' | 'SUBJECT' | 'CIPHER'; value: string }[] = []
      do {
        let what: 'ISSUER' | 'SUBJECT' | 'CIPHER' = 'CIPHER'
        if (c.takeWord('ISSUER')) what = 'ISSUER'
        else if (c.takeWord('SUBJECT')) what = 'SUBJECT'
        else c.expectWord('CIPHER')
        items.push({ what, value: stringLiteral(c) })
      } while (c.atWord('ISSUER') || c.atWord('SUBJECT') || c.atWord('CIPHER') || (c.atWord('AND') && c.takeWord('AND')))
      require = items
    }
  }
  let resources: { name: string; value: string }[] | undefined
  if (c.takeWord('WITH')) {
    resources = []
    do {
      const t = c.peek()
      const name = t.text.toUpperCase()
      if (t.kind !== TOKEN.IDENTIFIER || t.quoted === true || !RESOURCES.has(name)) c.fail()
      c.skip()
      resources.push({ name, value: unsigned(c, true) })
    } while (RESOURCES.has(c.peek().text.toUpperCase()) && c.peek().kind === TOKEN.IDENTIFIER && c.peek().quoted !== true)
  }
  const passwordOptions: string[] = []
  for (let o = passwordOption(c); o !== undefined; o = passwordOption(c)) passwordOptions.push(o)
  const comment = c.takeWord('COMMENT') ? stringLiteral(c) : undefined
  const attribute = comment === undefined && c.takeWord('ATTRIBUTE') ? stringLiteral(c) : undefined
  return {
    ...opt('require', require),
    ...opt('resources', resources),
    ...(passwordOptions.length > 0 ? { passwordOptions } : {}),
    ...opt('comment', comment),
    ...opt('attribute', attribute),
  }
}

/** `CREATE USER …`, with the cursor on `CREATE`. */
export function parseCreateUser(c: Cursor): CreateUserNode {
  const at = c.peek().start
  c.expectWord('CREATE')
  c.expectWord('USER')
  const ifNotExists = c.takeWords('IF', 'NOT', 'EXISTS')
  const users = [userSpec(c, true)]
  while (c.takeOp(',')) users.push(userSpec(c, true))
  const defaultRoles = c.takeWords('DEFAULT', 'ROLE') ? roles(c) : undefined
  return { kind: STATEMENT.CREATE_USER, ...flag('ifNotExists', ifNotExists), users, ...opt('defaultRoles', defaultRoles), ...accountOptions(c), at }
}

/** `ALTER USER …`, with the cursor on `ALTER`. */
export function parseAlterUser(c: Cursor): AlterUserNode {
  const at = c.peek().start
  c.expectWord('ALTER')
  c.expectWord('USER')
  const ifExists = c.takeWords('IF', 'EXISTS')
  const head = { kind: STATEMENT.ALTER_USER, ...flag('ifExists', ifExists) }
  // `ALTER USER USER() IDENTIFIED BY …`: the session's own account, and only
  // a password change.
  if (c.atWord('USER') && c.atOp('(', 1) && c.atOp(')', 2)) {
    c.at += 3
    if (c.takeWords('DISCARD', 'OLD', 'PASSWORD')) return { ...head, self: { account: 'CURRENT_USER', discardOldPassword: true }, at }
    c.expectWord('IDENTIFIED')
    c.expectWord('BY')
    const password = byPassword(c)
    const replace = c.takeWord('REPLACE') ? stringLiteral(c) : undefined
    const retain = c.takeWords('RETAIN', 'CURRENT', 'PASSWORD')
    return {
      ...head,
      self: { account: 'CURRENT_USER', auth: [password], ...opt('replace', replace), ...flag('retainCurrentPassword', retain) },
      at,
    }
  }
  const first = userSpec(c, false)
  if (first.auth === undefined && first.discardOldPassword !== true && c.takeWords('DEFAULT', 'ROLE')) {
    return { ...head, user: first.account, defaultRole: roleSpec(c, false, false), at }
  }
  const users = [first]
  while (c.takeOp(',')) users.push(userSpec(c, false))
  return { ...head, users, ...accountOptions(c), at }
}

/** `DROP USER …` or `DROP ROLE …`, with the cursor on `DROP`. */
export function parseDropUser(c: Cursor): DropUserNode {
  const at = c.peek().start
  c.expectWord('DROP')
  const role = c.takeWord('ROLE')
  if (!role) c.expectWord('USER')
  const kind = role ? STATEMENT.DROP_ROLE : STATEMENT.DROP_USER
  const ifExists = c.takeWords('IF', 'EXISTS')
  return { kind, ...flag('ifExists', ifExists), users: role ? roles(c) : accounts(c), at }
}

/** `CREATE ROLE …`, with the cursor on `CREATE`. */
export function parseCreateRole(c: Cursor): CreateRoleNode {
  const at = c.peek().start
  c.expectWord('CREATE')
  c.expectWord('ROLE')
  const ifNotExists = c.takeWords('IF', 'NOT', 'EXISTS')
  return { kind: STATEMENT.CREATE_ROLE, ...flag('ifNotExists', ifNotExists), roles: roles(c), at }
}

/** `SET PASSWORD …`, with the cursor on `PASSWORD`. */
export function parseSetPassword(c: Cursor, at: number): SetPasswordNode {
  c.expectWord('PASSWORD')
  const who = c.takeWord('FOR') ? accountOrCurrent(c) : undefined
  let password: string | undefined
  if (c.takeWord('TO')) c.expectWord('RANDOM')
  else {
    c.expectOp('=')
    password = stringLiteral(c)
  }
  const replace = c.takeWord('REPLACE') ? stringLiteral(c) : undefined
  const retain = c.takeWords('RETAIN', 'CURRENT', 'PASSWORD')
  return {
    kind: STATEMENT.SET_PASSWORD,
    ...opt('for', who),
    ...opt('password', password),
    ...opt('replace', replace),
    ...flag('retainCurrentPassword', retain),
    at,
  }
}

/** `SET ROLE …`, with the cursor on `ROLE`. */
export function parseSetRole(c: Cursor, at: number): SetRoleNode {
  c.expectWord('ROLE')
  return { kind: STATEMENT.SET_ROLE, role: roleSpec(c, true, true), at }
}

/** `SET DEFAULT ROLE … TO …`, with the cursor on `DEFAULT`. */
export function parseSetDefaultRole(c: Cursor, at: number): SetDefaultRoleNode {
  c.expectWord('DEFAULT')
  c.expectWord('ROLE')
  const role = roleSpec(c, false, false)
  c.expectWord('TO')
  return { kind: STATEMENT.SET_DEFAULT_ROLE, role, to: accounts(c), at }
}
