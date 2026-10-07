// M3.5 — `CREATE TABLE` and `DROP`.
//
// M3's exit criterion is "every `CREATE TABLE` in MySQL's own test suite
// parses", and M3.11's census is what measures it: 3,469 `CREATE` statements
// from `mysql-test/t`, lexed already and now parsed. That number is the point
// of building this before `SELECT` — the criterion lives here, and `CREATE`,
// `ALTER` and `DROP` together are 7,186 statements of the corpus against
// `SELECT`'s 6,523.
//
// The shape of the work is unusual for a parser: `CREATE TABLE`'s grammar is
// mostly a **bag of optional clauses in any order**, not a sequence. Column
// attributes, table options and index options are each an unordered set, and
// MySQL accepts them repeated. So the loops here read "take whichever of these
// applies, until none does" rather than stepping through a fixed order — and a
// clause this parser does not know is a parse error rather than something
// skipped, because skipping is how a `CREATE TABLE` silently loses a
// `CHARACTER SET` and produces a table that stores different bytes.
import { unsupportedStatement } from './errors.ts'
import type { Cursor } from './cursor.ts'
import { TOKEN } from './tokens.ts'
import { NODE, type Expression } from './ast.ts'
import { parseExpressionFrom } from './expression.ts'
import { parseDataType } from './data-type.ts'
import { atParenthesisedQuery, atQueryStart, parseQueryFrom } from './query.ts'
import type { QueryExpression } from './query-ast.ts'
import type { SqlMode } from './sql-mode.ts'
import {
  DROP_OBJECT,
  KEY,
  STATEMENT,
  type CheckConstraint,
  type ColumnDefinition,
  type CreateTableNode,
  type CreateViewNode,
  type Definer,
  type DropNode,
  type DropObject,
  type IndexColumn,
  type KeyDefinition,
  type KeyType,
  type Reference,
  type TableName,
} from './statement-ast.ts'

/**
 * Table options whose value is a bare word, a string or a number.
 *
 * Kept as one list because the parser's job is to record them, not to know what
 * they mean: `KEY_BLOCK_SIZE` is InnoDB's and `PACK_KEYS` is MyISAM's, and
 * which engine reads which is M4's problem. Two are exceptions and are read
 * rather than merely recorded — `CHARACTER SET` and `COLLATE` — because every
 * column without its own charset inherits the table's.
 */
const TABLE_OPTIONS = new Set([
  'ENGINE',
  'AUTO_INCREMENT',
  'AVG_ROW_LENGTH',
  'CHECKSUM',
  'COMMENT',
  'COMPRESSION',
  'CONNECTION',
  'DATA',
  'DELAY_KEY_WRITE',
  'ENCRYPTION',
  'INDEX',
  'INSERT_METHOD',
  'KEY_BLOCK_SIZE',
  'MAX_ROWS',
  'MIN_ROWS',
  'PACK_KEYS',
  'PASSWORD',
  'ROW_FORMAT',
  'STATS_AUTO_RECALC',
  'STATS_PERSISTENT',
  'STATS_SAMPLE_PAGES',
  'TABLESPACE',
  'UNION',
  'AUTOEXTEND_SIZE',
  // `SECONDARY_ENGINE` was missing while `SECONDARY_ENGINE_ATTRIBUTE` was
  // present — the shape of gap a name list gets when it is written from the
  // manual rather than measured. The corpus found it in `order_by_limit.test`
  // once the census could see the whole tree, and a local 8.4.11 accepts all
  // four spellings the generic path below already handles: a bare word, `=`
  // and a word, `NULL`, and a quoted string.
  'SECONDARY_ENGINE',
  'SECONDARY_ENGINE_ATTRIBUTE',
  'ENGINE_ATTRIBUTE',
  'START',
])

/** `ON DELETE` / `ON UPDATE` actions on a foreign key. */
const REFERENTIAL_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']

export interface DdlOptions {
  readonly sqlMode: SqlMode
}

/**
 * Parse a `CREATE TABLE`, with the cursor on `CREATE`.
 *
 * `CREATE TABLE ... [AS] SELECT` carries its query (M3.3). Until the query
 * parser existed these were refused rather than half-parsed, which is what
 * kept the census honest: one counted as parsed because its column list
 * happened to be empty would have inflated the exit criterion with statements
 * nothing understood.
 */
