// M3.5 — one statement in, one AST out.
//
// The dispatcher is deliberately thin and deliberately **honest about its
// gaps**. What is not built yet — `SET`, `SHOW`, `ALTER` and the rest —
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
import { lex, lexBytes, type LexOptions } from './lexer.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'
import { parseCreateTable, parseCreateView, parseDefiner, parseDrop } from './ddl.ts'
import { atParenthesisedQuery, atQueryStart, parseQueryFrom, parseWithFrom } from './query.ts'
import { parseDelete, parseInsert, parseUpdate } from './dml.ts'
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
  checkTreeDepth(statement)

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
    throw unsupportedStatement(`CREATE ${kind}`)
  }

  if (c.atWord('INSERT') || c.atWord('REPLACE')) return parseInsert(c, sqlMode)
  if (c.atWord('UPDATE')) return parseUpdate(c, sqlMode)
  if (c.atWord('DELETE')) return parseDelete(c, sqlMode)

  // `WITH` opens a query, an `UPDATE` or a `DELETE`.
  if (c.atWord('WITH')) {
    const at = c.peek().start
    const withClause = parseWithFrom(c, sqlMode)
    if (c.atWord('UPDATE')) return parseUpdate(c, sqlMode, withClause, at)
    if (c.atWord('DELETE')) return parseDelete(c, sqlMode, withClause, at)
    return parseQueryFrom(c, sqlMode, true, withClause, at)
  }

  // A query is a statement: `SELECT`, `VALUES ROW`, `TABLE t`, and any of
  // those in parentheses. The only place `INTO` is allowed.
  if (atQueryStart(c) || atParenthesisedQuery(c)) return parseQueryFrom(c, sqlMode, true)

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
