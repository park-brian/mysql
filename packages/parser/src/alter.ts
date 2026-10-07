// M3.5 — `ALTER TABLE` and `CREATE INDEX`.
//
// An `ALTER TABLE` is a comma-separated list of actions, and then table options,
// which may be separated by commas or by nothing: `ENGINE=InnoDB COMMENT='x'`.
// The actions reuse `CREATE TABLE`'s grammar — a column, a key, a check — so
// this file owns only what is new. What a real 8.4.11 settled:
//
//   - `ALTER TABLE t` with no action at all is legal.
//   - Options and actions interleave, but only across a comma: options may
//     run together (`ENGINE=InnoDB COMMENT='x'`), while `COMMENT='x' ADD
//     INDEX (z)` is ER_PARSE_ERROR and `COMMENT='x', ADD INDEX (z)` is not.
//   - `ALTER c SET DEFAULT` takes a literal, a signed number or a
//     parenthesised expression — `SET DEFAULT z + 1` is ER_PARSE_ERROR.
//   - `ADD (a INT, INDEX (a))` takes any table element, not only columns.
//   - `CREATE INDEX` requires a name: `CREATE INDEX ON t (a)` is
//     ER_PARSE_ERROR.
import { unsupportedStatement } from './errors.ts'
import { opt, type Cursor } from './cursor.ts'
import {
  algorithmAndLock,
  defaultExpression,
  indexColumns,
  indexOptions,
  indexType,
  nameOrString,
  tableElement,
  tableOption,
  type DdlOptions,
  type TableElement,
} from './ddl.ts'
import {
  KEY,
  STATEMENT,
  type AlterAction,
  type AlterTableNode,
  type ColumnPosition,
  type KeyType,
} from './statement-ast.ts'

/** `ALTER TABLE …`, with the cursor on `ALTER`. */
export function parseAlterTable(c: Cursor, options: DdlOptions): AlterTableNode {
  const at = c.peek().start
  c.expectWord('ALTER')
  c.expectWord('TABLE')
  const table = c.expectTableName()
  const actions: AlterAction[] = []
  const tableOptions: Record<string, string> = {}

  if (!c.atEnd() && !c.atOp(';')) {
    do {
      if (atPartitioning(c)) break
      if (c.atWord('ALGORITHM') || c.atWord('LOCK')) algorithmAndLock(c)
      else if (tableOption(c, tableOptions)) {
        // Options after the first need no commas between them.
        while (tableOption(c, tableOptions)) continue
      }
      else if (!alterAction(c, options, actions)) c.fail()
    } while (c.takeOp(','))
  }
  // Partition management — `PARTITION BY`, `ADD PARTITION`, `REMOVE
  // PARTITIONING` and a dozen more — is M8.9's, and is named rather than
  // misparsed.
  if (atPartitioning(c)) throw unsupportedStatement('ALTER TABLE … PARTITION')
  return { kind: STATEMENT.ALTER_TABLE, table, actions, options: tableOptions, at }
}

/**
 * `CREATE [UNIQUE | FULLTEXT | SPATIAL] INDEX i [USING t] ON tbl (cols) …`,
 * with the cursor on `CREATE`. It is `ALTER TABLE tbl ADD INDEX`, and is
 * returned as that tree.
 */
export function parseCreateIndex(c: Cursor, options: DdlOptions): AlterTableNode {
  const at = c.peek().start
  c.expectWord('CREATE')
  let type: KeyType = KEY.INDEX
  if (c.takeWord('UNIQUE')) type = KEY.UNIQUE
  else if (c.takeWord('FULLTEXT')) type = KEY.FULLTEXT
  else if (c.takeWord('SPATIAL')) type = KEY.SPATIAL
  const keyAt = c.peek().start
  c.expectWord('INDEX')
  const name = c.expectIdentifier()
  const before = indexType(c)
  c.expectWord('ON')
  const table = c.expectTableName()
  const columns = indexColumns(c, options)
  const rest = indexOptions(c)
  algorithmAndLock(c)
  const using = before ?? rest.using
  const key = {
    type,
    name,
    columns,
    ...opt('using', using),
    ...opt('comment', rest.comment),
    at: keyAt,
  }
  return { kind: STATEMENT.ALTER_TABLE, table, actions: [{ type: 'addKey', key }], options: {}, at }
}