export function parseCreateTable(c: Cursor, options: DdlOptions): CreateTableNode {
  const at = c.peek().start
  c.expectWord('CREATE')
  const temporary = c.takeWord('TEMPORARY')
  c.expectWord('TABLE')
  const ifNotExists = c.takeWords('IF', 'NOT', 'EXISTS')
  const table = tableName(c)

  // `CREATE TABLE a LIKE b`, and its parenthesised spelling. No body follows.
  if (c.takeWord('LIKE')) {
    return { kind: STATEMENT.CREATE_TABLE, table, ...flag('temporary', temporary), ...flag('ifNotExists', ifNotExists), like: tableName(c), columns: [], keys: [], checks: [], options: {}, at }
  }
  if (c.atOp('(') && c.atWord('LIKE', 1)) {
    c.skip()
    c.skip()
    const like = tableName(c)
    c.expectOp(')')
    return { kind: STATEMENT.CREATE_TABLE, table, ...flag('temporary', temporary), ...flag('ifNotExists', ifNotExists), like, columns: [], keys: [], checks: [], options: {}, at }
  }

  const columns: ColumnDefinition[] = []
  const keys: KeyDefinition[] = []
  const checks: CheckConstraint[] = []

  // `CREATE TABLE t (SELECT …)` — the parenthesis is the query's, not a body's.
  if (!atParenthesisedQuery(c) && c.takeOp('(')) {
    do {
      // No `if (atOp(')')) break` here, and that absence is deliberate: an
      // earlier version allowed a trailing comma, and `create table t1 (a int,)`
      // carries `--error 1064` in MySQL's own `create.test`. Being more
      // permissive than the server is a divergence like any other, and the only
      // kind the census can see in this direction.
      const element = tableElement(c, options)
      if (element.what === 'key') keys.push(element.key)
      else if (element.what === 'check') checks.push(element.check)
      else columns.push(element.column)
    } while (c.takeOp(','))
    c.expectOp(')')
  }

  const tableOptions = parseTableOptions(c)

  if (c.atWord('PARTITION')) throw unsupportedStatement('CREATE TABLE ... PARTITION BY')

  // `CREATE TABLE ... [IGNORE | REPLACE] [AS] SELECT`. `IGNORE` and `REPLACE`
  // choose what a duplicate key does to the copied rows, and sit between the
  // table definition and the query.
  let duplicates: 'IGNORE' | 'REPLACE' | undefined
  if (c.takeWord('IGNORE')) duplicates = 'IGNORE'
  else if (c.takeWord('REPLACE')) duplicates = 'REPLACE'
  const as = c.takeWord('AS')
  let query: QueryExpression | undefined
  if (atQueryStart(c) || atParenthesisedQuery(c)) query = parseQueryFrom(c, options.sqlMode)
  else if (duplicates !== undefined || as) c.fail()

  if (!c.atEnd() && !c.atOp(';')) c.fail()

  return {
    kind: STATEMENT.CREATE_TABLE,
    table,
    ...flag('temporary', temporary),
    ...flag('ifNotExists', ifNotExists),
    columns,
    keys,
    checks,
    options: tableOptions,
    ...(query === undefined ? {} : { query }),
    ...(duplicates === undefined ? {} : { duplicates }),
    at,
  }
}

/**
 * Parse a `CREATE VIEW`, with the cursor on `CREATE`.
 *
 * The clauses before `VIEW` say how the view is stored and whose privileges it
 * runs with; the query after `AS` is the view. `WITH CHECK OPTION` without a
 * scope is `CASCADED`, so it is recorded as that.
 */
