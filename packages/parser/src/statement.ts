// M3.5 — one statement in, one AST out.
//
// The dispatcher is deliberately thin and deliberately **honest about its
// gaps**. What is not built yet — `ALTER VIEW`, `CACHE INDEX` and the rest —
// reaches `unsupportedStatement` rather than a half-parse — which matters more
// than it sounds, because M3.11's census counts what this function accepts. A
// dispatcher that returned some vague node for anything it did not understand
// would report a parse rate measuring nothing, and M3's exit criterion is
// exactly such a rate.
//
// `ER_NOT_SUPPORTED_YET` is also the right answer on the wire: a client that
// sends `SHOW TABLES` today should be told this server cannot do that yet, not
// that its SQL is malformed.
import { unsupportedStatement } from './errors.ts'
import { Cursor, checkTreeDepth } from './cursor.ts'
import { TOKEN } from './tokens.ts'
import { decodeStatement, lex, type LexOptions } from './lexer.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'
import { parseCreateDatabase, parseCreateTable, parseCreateView, parseDefiner, parseDrop } from './ddl.ts'
import { parseAlterTable, parseCreateIndex } from './alter.ts'
import { parseCall, parseCreateEvent, parseCreateRoutine, parseCreateTrigger } from './routine.ts'
import {
  atExplainable,
  parseCommit,
  parseDeallocate,
  parseDo,
  parseExecute,
  parseExplain,
  parseExplainable,
  parsePrepare,
  parseRollback,
  parseSavepoint,
  parseSet,
  parseShow,
  parseStartTransaction,
  parseUse,
} from './utility.ts'
import { STATEMENT, type Statement } from './statement-ast.ts'
import {
  atTableMaintenance,
  parseAlterUser,
  parseCreateRole,
  parseCreateUser,
  parseDropUser,
  parseFlush,
  parseGrant,
  parseLoad,
  parseLock,
  parseRename,
  parseReset,
  parseRevoke,
  parseTableMaintenance,
  parseTruncate,
  parseUnlock,
} from './admin.ts'

export interface ParseStatementOptions extends LexOptions {
  readonly sqlMode?: SqlMode
}

/** Parse one statement from SQL text. */
export function parseStatement(sql: string, options: ParseStatementOptions = {}): Statement {
  return parseFromTokens(new Cursor(lex(sql, options), sql), options.sqlMode ?? NO_SQL_MODE)
}

/**
 * Parse one statement from its bytes, in the session's charset.
 *
 * The entry point a `COM_QUERY` should use: D-38 made the protocol carry the
 * statement's bytes rather than a UTF-8 guess, and this is the other end of
 * that. Decoding here rather than at the packet boundary is what makes M3.1's
 * charset-aware lexing reachable at all.
 */
export function parseStatementBytes(bytes: Uint8Array, options: ParseStatementOptions = {}): Statement {
  const sql = decodeStatement(bytes, options.collationId ?? 255)
  return parseFromTokens(new Cursor(lex(sql, options), sql), options.sqlMode ?? NO_SQL_MODE)
}

/**
 * Parse every statement in a multi-statement text: `SELECT 1; SELECT 2`.
 *
 * The boundaries come from the parser, not from splitting on `;`, because a
 * stored program's body is full of `;`s that end nothing. This is how a server
 * reads a `COM_QUERY` under `CLIENT_MULTI_STATEMENTS`, which D-13 keeps off by
 * default, and how mysqltest's `delimiter` blocks are sent.
 */
export function parseStatements(sql: string, options: ParseStatementOptions = {}): Statement[] {
  const c = new Cursor(lex(sql, options), sql)
  const sqlMode = options.sqlMode ?? NO_SQL_MODE
  const out = [checked(c, sqlMode)]
  while (c.takeOp(';') && !c.atEnd()) out.push(checked(c, sqlMode))
  if (!c.atEnd()) c.fail()
  return out
}

/** One statement, refused if there is none or if it nests too deep. */
function checked(c: Cursor, sqlMode: SqlMode): Statement {
  if (c.atEnd()) c.fail()
  const statement = dispatch(c, sqlMode)
  checkTreeDepth(statement)
  return statement
}