/** One action into `actions` — `ADD (…)` may contribute several — or `false` with nothing consumed. */
function alterAction(c: Cursor, options: DdlOptions, actions: AlterAction[]): boolean {
  if (c.takeWord('ADD')) {
    const column = c.takeWord('COLUMN')
    if (c.takeOp('(')) {
      do actions.push(fromElement(tableElement(c, options)))
      while (c.takeOp(','))
      c.expectOp(')')
      return true
    }
    const element = tableElement(c, options)
    if (column && element.what !== 'column') c.fail()
    actions.push(element.what === 'column' ? { type: 'addColumn', column: element.column, ...position(c) } : fromElement(element))
    return true
  }

  if (c.takeWord('CHANGE')) {
    c.takeWord('COLUMN')
    const name = c.expectIdentifier()
    actions.push(changeColumn(c, options, name))
    return true
  }
  if (c.takeWord('MODIFY')) {
    c.takeWord('COLUMN')
    // `MODIFY c def` is `CHANGE c c def`; the name is read twice, once here.
    const save = c.at
    const name = c.expectIdentifier()
    c.at = save
    actions.push(changeColumn(c, options, name))
    return true
  }

  if (c.takeWord('DROP')) {
    if (c.takeWords('PRIMARY', 'KEY')) actions.push({ type: 'drop', what: 'PRIMARY KEY' })
    else if (c.takeWord('INDEX') || c.takeWord('KEY')) actions.push({ type: 'drop', what: 'INDEX', name: c.expectIdentifier() })
    else if (c.takeWords('FOREIGN', 'KEY')) actions.push({ type: 'drop', what: 'FOREIGN KEY', name: c.expectIdentifier() })
    else if (c.takeWord('CHECK')) actions.push({ type: 'drop', what: 'CHECK', name: c.expectIdentifier() })
    else if (c.takeWord('CONSTRAINT')) actions.push({ type: 'drop', what: 'CONSTRAINT', name: c.expectIdentifier() })
    else {
      c.takeWord('COLUMN')
      actions.push({ type: 'drop', what: 'COLUMN', name: c.expectIdentifier() })
    }
    return true
  }

  if (c.takeWord('ALTER')) {
    if (c.takeWord('INDEX')) {
      const index = c.expectIdentifier()
      actions.push({ type: 'indexVisibility', index, visible: visibility(c) })
      return true
    }
    if (c.atWord('CHECK') || c.atWord('CONSTRAINT')) {
      const what = c.take().text.toUpperCase() as 'CHECK' | 'CONSTRAINT'
      const name = c.expectIdentifier()
      const enforced = !c.takeWord('NOT')
      c.expectWord('ENFORCED')
      actions.push({ type: 'enforce', what, name, enforced })
      return true
    }
    c.takeWord('COLUMN')
    const column = c.expectIdentifier()
    if (c.takeWords('DROP', 'DEFAULT')) actions.push({ type: 'dropDefault', column })
    else if (c.takeWords('SET', 'DEFAULT')) actions.push({ type: 'setDefault', column, value: defaultExpression(c, options, false) })
    else {
      c.expectWord('SET')
      actions.push({ type: 'columnVisibility', column, visible: visibility(c) })
    }
    return true
  }

  if (c.takeWord('RENAME')) {
    if (c.takeWord('COLUMN')) {
      const from = c.expectIdentifier()
      c.expectWord('TO')
      actions.push({ type: 'renameColumn', from, to: c.expectIdentifier() })
    } else if (c.takeWord('INDEX') || c.takeWord('KEY')) {
      const from = c.expectIdentifier()
      c.expectWord('TO')
      actions.push({ type: 'renameIndex', from, to: c.expectIdentifier() })
    } else {
      c.takeWord('TO') || c.takeWord('AS')
      actions.push({ type: 'rename', to: c.expectTableName() })
    }
    return true
  }

  if (c.takeWords('ORDER', 'BY')) {
    const columns = []
    do {
      const name = c.expectIdentifier()
      const desc = c.takeWord('DESC')
      if (!desc) c.takeWord('ASC')
      columns.push(desc ? { name, desc: true as const } : { name })
    } while (c.takeOp(','))
    actions.push({ type: 'orderBy', columns })
    return true
  }

  if (c.takeWords('CONVERT', 'TO')) {
    if (!c.takeWords('CHARACTER', 'SET')) c.expectWord('CHARSET')
    const charset = c.takeWord('DEFAULT') ? undefined : c.takeWord('BINARY') ? 'binary' : nameOrString(c)
    const collation = c.takeWord('COLLATE') ? nameOrString(c) : undefined
    actions.push({
      type: 'convert',
      ...opt('charset', charset),
      ...opt('collation', collation),
    })
    return true
  }

  if (c.atWord('DISABLE') || c.atWord('ENABLE')) {
    const enable = c.take().text.toUpperCase() === 'ENABLE'
    c.expectWord('KEYS')
    actions.push({ type: 'keys', enable })
    return true
  }
  if (c.takeWord('FORCE')) {
    actions.push({ type: 'force' })
    return true
  }
  if (c.atWord('DISCARD') || c.atWord('IMPORT')) {
    const action = c.take().text.toUpperCase() as 'DISCARD' | 'IMPORT'
    c.expectWord('TABLESPACE')
    actions.push({ type: 'tablespace', action })
    return true
  }
  return false
}

/** The start of a partition-management clause. */
function atPartitioning(c: Cursor): boolean {
  if (c.atWord('PARTITION') || c.atWords('REMOVE', 'PARTITIONING')) return true
  return PARTITION_VERBS.some((verb) => c.atWord(verb) && c.atWord('PARTITION', 1))
}

const PARTITION_VERBS = ['ADD', 'DROP', 'DISCARD', 'IMPORT', 'TRUNCATE', 'COALESCE', 'REORGANIZE', 'EXCHANGE', 'ANALYZE', 'CHECK', 'OPTIMIZE', 'REBUILD', 'REPAIR']

function fromElement(element: TableElement): AlterAction {
  if (element.what === 'column') return { type: 'addColumn', column: element.column }
  if (element.what === 'key') return { type: 'addKey', key: element.key }
  return { type: 'addCheck', check: element.check }
}

function changeColumn(c: Cursor, options: DdlOptions, name: string): AlterAction {
  const element = tableElement(c, options)
  if (element.what !== 'column') c.fail()
  return { type: 'changeColumn', name, column: element.column, ...position(c) }
}

function position(c: Cursor): { position?: ColumnPosition } {
  if (c.takeWord('FIRST')) return { position: 'FIRST' }
  if (c.takeWord('AFTER')) return { position: { after: c.expectIdentifier() } }
  return {}
}

function visibility(c: Cursor): boolean {
  if (c.takeWord('VISIBLE')) return true
  c.expectWord('INVISIBLE')
  return false
}