export function parseCreateView(c: Cursor, options: DdlOptions): CreateViewNode {
  const at = c.peek().start
  c.expectWord('CREATE')
  const orReplace = c.takeWords('OR', 'REPLACE')
  let algorithm: CreateViewNode['algorithm']
  if (c.takeWord('ALGORITHM')) {
    c.expectOp('=')
    for (const a of ['UNDEFINED', 'MERGE', 'TEMPTABLE'] as const) if (c.takeWord(a)) algorithm = a
    if (algorithm === undefined) c.fail()
  }
  const definer = c.takeWord('DEFINER') ? parseDefiner(c) : undefined
  let security: CreateViewNode['security']
  if (c.takeWords('SQL', 'SECURITY')) {
    if (c.takeWord('DEFINER')) security = 'DEFINER'
    else if (c.takeWord('INVOKER')) security = 'INVOKER'
    else c.fail()
  }
  c.expectWord('VIEW')
  const view = tableName(c)
  let columns: string[] | undefined
  if (c.takeOp('(')) {
    columns = []
    do columns.push(c.expectIdentifier())
    while (c.takeOp(','))
    c.expectOp(')')
  }
  c.expectWord('AS')
  const query = parseQueryFrom(c, options.sqlMode)
  let checkOption: CreateViewNode['checkOption']
  if (c.takeWord('WITH')) {
    checkOption = c.takeWord('LOCAL') ? 'LOCAL' : (c.takeWord('CASCADED'), 'CASCADED')
    c.expectWord('CHECK')
    c.expectWord('OPTION')
  }
  return {
    kind: STATEMENT.CREATE_VIEW,
    view,
    ...flag('orReplace', orReplace),
    ...(algorithm === undefined ? {} : { algorithm }),
    ...(definer === undefined ? {} : { definer }),
    ...(security === undefined ? {} : { security }),
    ...(columns === undefined ? {} : { columns }),
    query,
    ...(checkOption === undefined ? {} : { checkOption }),
    at,
  }
}

/**
 * `= 'u'@'h'`, `= u@h`, `= 'u'`, `= CURRENT_USER[()]`.
 *
 * The lexer reads `@'h'` as a variable token, since that is what it is
 * everywhere else, so the host is that token with its `@` removed.
 */
export function parseDefiner(c: Cursor): Definer {
  c.expectOp('=')
  if (c.takeWord('CURRENT_USER')) {
    if (c.takeOp('(')) c.expectOp(')')
    return 'CURRENT_USER'
  }
  const u = c.peek()
  if (u.kind !== TOKEN.STRING && u.kind !== TOKEN.IDENTIFIER) c.fail()
  c.skip()
  const h = c.peek()
  if (h.kind === TOKEN.VARIABLE && h.text.startsWith('@') && !h.text.startsWith('@@')) {
    c.skip()
    return { user: u.text, host: h.text.slice(1) }
  }
  return { user: u.text }
}

/** Parse a `DROP`, with the cursor on `DROP`. */
export function parseDrop(c: Cursor): DropNode {
  const at = c.peek().start
  c.expectWord('DROP')
  const temporary = c.takeWord('TEMPORARY')

  let object: DropObject
  if (c.takeWord('TABLE')) object = DROP_OBJECT.TABLE
  else if (c.takeWord('VIEW')) object = DROP_OBJECT.VIEW
  else if (c.takeWord('INDEX')) object = DROP_OBJECT.INDEX
  else if (c.takeWord('DATABASE') || c.takeWord('SCHEMA')) object = DROP_OBJECT.DATABASE
  else c.fail()

  const ifExists = c.takeWords('IF', 'EXISTS')
  const names: TableName[] = [tableName(c)]

  if (object === DROP_OBJECT.INDEX) {
    c.expectWord('ON')
    const on = tableName(c)
    // `ALGORITHM` and `LOCK` are accepted and mean nothing to a parser: they
    // ask the *server* how to perform the change. Consumed rather than
    // recorded, and consumed rather than left, since leaving them would make
    // the statement look unparsed.
    algorithmAndLock(c)
    return { kind: STATEMENT.DROP, object, names, ...flag('ifExists', ifExists), on, at }
  }

  while (c.takeOp(',')) names.push(tableName(c))
  let behaviour: string | undefined
  if (c.takeWord('RESTRICT')) behaviour = 'RESTRICT'
  else if (c.takeWord('CASCADE')) behaviour = 'CASCADE'

  return {
    kind: STATEMENT.DROP,
    object,
    names,
    ...flag('ifExists', ifExists),
    ...flag('temporary', temporary),
    ...(behaviour === undefined ? {} : { behaviour }),
    at,
  }
}

// --- table elements ---------------------------------------------------------