function parseFromTokens(c: Cursor, sqlMode: SqlMode): Statement {
  const statement = checked(c, sqlMode)

  // A trailing `;` is part of the statement as clients send it. Anything after
  // one is a second statement, and D-13 gates multi-statement execution off
  // precisely because it "turns a SQL-injection point into arbitrary statement
  // execution" — so the leftover is refused here rather than ignored.
  c.takeOp(';')
  if (!c.atEnd()) c.fail()
  return statement
}

function dispatch(c: Cursor, sqlMode: SqlMode): Statement {
  const options = { sqlMode }

  if (c.atWord('CREATE')) {
    // `CREATE` introduces a dozen different objects. Only tables are M3.5's;
    // the rest name themselves in the word after `CREATE` (or after
    // `TEMPORARY`, `OR REPLACE` and friends), so the refusal can say which.
    const kind = createObject(c)
    if (kind === 'TABLE') return parseCreateTable(c, options)
    if (kind === 'VIEW') return parseCreateView(c, options)
    if (kind === 'INDEX' || kind === 'UNIQUE' || kind === 'FULLTEXT' || kind === 'SPATIAL') return parseCreateIndex(c, options)
    if (kind === 'DATABASE' || kind === 'SCHEMA') return parseCreateDatabase(c)
    const statement = (inner: Cursor) => dispatch(inner, sqlMode)
    if (kind === 'PROCEDURE' || kind === 'FUNCTION') return parseCreateRoutine(c, sqlMode, kind, statement)
    if (kind === 'TRIGGER') return parseCreateTrigger(c, sqlMode, statement)
    if (kind === 'EVENT') return parseCreateEvent(c, sqlMode, statement)
    if (kind === 'USER') return parseCreateUser(c)
    if (kind === 'ROLE') return parseCreateRole(c)
    throw unsupportedStatement(`CREATE ${kind}`)
  }
  if (c.atWords('ALTER', 'TABLE')) return parseAlterTable(c, options)
  if (c.atWords('ALTER', 'USER')) return parseAlterUser(c)

  // A query, `INSERT`, `REPLACE`, `UPDATE`, `DELETE`, and `WITH` opening any
  // of the last three or a query — the statements `EXPLAIN` can explain.
  if (atExplainable(c)) return parseExplainable(c, sqlMode)

  // M3.6.
  if (c.atWord('SET')) return parseSet(c, sqlMode)
  if (c.atWord('USE')) return parseUse(c)
  if (c.atWord('SHOW')) return parseShow(c, sqlMode)
  if (c.atWord('EXPLAIN') || c.atWord('DESCRIBE') || c.atWord('DESC')) return parseExplain(c, sqlMode)
  if (c.atWord('BEGIN') || c.atWords('START', 'TRANSACTION')) return parseStartTransaction(c)
  if (c.atWord('COMMIT')) return parseCommit(c)
  if (c.atWord('ROLLBACK')) return parseRollback(c)
  // `RELEASE` begins nothing else, so `RELEASE sp` is a syntax error, as on 8.4.11.
  if (c.atWord('SAVEPOINT') || c.atWord('RELEASE')) return parseSavepoint(c)
  if (c.atWord('PREPARE')) return parsePrepare(c)
  if (c.atWord('EXECUTE')) return parseExecute(c)
  if (c.atWord('DEALLOCATE') || c.atWords('DROP', 'PREPARE')) return parseDeallocate(c)
  if (c.atWord('DO')) return parseDo(c, sqlMode)
  if (c.atWord('CALL')) return parseCall(c, sqlMode)

  // M3.17.
  if (atTableMaintenance(c)) return parseTableMaintenance(c)
  if (c.atWord('FLUSH')) return parseFlush(c)
  if (c.atWord('TRUNCATE')) return parseTruncate(c)
  if (c.atWord('LOCK')) return parseLock(c)
  if (c.atWord('UNLOCK')) return parseUnlock(c)
  if (c.atWord('RENAME')) return parseRename(c)
  if (c.atWords('LOAD', 'DATA') || c.atWords('LOAD', 'XML')) return parseLoad(c, sqlMode)
  if (c.atWord('GRANT')) return parseGrant(c)
  if (c.atWord('REVOKE')) return parseRevoke(c)
  if (c.atWord('RESET')) return parseReset(c)
  if (c.atWords('DROP', 'USER') || c.atWords('DROP', 'ROLE')) return parseDropUser(c)

  if (c.atWord('DROP')) {
    const save = c.at
    c.skip()
    c.takeWord('TEMPORARY')
    const known =
      c.atWord('TABLE') ||
      c.atWord('TABLES') ||
      c.atWord('VIEW') ||
      c.atWord('INDEX') ||
      c.atWord('DATABASE') ||
      c.atWord('SCHEMA') ||
      c.atWord('PROCEDURE') ||
      c.atWord('FUNCTION') ||
      c.atWord('TRIGGER') ||
      c.atWord('EVENT')
    const object = c.peek().text.toUpperCase()
    c.at = save
    if (known) return parseDrop(c)
    throw unsupportedStatement(`DROP ${object}`)
  }

  // A word that begins no statement in MySQL's grammar is a syntax error
  // there (8.4.11: `SELEC` is 1064, near 'SELEC'); one that begins a
  // statement this parser does not build yet is refused as such.
  if (!STATEMENT_WORDS.has(first(c))) c.fail()
  throw unsupportedStatement(first(c))
}

