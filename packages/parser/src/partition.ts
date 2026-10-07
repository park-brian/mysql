// M3.5 — `PARTITION BY`, the last `CREATE TABLE` form the census reported as
// unimplemented.
//
// Parsed and not executed: partitioning is M8.9's. What belongs to the grammar
// rather than to the server, by asking 8.4.11: `KEY ALGORITHM` is 1 or 2 and
// anything else is ER_PARSE_ERROR, while `PARTITIONS 0`, `VALUES IN` under
// `RANGE` and a `KEY ()` with no primary key are all refused only after
// parsing, with errors of their own.
import { NODE, type Expression } from './ast.ts'
import { opt, type Cursor } from './cursor.ts'
import { nameOrString, ulongValue, type DdlOptions } from './ddl.ts'
import { parseExpressionFrom } from './expression.ts'
import type { PartitionDefinition, PartitionMethod, Partitioning } from './statement-ast.ts'
import { TOKEN } from './tokens.ts'

/** `PARTITION BY …`, with the cursor on `PARTITION`. */
export function parsePartitioning(c: Cursor, options: DdlOptions): Partitioning {
  c.expectWord('PARTITION')
  c.expectWord('BY')
  const method = partitionMethod(c, options, 'PARTITIONS', true)
  let sub: PartitionMethod | undefined
  if (c.takeWord('SUBPARTITION')) {
    c.expectWord('BY')
    sub = partitionMethod(c, options, 'SUBPARTITIONS', false)
  }
  let partitions: PartitionDefinition[] | undefined
  if (c.takeOp('(')) {
    partitions = []
    do partitions.push(partitionDefinition(c, options))
    while (c.takeOp(','))
    c.expectOp(')')
  }
  return { ...method, ...opt('sub', sub), ...opt('partitions', partitions) }
}

/** `[LINEAR] HASH (expr)`, `[LINEAR] KEY [ALGORITHM = n] (cols)`, and — top level only — `RANGE`/`LIST`. */
function partitionMethod(c: Cursor, options: DdlOptions, countWord: string, top: boolean): PartitionMethod {
  const linear = c.takeWord('LINEAR')
  let out: PartitionMethod
  if (c.takeWord('HASH')) {
    out = { method: 'HASH', expr: parenthesised(c, options) }
  } else if (c.takeWord('KEY')) {
    let algorithm: number | undefined
    if (c.takeWord('ALGORITHM')) {
      c.expectOp('=')
      const t = c.peek()
      if (t.kind !== TOKEN.NUMBER || (t.text !== '1' && t.text !== '2')) c.fail()
      c.skip()
      algorithm = Number(t.text)
    }
    out = { method: 'KEY', ...opt('algorithm', algorithm), columns: nameList(c) }
  } else if (top && !linear && (c.atWord('RANGE') || c.atWord('LIST'))) {
    const method = c.take().text.toUpperCase() as 'RANGE' | 'LIST'
    out = c.takeWord('COLUMNS') ? { method, columns: nameList(c) } : { method, expr: parenthesised(c, options) }
  } else {
    return c.fail()
  }
  if (c.takeWord(countWord)) out = { ...out, count: Number(ulongValue(c, 0xffffffff)) }
  return linear ? { linear, ...out } : out
}

function partitionDefinition(c: Cursor, options: DdlOptions): PartitionDefinition {
  c.expectWord('PARTITION')
  const name = c.expectIdentifier()
  let lessThan: Expression[] | undefined
  let values: Expression[] | undefined
  if (c.takeWords('VALUES', 'LESS', 'THAN')) {
    lessThan = c.atWord('MAXVALUE') ? [maxValue(c)] : valueList(c, options)
  } else if (c.takeWords('VALUES', 'IN')) {
    values = valueList(c, options)
  }
  const own = partitionOptions(c)
  let subpartitions: { name: string; options: Record<string, string> }[] | undefined
  if (c.takeOp('(')) {
    subpartitions = []
    do {
      c.expectWord('SUBPARTITION')
      subpartitions.push({ name: c.expectIdentifier(), options: partitionOptions(c) })
    } while (c.takeOp(','))
    c.expectOp(')')
  }
  return {
    name,
    ...opt('lessThan', lessThan),
    ...opt('in', values),
    options: own,
    ...opt('subpartitions', subpartitions),
  }
}

/**
 * A partition's options, keyed by canonical name as table options are.
 * `STORAGE ENGINE` is `ENGINE`, and the `=` is optional throughout.
 */
function partitionOptions(c: Cursor): Record<string, string> {
  const out: Record<string, string> = {}
  for (;;) {
    let name: string | undefined
    if (c.takeWords('STORAGE', 'ENGINE') || c.takeWord('ENGINE')) name = 'ENGINE'
    else if (c.takeWords('DATA', 'DIRECTORY')) name = 'DATA DIRECTORY'
    else if (c.takeWords('INDEX', 'DIRECTORY')) name = 'INDEX DIRECTORY'
    else for (const word of ['COMMENT', 'MAX_ROWS', 'MIN_ROWS', 'TABLESPACE', 'NODEGROUP']) if (name === undefined && c.takeWord(word)) name = word
    if (name === undefined) return out
    c.takeOp('=')
    out[name] = nameOrString(c)
  }
}

/** `(v, …)`, where an item may be `MAXVALUE` or a row `(a, b)`. */
function valueList(c: Cursor, options: DdlOptions): Expression[] {
  c.expectOp('(')
  const out: Expression[] = []
  do out.push(c.atWord('MAXVALUE') ? maxValue(c) : parseExpressionFrom(c, options.sqlMode))
  while (c.takeOp(','))
  c.expectOp(')')
  return out
}

function maxValue(c: Cursor): Expression {
  const at = c.peek().start
  c.expectWord('MAXVALUE')
  return { kind: NODE.KEYWORD, word: 'MAXVALUE', at }
}

function parenthesised(c: Cursor, options: DdlOptions): Expression {
  c.expectOp('(')
  const expr = parseExpressionFrom(c, options.sqlMode)
  c.expectOp(')')
  return expr
}

/** `(a, b)`, possibly empty: `KEY ()` partitions by the primary key. */
function nameList(c: Cursor): string[] {
  c.expectOp('(')
  const out: string[] = []
  if (!c.atOp(')')) {
    do out.push(c.expectIdentifier())
    while (c.takeOp(','))
  }
  c.expectOp(')')
  return out
}