/** `{ key: true }` when set, `{}` when not — so an unset flag is absent, not false. */
const flag = (name: string, on: boolean): Record<string, true> => (on ? { [name]: true } : {})

/**
 * One element of a `CREATE TABLE` body: a column, a key, or a check.
 *
 * The discrimination is genuinely ambiguous at one token of lookahead, because
 * `KEY` and `INDEX` are legal column *names* as well as key introducers —
 * `CREATE TABLE t (key INT)` is valid. So a word that could introduce a key is
 * only treated as one when what follows fits a key rather than a type.
 */
type TableElement =
  | { readonly what: 'column'; readonly column: ColumnDefinition }
  | { readonly what: 'key'; readonly key: KeyDefinition }
  | { readonly what: 'check'; readonly check: CheckConstraint }

function tableElement(c: Cursor, options: DdlOptions): TableElement {
  const at = c.peek().start

  if (c.atWord('CONSTRAINT')) {
    c.skip()
    // The symbol is optional: `CONSTRAINT PRIMARY KEY (a)` names nothing.
    const symbol = c.atIdentifier() ? c.expectIdentifier() : undefined
    if (c.atWord('CHECK')) return { what: 'check', check: checkConstraint(c, options, at, symbol) }
    const key = keyDefinition(c, options, at)
    return { what: 'key', key: symbol === undefined ? key : { ...key, constraint: symbol } }
  }

  if (c.atWord('CHECK')) return { what: 'check', check: checkConstraint(c, options, at, undefined) }
  if (startsKeyOrCheck(c)) return { what: 'key', key: keyDefinition(c, options, at) }

  return { what: 'column', column: columnDefinition(c, options, at) }
}

/**
 * True when the cursor is at a word that introduces a key rather than a column.
 *
 * All seven are reserved (M3.15), so none of them can begin a column definition
 * unquoted and the test is a lookup. M3.5 first believed `KEY`, `INDEX` and
 * `UNIQUE` were legal column names and told them apart from a key by what
 * followed — `KEY timestamp (timestamp)` against `key TIMESTAMP(6)` — but the
 * column in the corpus was `` `key` ``, in backticks, and a real 8.4 refuses
 * `CREATE TABLE t (key INT)` outright. The lookahead was guarding a case MySQL
 * does not have.
 */
function startsKeyOrCheck(c: Cursor): boolean {
  return KEY_INTRODUCERS.some((w) => c.atWord(w))
}

