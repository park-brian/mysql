// M3.8 — stored procedures, functions, triggers and events: accepted and
// stored, not executed.
//
// The head of each statement is parsed in full: the name, the parameters, the
// return type, and the characteristics or schedule. The body is kept as the
// text it was written in, and is parsed too when it is one ordinary
// statement, because a real 8.4.11 refuses `CREATE PROCEDURE p() garbage`. A
// compound body is the stored-program language — `BEGIN … END`, `DECLARE`,
// `IF`, `WHILE` — which is M8.5's to read, so it is stored unread.
//
// Also from the server: a function's parameters take no `IN`, `CREATE
// PROCEDURE p SELECT 1` needs its `()`, and `IF NOT EXISTS` is legal on all four.
import type { Expression } from './ast.ts'
import type { Cursor } from './cursor.ts'
import { parseDefiner } from './ddl.ts'
import { parseDataType, type DataType } from './data-type.ts'
import { unsupportedStatement } from './errors.ts'
import { parseExpressionFrom } from './expression.ts'
import type { SqlMode } from './sql-mode.ts'
import {
  STATEMENT,
  type CallStatementNode,
  type CreateEventNode,
  type CreateRoutineNode,
  type CreateTriggerNode,
  type Definer,
  type EventSchedule,
  type RoutineParameter,
  type Statement,
  type TableName,
} from './statement-ast.ts'
import { TOKEN } from './tokens.ts'

/** Parses one statement from the cursor: the dispatcher, passed in to keep the import graph acyclic. */
export type StatementParser = (c: Cursor) => Statement

interface Head {
  readonly definer?: Definer
  readonly ifNotExists?: boolean
  readonly name: TableName
  readonly at: number
}

/**
 * `CREATE [DEFINER = u] <object> [IF NOT EXISTS] name`, with the cursor on
 * `CREATE`. The clauses the dispatcher's lookahead already walked past are
 * read here for real; `OR REPLACE`, `ALGORITHM` and `SQL SECURITY` belong to
 * views and are refused before a stored program.
 */
function head(c: Cursor, object: string): Head {
  const at = c.peek().start
  c.expectWord('CREATE')
  const definer = c.takeWord('DEFINER') ? parseDefiner(c) : undefined
  c.expectWord(object)
  const ifNotExists = c.takeWords('IF', 'NOT', 'EXISTS')
  const name = c.expectTableName()
  return { ...(definer === undefined ? {} : { definer }), ...(ifNotExists ? { ifNotExists } : {}), name, at }
}

/** `CREATE PROCEDURE` or `CREATE FUNCTION`, with the cursor on `CREATE`. */
export function parseCreateRoutine(c: Cursor, mode: SqlMode, object: 'PROCEDURE' | 'FUNCTION', statement: StatementParser): CreateRoutineNode {
  const h = head(c, object)
  // `CREATE FUNCTION f RETURNS INTEGER SONAME 'udf.so'` loads a C function — a
  // different statement that shares the opening words.
  if (object === 'FUNCTION' && c.atWord('RETURNS')) throw unsupportedStatement('CREATE FUNCTION … SONAME')
  c.expectOp('(')
  const parameters: RoutineParameter[] = []
  if (!c.atOp(')')) {
    do parameters.push(parameter(c, mode, object === 'PROCEDURE'))
    while (c.takeOp(','))
  }
  c.expectOp(')')
  let returns: DataType | undefined
  if (object === 'FUNCTION') {
    c.expectWord('RETURNS')
    returns = parseDataType(c, mode)
  }

  let comment: string | undefined
  let deterministic: boolean | undefined
  let dataAccess: CreateRoutineNode['dataAccess']
  let security: CreateRoutineNode['security']
  for (;;) {
    if (c.takeWord('COMMENT')) comment = c.expectString()
    else if (c.takeWords('LANGUAGE', 'SQL')) continue
    else if (c.takeWord('DETERMINISTIC')) deterministic = true
    else if (c.takeWords('NOT', 'DETERMINISTIC')) deterministic = false
    else if (c.takeWords('CONTAINS', 'SQL')) dataAccess = 'CONTAINS SQL'
    else if (c.takeWords('NO', 'SQL')) dataAccess = 'NO SQL'
    else if (c.takeWords('READS', 'SQL', 'DATA')) dataAccess = 'READS SQL DATA'
    else if (c.takeWords('MODIFIES', 'SQL', 'DATA')) dataAccess = 'MODIFIES SQL DATA'
    else if (c.takeWords('SQL', 'SECURITY')) {
      if (c.takeWord('DEFINER')) security = 'DEFINER'
      else if (c.takeWord('INVOKER')) security = 'INVOKER'
      else c.fail()
    } else break
  }
  return {
    kind: STATEMENT.CREATE_ROUTINE,
    object,
    ...h,
    parameters,
    ...(returns === undefined ? {} : { returns }),
    ...(comment === undefined ? {} : { comment }),
    ...(deterministic === undefined ? {} : { deterministic }),
    ...(dataAccess === undefined ? {} : { dataAccess }),
    ...(security === undefined ? {} : { security }),
    body: body(c, mode, statement),
  }
}

function parameter(c: Cursor, mode: SqlMode, procedure: boolean): RoutineParameter {
  let direction: RoutineParameter['mode']
  if (procedure) {
    if (c.takeWord('IN')) direction = 'IN'
    else if (c.takeWord('OUT')) direction = 'OUT'
    else if (c.takeWord('INOUT')) direction = 'INOUT'
  }
  const name = c.expectIdentifier()
  // `IN` is the default, and is recorded as absent so `(IN a INT)` and
  // `(a INT)` are one tree.
  return { ...(direction === undefined || direction === 'IN' ? {} : { mode: direction }), name, type: parseDataType(c, mode) }
}