/** The words a statement can begin with: `simple_statement`'s alternatives in `sql_yacc.yy`, and BEGIN. */
const STATEMENT_WORDS = new Set([
  'ALTER', 'ANALYZE', 'BEGIN', 'BINLOG', 'CACHE', 'CALL', 'CHANGE', 'CHECK', 'CHECKSUM', 'CLONE', 'COMMIT', 'CREATE',
  'DEALLOCATE', 'DELETE', 'DESC', 'DESCRIBE', 'DO', 'DROP', 'EXECUTE', 'EXPLAIN', 'FLUSH', 'GET', 'GRANT', 'HANDLER',
  'HELP', 'IMPORT', 'INSERT', 'INSTALL', 'KILL', 'LOAD', 'LOCK', 'OPTIMIZE', 'PREPARE', 'PURGE', 'RELEASE', 'RENAME',
  'REPAIR', 'REPLACE', 'RESET', 'RESIGNAL', 'RESTART', 'REVOKE', 'ROLLBACK', 'SAVEPOINT', 'SELECT', 'SET', 'SHOW',
  'SHUTDOWN', 'SIGNAL', 'START', 'STOP', 'TABLE', 'TRUNCATE', 'UNINSTALL', 'UNLOCK', 'UPDATE', 'USE', 'VALUES', 'WITH',
  'XA', '(',
])

/**
 * What a `CREATE` is creating, without consuming anything.
 *
 * `CREATE` may carry `OR REPLACE`, `TEMPORARY`, `ALGORITHM = …`, `DEFINER = …`
 * and `SQL SECURITY …` before the object it names, so the object word is not
 * simply the second token — `CREATE DEFINER = 'a'@'b' VIEW v` names a view
 * four tokens in. Each clause is read by its own grammar rather than skipped by
 * a token-class heuristic: the first version skipped "words that look like a
 * clause value", and `DEFINER` is one, so `ALGORITHM = MERGE DEFINER = …` lost
 * its place at the `=`.
 */
function createObject(c: Cursor): string {
  const save = c.at
  c.skip()
  try {
    for (;;) {
      if (c.takeWords('OR', 'REPLACE') || c.takeWord('TEMPORARY')) continue
      if (c.takeWord('ALGORITHM')) {
        c.takeOp('=')
        c.skip()
        continue
      }
      if (c.takeWord('DEFINER')) {
        parseDefiner(c)
        continue
      }
      if (c.takeWords('SQL', 'SECURITY')) {
        c.skip()
        continue
      }
      break
    }
    return c.peek().kind === TOKEN.IDENTIFIER ? c.peek().text.toUpperCase() : c.peek().text
  } finally {
    c.at = save
  }
}

/** The leading word of the statement, for a refusal that names it. */
function first(c: Cursor): string {
  const t = c.peek()
  return t.kind === TOKEN.IDENTIFIER ? t.text.toUpperCase() : t.text
}

export { STATEMENT }