const KEY_INTRODUCERS = ['PRIMARY', 'UNIQUE', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL', 'FOREIGN']

function keyDefinition(c: Cursor, options: DdlOptions, at: number): KeyDefinition {
  let type: KeyType
  if (c.takeWord('PRIMARY')) {
    c.expectWord('KEY')
    type = KEY.PRIMARY
  } else if (c.takeWord('UNIQUE')) {
    c.takeWord('KEY') || c.takeWord('INDEX')
    type = KEY.UNIQUE
  } else if (c.takeWord('FULLTEXT')) {
    c.takeWord('KEY') || c.takeWord('INDEX')
    type = KEY.FULLTEXT
  } else if (c.takeWord('SPATIAL')) {
    c.takeWord('KEY') || c.takeWord('INDEX')
    type = KEY.SPATIAL
  } else if (c.takeWord('FOREIGN')) {
    c.expectWord('KEY')
    type = KEY.FOREIGN
  } else if (c.takeWord('KEY') || c.takeWord('INDEX')) {
    type = KEY.INDEX
  } else {
    c.fail()
  }

  // A name, unless the next thing is the column list or an index type.
  const name = c.atIdentifier() ? c.expectIdentifier() : undefined
  const using = indexType(c)
  const columns = indexColumns(c, options)

  let references: Reference | undefined
  if (type === KEY.FOREIGN) references = parseReferences(c, options)

  const rest = indexOptions(c)
  return {
    type,
    ...(name === undefined ? {} : { name }),
    columns,
    ...(using ?? rest.using ? { using: (using ?? rest.using) as string } : {}),
    ...(references === undefined ? {} : { references }),
    ...(rest.comment === undefined ? {} : { comment: rest.comment }),
    at,
  }
}

function checkConstraint(
  c: Cursor,
  options: DdlOptions,
  at: number,
  name: string | undefined,
): CheckConstraint {
  c.expectWord('CHECK')
  c.expectOp('(')
  const expr = parseExpressionFrom(c, options.sqlMode)
  c.expectOp(')')
  // `NOT ENFORCED` makes the constraint documentation. Enforced is the default,
  // and writing `ENFORCED` explicitly changes nothing.
  let enforced = true
  if (c.takeWords('NOT', 'ENFORCED')) enforced = false
  else c.takeWord('ENFORCED')
  return { ...(name === undefined ? {} : { name }), expr, enforced, at }
}

function columnDefinition(c: Cursor, options: DdlOptions, at: number): ColumnDefinition {
  const name = c.expectIdentifier()
  let type = parseDataType(c, options.sqlMode)

  let notNull: boolean | undefined
  let nullable: boolean | undefined
  let defaultValue: Expression | undefined
  let onUpdate: Expression | undefined
  let autoIncrement: boolean | undefined
  let unique: boolean | undefined
  let primary: boolean | undefined
  let comment: string | undefined
  let generated: { expr: Expression; stored: boolean } | undefined
  let invisible: boolean | undefined
  let srid: number | undefined
  let check: Expression | undefined

  // Column attributes are an unordered bag, and MySQL accepts them in any
  // order. Anything not matched here ends the column — and if it is not a
  // comma or a closing paren the caller fails on it, rather than this loop
  // skipping a clause it did not recognise.
  for (;;) {
    if (c.takeWords('NOT', 'NULL')) {
      notNull = true
      continue
    }
    if (c.takeWord('NULL')) {
      nullable = true
      continue
    }
    if (c.takeWord('DEFAULT')) {
      defaultValue = defaultExpression(c, options)
      continue
    }
    if (c.takeWords('ON', 'UPDATE')) {
      onUpdate = defaultExpression(c, options)
      continue
    }
    if (c.takeWord('AUTO_INCREMENT')) {
      autoIncrement = true
      continue
    }
    // `KEY` on its own in this position *is* `PRIMARY KEY` — MySQL's own
    // synonym, and a place a reader would not expect one.
    if (c.takeWords('PRIMARY', 'KEY') || c.takeWord('KEY')) {
      primary = true
      continue
    }
    if (c.takeWord('UNIQUE')) {
      c.takeWord('KEY')
      unique = true
      continue
    }
    if (c.takeWord('COMMENT')) {
      comment = stringLiteral(c)
      continue
    }
    // A `COLLATE` after other attributes is the type's collation written
    // late, not a second one: `a VARCHAR(5) NOT NULL COLLATE x` and
    // `a VARCHAR(5) COLLATE x NOT NULL` are the same column, so both land on
    // the type. Recording the late one on the column made them two trees for
    // one definition (found by the deparser's round-trip, M3.3).
    if (c.takeWord('COLLATE')) {
      type = { ...type, collation: nameOrString(c).toLowerCase() }
      continue
    }
    if (c.takeWord('INVISIBLE')) {
      invisible = true
      continue
    }
    if (c.takeWord('VISIBLE')) {
      invisible = false
      continue
    }
    if (c.takeWord('SRID')) {
      const t = c.peek()
      if (t.kind !== TOKEN.NUMBER) c.fail()
      c.skip()
      srid = Number(t.text)
      continue
    }
    if (c.takeWord('CHECK')) {
      c.expectOp('(')
      check = parseExpressionFrom(c, options.sqlMode)
      c.expectOp(')')
      c.takeWords('NOT', 'ENFORCED') || c.takeWord('ENFORCED')
      continue
    }
    // A generated column, in both its spellings. `STORED` and `VIRTUAL` are
    // not interchangeable — a stored column occupies row space and can be
    // indexed by any engine — so which was written is recorded.
    if (c.takeWords('GENERATED', 'ALWAYS', 'AS') || c.takeWord('AS')) {
      c.expectOp('(')
      const expr = parseExpressionFrom(c, options.sqlMode)
      c.expectOp(')')
      let stored = false
      if (c.takeWord('STORED')) stored = true
      else c.takeWord('VIRTUAL')
      generated = { expr, stored }
      continue
    }
    if (c.takeWord('ENGINE_ATTRIBUTE') || c.takeWord('SECONDARY_ENGINE_ATTRIBUTE')) {
      c.takeOp('=')
      c.skip()
      continue
    }
    if (c.takeWords('COLUMN_FORMAT', 'FIXED') || c.takeWords('COLUMN_FORMAT', 'DYNAMIC') || c.takeWords('COLUMN_FORMAT', 'DEFAULT')) continue
    if (c.takeWords('STORAGE', 'DISK') || c.takeWords('STORAGE', 'MEMORY') || c.takeWords('STORAGE', 'DEFAULT')) continue
    if (c.atWord('REFERENCES')) {
      // An inline reference. MySQL parses it and then *ignores* it for InnoDB
      // unless the same thing is written as a table-level `FOREIGN KEY` — a
      // documented trap rather than an oversight. Parsed and discarded here for
      // the same reason: recording it on the column would suggest it does
      // something.
      parseReferences(c, options)
      continue
    }
    break
  }

  // `SERIAL` is four attributes wearing a type's clothes.
  if (type.serial === true) {
    notNull = true
    autoIncrement = true
    unique = true
  }

  return {
    name,
    type,
    ...(notNull === undefined ? {} : { notNull }),
    ...(nullable === undefined ? {} : { nullable }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
    ...(unique === undefined ? {} : { unique }),
    ...(primary === undefined ? {} : { primary }),
    ...(comment === undefined ? {} : { comment }),
    ...(generated === undefined ? {} : { generated }),
    ...(invisible === undefined ? {} : { invisible }),
    ...(srid === undefined ? {} : { srid }),
    ...(check === undefined ? {} : { check }),
    at,
  }
}

/**
 * A `DEFAULT` or `ON UPDATE` value.
 *
 * Three shapes, and the parenthesised one is why this is not just
 * `parseExpressionFrom`: before 8.0.13 a `DEFAULT` had to be a literal, and
 * since then `DEFAULT (expr)` is allowed with the parentheses **required** —
 * they are part of the syntax rather than grouping, which is how MySQL keeps
 * the old restriction unambiguous.
 */
function defaultExpression(c: Cursor, options: DdlOptions): Expression {
  const t = c.peek()
  if (c.atOp('(')) {
    // `DEFAULT (SELECT …)` is a subquery, which MySQL parses and then rejects
    // for a default. The parentheses are the subquery's own, so the
    // expression parser reads them.
    if (atQueryStart(c, 1)) return parseExpressionFrom(c, options.sqlMode)
    c.skip()
    const expr = parseExpressionFrom(c, options.sqlMode)
    c.expectOp(')')
    return expr
  }
  // `CURRENT_TIMESTAMP`, `NOW()`, `LOCALTIME` and friends — a function that may
  // be written without parentheses, optionally with an fsp argument.
  if (c.peek().kind === TOKEN.IDENTIFIER && c.peek().quoted !== true) {
    const word = t.text.toUpperCase()
    if (['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'UTC_TIMESTAMP'].includes(word)) {
      c.skip()
      const args: Expression[] = []
      if (c.takeOp('(')) {
        if (!c.atOp(')')) {
          const n = c.peek()
          if (n.kind !== TOKEN.NUMBER) c.fail()
          c.skip()
          args.push({ kind: NODE.LITERAL, type: 'int', value: BigInt(n.text), at: n.start })
        }
        c.expectOp(')')
      }
      // The name as written, as the expression parser records it — so
      // `DEFAULT now()` and `DEFAULT (now())` are the same call.
      return { kind: NODE.CALL, name: t.text, args, at: t.start }
    }
  }
  return parseExpressionFrom(c, options.sqlMode)
}

// --- index and reference clauses -------------------------------------------

function indexType(c: Cursor): string | undefined {
  if (!c.takeWord('USING')) return undefined
  if (c.takeWord('BTREE')) return 'BTREE'
  if (c.takeWord('HASH')) return 'HASH'
  if (c.takeWord('RTREE')) return 'RTREE'
  c.fail()
}

function indexColumns(c: Cursor, options: DdlOptions): IndexColumn[] {
  c.expectOp('(')
  const out: IndexColumn[] = []
  do {
    // A functional index: `((UPPER(a)))`. The inner parentheses are required
    // and are what distinguishes it from a column named by an expression.
    if (c.atOp('(')) {
      c.skip()
      const expr = parseExpressionFrom(c, options.sqlMode)
      c.expectOp(')')
      out.push({ expr, ...direction(c) })
      continue
    }
    const name = c.expectIdentifier()
    let length: number | undefined
    if (c.takeOp('(')) {
      const t = c.peek()
      if (t.kind !== TOKEN.NUMBER) c.fail()
      c.skip()
      length = Number(t.text)
      c.expectOp(')')
    }
    out.push({ name, ...(length === undefined ? {} : { length }), ...direction(c) })
  } while (c.takeOp(','))
  c.expectOp(')')
  return out
}

function direction(c: Cursor): { desc?: true } {
  if (c.takeWord('DESC')) return { desc: true }
  c.takeWord('ASC')
  return {}
}

function indexOptions(c: Cursor): { using?: string; comment?: string } {
  let using: string | undefined
  let comment: string | undefined
  for (;;) {
    const more = indexType(c)
    if (more !== undefined) {
      using = more
      continue
    }
    if (c.takeWord('KEY_BLOCK_SIZE')) {
      c.takeOp('=')
      c.skip()
      continue
    }
    if (c.takeWord('COMMENT')) {
      comment = stringLiteral(c)
      continue
    }
    if (c.takeWords('WITH', 'PARSER')) {
      c.expectIdentifier()
      continue
    }
    if (c.takeWord('VISIBLE') || c.takeWord('INVISIBLE')) continue
    if (c.takeWord('ENGINE_ATTRIBUTE') || c.takeWord('SECONDARY_ENGINE_ATTRIBUTE')) {
      c.takeOp('=')
      c.skip()
      continue
    }
    break
  }
  return { ...(using === undefined ? {} : { using }), ...(comment === undefined ? {} : { comment }) }
}

function parseReferences(c: Cursor, options: DdlOptions): Reference {
  c.expectWord('REFERENCES')
  const table = tableName(c)
  const columns = c.atOp('(') ? indexColumns(c, options) : []
  let match: string | undefined
  if (c.takeWord('MATCH')) {
    if (c.takeWord('FULL')) match = 'FULL'
    else if (c.takeWord('PARTIAL')) match = 'PARTIAL'
    else if (c.takeWord('SIMPLE')) match = 'SIMPLE'
    else c.fail()
  }
  let onDelete: string | undefined
  let onUpdate: string | undefined
  for (;;) {
    if (c.takeWords('ON', 'DELETE')) {
      onDelete = referentialAction(c)
      continue
    }
    if (c.takeWords('ON', 'UPDATE')) {
      onUpdate = referentialAction(c)
      continue
    }
    break
  }
  return {
    table,
    columns,
    ...(match === undefined ? {} : { match }),
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  }
}

function referentialAction(c: Cursor): string {
  for (const action of REFERENTIAL_ACTIONS) {
    const words = action.split(' ')
    if (c.takeWords(...words)) return action
  }
  c.fail()
}

// --- table options ----------------------------------------------------------

/**
 * The clauses after the closing paren, which are a bag rather than a sequence.
 *
 * The `=` is optional throughout — `ENGINE=InnoDB` and `ENGINE InnoDB` are the
 * same statement — and a comma between options is optional too, which is why
 * this loop takes one at the top rather than expecting a separator.
 */
function parseTableOptions(c: Cursor): Record<string, string> {
  const out: Record<string, string> = {}
  for (;;) {
    c.takeOp(',')
    if (c.takeWords('DEFAULT', 'CHARACTER', 'SET') || c.takeWords('CHARACTER', 'SET') || c.takeWords('DEFAULT', 'CHARSET') || c.takeWord('CHARSET')) {
      c.takeOp('=')
      out['CHARACTER SET'] = nameOrString(c)
      continue
    }
    if (c.takeWords('DEFAULT', 'COLLATE') || c.takeWord('COLLATE')) {
      c.takeOp('=')
      out['COLLATE'] = nameOrString(c)
      continue
    }
    const t = c.peek()
    if (t.kind !== TOKEN.IDENTIFIER || t.quoted === true) break
    const word = t.text.toUpperCase()
    if (!TABLE_OPTIONS.has(word)) break
    c.skip()
    // `DATA DIRECTORY` and `INDEX DIRECTORY` are two words; `START TRANSACTION`
    // is a suffix on `CREATE TABLE ... START TRANSACTION` and takes no value.
    if (word === 'DATA' || word === 'INDEX') c.expectWord('DIRECTORY')
    if (word === 'START') {
      c.expectWord('TRANSACTION')
      out['START TRANSACTION'] = 'true'
      continue
    }
    if (word === 'UNION') {
      c.takeOp('=')
      c.expectOp('(')
      const members: string[] = []
      do members.push(tableName(c).name)
      while (c.takeOp(','))
      c.expectOp(')')
      out['UNION'] = members.join(',')
      continue
    }
    c.takeOp('=')
    const max = ULONG_OPTIONS[word]
    if (max !== undefined) {
      out[word] = ulongValue(c, max)
      continue
    }
    if (word === 'ROW_FORMAT') {
      const format = nameOrString(c).toUpperCase()
      if (!ROW_FORMATS.has(format)) c.fail()
      out[word] = format
      continue
    }
    out[word === 'DATA' ? 'DATA DIRECTORY' : word === 'INDEX' ? 'INDEX DIRECTORY' : word] = nameOrString(c)
  }
  return out
}

// --- small shared pieces ----------------------------------------------------

function tableName(c: Cursor): TableName {
  const first = c.expectIdentifier()
  if (!c.takeOp('.')) return { name: first }
  return { schema: first, name: c.expectNamePart() }
}

function stringLiteral(c: Cursor): string {
  const t = c.peek()
  if (t.kind !== TOKEN.STRING) c.fail()
  c.skip()
  return t.text
}

/** A value that may be written as a bare word, a quoted string, or a number. */
function nameOrString(c: Cursor): string {
  const t = c.peek()
  if (t.kind === TOKEN.IDENTIFIER || t.kind === TOKEN.STRING || t.kind === TOKEN.NUMBER) {
    c.skip()
    return t.text
  }
  c.fail()
}

/**
 * An option whose value MySQL's grammar types as `ulong_num` — 32-bit unsigned.
 *
 * The bound is *syntax*, not a range check the server does later: MySQL's own
 * `create.test` marks `KEY_BLOCK_SIZE = -2147483647`, `= 2147483648` and
 * `avg_row_length=4294967296` with `--error ER_PARSE_ERROR`. An earlier version
 * of this parser accepted a leading `-` here precisely so those would parse,
 * which was fixing the wrong thing — the census's expected-failure accounting
 * is what showed it, by reporting six statements we accepted and MySQL does
 * not.
 */
const ULONG_OPTIONS: Readonly<Record<string, number>> = {
  // `create.test` documents this one in its own comments: "2 bytes in frm", so
  // an explicit check bounds it at 65535 and everything above is reported as
  // ER_PARSE_ERROR — which is why 2147483647 is rejected even though it fits a
  // 32-bit unsigned. The corpus is the only place that fact is written down.
  KEY_BLOCK_SIZE: 0xffff,
  AVG_ROW_LENGTH: 0xffffffff,
  STATS_SAMPLE_PAGES: 0xffff,
  AUTOEXTEND_SIZE: 0xffffffff,
}

function ulongValue(c: Cursor, max: number): string {
  const t = c.peek()
  if (t.kind !== TOKEN.NUMBER || !/^\d+$/.test(t.text) || Number(t.text) > max) c.fail()
  c.skip()
  return t.text
}

/**
 * The row formats MySQL's grammar names, and nothing else.
 *
 * `row_format=page` is MariaDB's and carries `--error ER_PARSE_ERROR` in
 * `create.test`: the value is part of the grammar rather than a string the
 * engine interprets, so accepting any word here accepted SQL MySQL rejects.
 */
const ROW_FORMATS = new Set(['DEFAULT', 'DYNAMIC', 'FIXED', 'COMPRESSED', 'REDUNDANT', 'COMPACT'])

/** `ALGORITHM = …` / `LOCK = …`, which `DROP INDEX` and `ALTER TABLE` accept. */
function algorithmAndLock(c: Cursor): void {
  while (c.takeWord('ALGORITHM') || c.takeWord('LOCK')) {
    c.takeOp('=')
    c.skip()
  }
}
