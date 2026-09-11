// M3.5 — one statement in, one AST out.
//
// The dispatcher is deliberately thin and deliberately **honest about its
// gaps**. M3.3, M3.4 and M3.6 are not built, so `SELECT`, `INSERT` and `SET`
// reach `unsupportedStatement` rather than a half-parse — which matters more
// than it sounds, because M3.11's census counts what this function accepts. A
// dispatcher that returned some vague node for anything it did not understand
// would report a parse rate measuring nothing, and M3's exit criterion is
// exactly such a rate.
//
// `ER_NOT_SUPPORTED_YET` is also the right answer on the wire: a client that
// sends `SELECT 1` today should be told this server cannot do that yet, not
// that its SQL is malformed.
import { unsupportedStatement } from './errors.ts'
import { Cursor } from './cursor.ts'
import { TOKEN } from './tokens.ts'
import { lex, lexBytes, type LexOptions } from './lexer.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'
import { parseCreateTable, parseDrop } from './ddl.ts'
import { STATEMENT, type Statement } from './statement-ast.ts'

export interface ParseStatementOptions extends LexOptions {
  readonly sqlMode?: SqlMode
}

/** Parse one statement from SQL text. */
export function parseStatement(sql: string, options: ParseStatementOptions = {}): Statement {
  return parseFromTokens(new Cursor(lex(sql, options)), options.sqlMode ?? NO_SQL_MODE)
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
  return parseFromTokens(new Cursor(lexBytes(bytes, options)), options.sqlMode ?? NO_SQL_MODE)
}

function parseFromTokens(c: Cursor, sqlMode: SqlMode): Statement {
  const first = c.peek()
  if (first.kind === TOKEN.EOF) c.fail()

  const statement = dispatch(c, sqlMode)

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
    throw unsupportedStatement(`CREATE ${kind}`)
  }

  if (c.atWord('DROP')) {
    const save = c.at
    c.skip()
    c.takeWord('TEMPORARY')
    const known =
      c.atWord('TABLE') || c.atWord('VIEW') || c.atWord('INDEX') || c.atWord('DATABASE') || c.atWord('SCHEMA')
    const object = c.peek().text.toUpperCase()
    c.at = save
    if (known) return parseDrop(c)
    throw unsupportedStatement(`DROP ${object}`)
  }

  throw unsupportedStatement(first(c))
}

/**
 * What a `CREATE` is creating, without consuming anything.
 *
 * `CREATE` may carry `OR REPLACE`, `TEMPORARY`, `DEFINER = …` and `ALGORITHM =
 * …` before the object it names, so the object word is not simply the second
 * token — `CREATE DEFINER = 'a'@'b' VIEW v` names a view four tokens in.
 */
function createObject(c: Cursor): string {
  const save = c.at
  c.skip()
  for (;;) {
    if (c.takeWords('OR', 'REPLACE')) continue
    if (c.takeWord('TEMPORARY')) continue
    if (c.takeWord('DEFINER') || c.takeWord('ALGORITHM') || c.takeWord('SQL')) {
      // Skip to the next word that could be the object: these clauses take a
      // value whose shape varies (`'a'@'b'`, `= MERGE`, `SECURITY DEFINER`).
      while (!c.atEnd() && c.peek().kind !== TOKEN.IDENTIFIER) c.skip()
      while (!c.atEnd() && isClauseValue(c)) c.skip()
      continue
    }
    break
  }
  const word = c.peek().kind === TOKEN.IDENTIFIER ? c.peek().text.toUpperCase() : c.peek().text
  c.at = save
  return word
}

/** Words that are part of a `DEFINER`/`ALGORITHM`/`SQL SECURITY` clause's value. */
const CLAUSE_VALUES = new Set(['UNDEFINED', 'MERGE', 'TEMPTABLE', 'SECURITY', 'DEFINER', 'INVOKER', 'CURRENT_USER'])
const isClauseValue = (c: Cursor): boolean =>
  c.peek().kind === TOKEN.IDENTIFIER && CLAUSE_VALUES.has(c.peek().text.toUpperCase())

/** The leading word of the statement, for a refusal that names it. */
function first(c: Cursor): string {
  const t = c.peek()
  return t.kind === TOKEN.IDENTIFIER ? t.text.toUpperCase() : t.text
}

export { STATEMENT }