/** `CREATE TRIGGER`, with the cursor on `CREATE`. */
export function parseCreateTrigger(c: Cursor, mode: SqlMode, statement: StatementParser): CreateTriggerNode {
  const h = head(c, 'TRIGGER')
  let timing: CreateTriggerNode['timing']
  if (c.takeWord('BEFORE')) timing = 'BEFORE'
  else {
    c.expectWord('AFTER')
    timing = 'AFTER'
  }
  let event: CreateTriggerNode['event']
  if (c.takeWord('INSERT')) event = 'INSERT'
  else if (c.takeWord('UPDATE')) event = 'UPDATE'
  else {
    c.expectWord('DELETE')
    event = 'DELETE'
  }
  c.expectWord('ON')
  const table = c.expectTableName()
  c.expectWord('FOR')
  c.expectWord('EACH')
  c.expectWord('ROW')
  let order: CreateTriggerNode['order']
  if (c.atWord('FOLLOWS') || c.atWord('PRECEDES')) {
    const position = c.take().text.toUpperCase() as 'FOLLOWS' | 'PRECEDES'
    order = { position, trigger: c.expectIdentifier() }
  }
  return { kind: STATEMENT.CREATE_TRIGGER, ...h, timing, event, table, ...(order === undefined ? {} : { order }), body: body(c, mode, statement) }
}

/** `CREATE EVENT`, with the cursor on `CREATE`. */
export function parseCreateEvent(c: Cursor, mode: SqlMode, statement: StatementParser): CreateEventNode {
  const h = head(c, 'EVENT')
  c.expectWord('ON')
  c.expectWord('SCHEDULE')
  let schedule: EventSchedule
  if (c.takeWord('AT')) {
    schedule = { at: parseExpressionFrom(c, mode) }
  } else {
    c.expectWord('EVERY')
    const every = parseExpressionFrom(c, mode)
    const unit = c.expectIdentifier().toUpperCase()
    const starts = c.takeWord('STARTS') ? parseExpressionFrom(c, mode) : undefined
    const ends = c.takeWord('ENDS') ? parseExpressionFrom(c, mode) : undefined
    schedule = { every, unit, ...(starts === undefined ? {} : { starts }), ...(ends === undefined ? {} : { ends }) }
  }
  let preserve: boolean | undefined
  if (c.takeWords('ON', 'COMPLETION')) {
    preserve = !c.takeWord('NOT')
    c.expectWord('PRESERVE')
  }
  let status: CreateEventNode['status']
  if (c.takeWord('ENABLE')) status = 'ENABLE'
  else if (c.takeWord('DISABLE')) {
    // `ON SLAVE` is the old spelling of `ON REPLICA`.
    status = c.takeWords('ON', 'REPLICA') || c.takeWords('ON', 'SLAVE') ? 'DISABLE ON REPLICA' : 'DISABLE'
  }
  const comment = c.takeWord('COMMENT') ? c.expectString() : undefined
  c.expectWord('DO')
  return {
    kind: STATEMENT.CREATE_EVENT,
    ...h,
    schedule,
    ...(preserve === undefined ? {} : { preserve }),
    ...(status === undefined ? {} : { status }),
    ...(comment === undefined ? {} : { comment }),
    body: body(c, mode, statement),
  }
}

/** `CALL p [(args)]`, with the cursor on `CALL`. */
export function parseCall(c: Cursor, mode: SqlMode): CallStatementNode {
  const at = c.peek().start
  c.expectWord('CALL')
  const name = c.expectTableName()
  const args: Expression[] = []
  if (c.takeOp('(')) {
    if (!c.atOp(')')) {
      do args.push(parseExpressionFrom(c, mode))
      while (c.takeOp(','))
    }
    c.expectOp(')')
  }
  return { kind: STATEMENT.CALL, name, args, at }
}

/**
 * Words that open a compound statement, or a statement that exists only
 * inside a stored program. A body that starts with one is stored unread.
 */
const COMPOUND = new Set([
  'BEGIN', 'DECLARE', 'IF', 'CASE', 'LOOP', 'WHILE', 'REPEAT', 'LEAVE', 'ITERATE',
  'OPEN', 'FETCH', 'CLOSE', 'SIGNAL', 'RESIGNAL', 'GET',
])

/**
 * The body, from the cursor to the end of the statement, as source text. A
 * trailing `;` belongs to the statement, as it does everywhere else.
 */
function body(c: Cursor, mode: SqlMode, statement: StatementParser): string {
  const first = c.peek()
  if (first.kind === TOKEN.EOF || (first.kind === TOKEN.OPERATOR && first.text === ';')) c.fail()
  const start = c.at
  const word = first.kind === TOKEN.IDENTIFIER && first.quoted !== true ? first.text.toUpperCase() : ''
  // A label — `l1: LOOP … END LOOP l1` — opens a compound statement too.
  const labelled = first.kind === TOKEN.IDENTIFIER && c.atOp(':', 1)
  if (COMPOUND.has(word) || labelled) {
    while (!c.atEnd() && !(c.atOp(';') && c.peek(1).kind === TOKEN.EOF)) c.skip()
  } else if (word === 'RETURN') {
    c.skip()
    parseExpressionFrom(c, mode)
  } else {
    statement(c)
  }
  const last = c.tokens[c.at - 1] ?? first
  return c.source.slice(c.tokens[start]?.start ?? first.start, last.end)
}
