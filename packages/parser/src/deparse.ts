// M3.3 — an AST back to SQL.
//
// M3.3's acceptance clause is "round-trips through a deparser to semantically
// equivalent SQL", and the deparser is built *before* the grammar it checks so
// that every form lands with its check already in place: the census parses
// each statement, deparses it, parses that, and requires the two trees to be
// equal. A field the parser reads and the tree does not hold — M3.2's `COLLATE`
// name was one — is a field the deparser cannot write back, and the second
// tree comes out different.
//
// Two choices make the output trustworthy rather than merely plausible:
//
//   - **Every operator application is parenthesised.** The deparser contains no
//     precedence table, so it cannot share a precedence mistake with the
//     parser; `(a + (b * c))` means one thing under any table.
//   - **Every name is backticked.** A backtick-quoted name is a name under every
//     `sql_mode` and whatever the reserved-word list says.
//
// String literals are the one place `sql_mode` reaches in here: whether `\` is
// an escape character is `NO_BACKSLASH_ESCAPES`'s decision, so a literal is
// escaped for the mode it will be parsed under.
import { NODE, LITERAL, type Expression, type LiteralNode } from './ast.ts'
import type { DataType } from './data-type.ts'
import { RESERVED } from './keywords.ts'
import { NO_SQL_MODE, type SqlMode } from './sql-mode.ts'
import {
  STATEMENT,
  KEY,
  type CheckConstraint,
  type ColumnDefinition,
  type CreateTableNode,
  type DropNode,
  type IndexColumn,
  type KeyDefinition,
  type Reference,
  type Statement,
  type TableName,
} from './statement-ast.ts'

export interface DeparseOptions {
  /** The mode the output will be parsed under. Only `NO_BACKSLASH_ESCAPES` matters. */
  readonly sqlMode?: SqlMode
}

/** A statement or an expression, as SQL text. */
export function deparse(node: Statement | Expression, options: DeparseOptions = {}): string {
  const d = new Deparser(options.sqlMode ?? NO_SQL_MODE)
  return isStatement(node) ? d.statement(node) : d.expr(node)
}

const STATEMENT_KINDS: ReadonlySet<string> = new Set(Object.values(STATEMENT))
const isStatement = (node: Statement | Expression): node is Statement => STATEMENT_KINDS.has(node.kind)

/** A backtick-quoted name, with any backtick inside it doubled. */
export function quoteName(name: string): string {
  return '`' + name.replaceAll('`', '``') + '`'
}

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

class Deparser {
  readonly #mode: SqlMode

  constructor(mode: SqlMode) {
    this.#mode = mode
  }

  // --- literals and names ---------------------------------------------------

  string(value: string): string {
    const body = this.#mode.noBackslashEscapes ? value : value.replaceAll('\\', '\\\\')
    return "'" + body.replaceAll("'", "''") + "'"
  }

  /**
   * A word the parser will read back as the same text: bare when it is a plain,
   * unreserved word, otherwise quoted. For option values, whose spelling the
   * tree keeps and whose quoting it does not.
   */
  word(value: string): string {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) && !RESERVED.has(value.toUpperCase()) ? value : this.string(value)
  }

  table(t: TableName): string {
    return t.schema === undefined ? quoteName(t.name) : `${quoteName(t.schema)}.${quoteName(t.name)}`
  }

  literal(e: LiteralNode): string {
    let body: string
    switch (e.type) {
      case LITERAL.INT:
      case LITERAL.DECIMAL:
        body = String(e.value)
        break
      case LITERAL.DOUBLE: {
        // An exponent is what makes a literal a DOUBLE rather than a DECIMAL,
        // so it must survive: `1.5e0` written back as `1.5` is a different type.
        const n = e.value as number
        body = Number.isFinite(n) ? n.toExponential() : '1e999'
        break
      }
      case LITERAL.STRING:
        body = this.string(e.value as string)
        break
      case LITERAL.HEX:
        body = `X'${hex(e.value as Uint8Array)}'`
        break
      case LITERAL.BIT:
        body = `b'${(e.value as bigint).toString(2)}'`
        break
      case LITERAL.NULL:
        body = 'NULL'
        break
      case LITERAL.BOOL:
        body = e.value === true ? 'TRUE' : 'FALSE'
        break
      case LITERAL.TEMPORAL:
        body = `${e.unit} ${this.string(e.value as string)}`
        break
    }
    const introduced = e.charset === undefined ? body : `_${e.charset}${body}`
    return e.collation === undefined ? introduced : `${introduced} COLLATE ${quoteName(e.collation)}`
  }

  // --- expressions ----------------------------------------------------------

  expr(e: Expression): string {
    switch (e.kind) {
      case NODE.LITERAL:
        return this.literal(e)
      case NODE.PLACEHOLDER:
        return '?'
      case NODE.COLUMN:
        return e.parts.map((p, i) => (p === '*' && i === e.parts.length - 1 ? '*' : quoteName(p))).join('.')
      case NODE.VARIABLE: {
        // `@a` stays as written; `@'a b'` is re-quoted. A system variable is
        // never quoted: `@@session.sql_mode` is three tokens' worth of name.
        const prefix = e.name.startsWith('@@') ? '@@' : '@'
        const name = e.name.slice(prefix.length)
        return prefix === '@@' || /^[A-Za-z0-9_$.]+$/.test(name) ? e.name : prefix + quoteName(name)
      }
      case NODE.UNARY:
        // `IS NULL` and its siblings are postfix; everything else is prefix.
        if (e.op.startsWith('IS ')) return `(${this.expr(e.operand)} ${e.op})`
        return `(${e.op} ${this.expr(e.operand)})`
      case NODE.BINARY:
        return this.binary(e.op, e.left, e.right, e.extra)
      case NODE.CALL: {
        const args =
          e.args.length === 1 && e.args[0]!.kind === NODE.COLUMN && e.args[0]!.parts.length === 1 && e.args[0]!.parts[0] === '*'
            ? '*'
            : e.args.map((a) => this.expr(a)).join(', ')
        return `${e.name}(${e.distinct === true ? 'DISTINCT ' : ''}${args})`
      }
      case NODE.CASE: {
        const parts = ['CASE']
        if (e.operand !== undefined) parts.push(this.expr(e.operand))
        for (const w of e.whens) parts.push(`WHEN ${this.expr(w.when)} THEN ${this.expr(w.then)}`)
        if (e.else !== undefined) parts.push(`ELSE ${this.expr(e.else)}`)
        parts.push('END')
        return parts.join(' ')
      }
      case NODE.ROW:
        return `(${e.items.map((i) => this.expr(i)).join(', ')})`
      case NODE.INTERVAL:
        // Not parenthesised: `INTERVAL` is grammar beside `+` and `-`, not an
        // expression that can stand in parentheses on its own.
        return `INTERVAL ${this.expr(e.value)} ${e.unit}`
      case NODE.COLLATE:
        return `(${this.expr(e.expr)} COLLATE ${quoteName(e.collation)})`
    }
  }

  binary(op: string, left: Expression, right: Expression, extra: Expression | readonly Expression[] | undefined): string {
    const l = this.expr(left)
    switch (op) {
      case 'BETWEEN':
      case 'NOT BETWEEN':
        return `(${l} ${op} ${this.expr(right)} AND ${this.expr(extra as Expression)})`
      case 'LIKE':
      case 'NOT LIKE':
        return extra === undefined
          ? `(${l} ${op} ${this.expr(right)})`
          : `(${l} ${op} ${this.expr(right)} ESCAPE ${this.expr(extra as Expression)})`
      case 'IN':
      case 'NOT IN':
        // The right side is always a row here, written as the list itself — a
        // one-item list included, which a bare `this.expr` would lose.
        return right.kind === NODE.ROW
          ? `(${l} ${op} (${right.items.map((i) => this.expr(i)).join(', ')}))`
          : `(${l} ${op} ${this.expr(right)})`
      default:
        return `(${l} ${op} ${this.expr(right)})`
    }
  }

  // --- statements -----------------------------------------------------------

  statement(s: Statement): string {
    switch (s.kind) {
      case STATEMENT.CREATE_TABLE:
        return this.createTable(s)
      case STATEMENT.DROP:
        return this.drop(s)
    }
  }

  createTable(s: CreateTableNode): string {
    const head = `CREATE ${s.temporary === true ? 'TEMPORARY ' : ''}TABLE ${s.ifNotExists === true ? 'IF NOT EXISTS ' : ''}${this.table(s.table)}`
    if (s.like !== undefined) return `${head} LIKE ${this.table(s.like)}`
    const elements = [
      ...s.columns.map((c) => this.column(c)),
      ...s.keys.map((k) => this.key(k)),
      ...s.checks.map((c) => this.check(c)),
    ]
    const body = elements.length === 0 ? '' : ` (${elements.join(', ')})`
    const options = this.tableOptions(s.options)
    return `${head}${body}${options === '' ? '' : ' ' + options}`
  }

  dataType(t: DataType): string {
    if (t.serial === true) return 'SERIAL'
    const out = [t.name]
    if (t.values !== undefined) {
      out[0] += `(${t.values.map((v) => (typeof v === 'string' ? this.string(v) : `X'${hex(v)}'`)).join(', ')})`
    } else if (t.length !== undefined) {
      out[0] += t.scale === undefined ? `(${t.length})` : `(${t.length}, ${t.scale})`
    }
    // ZEROFILL implies UNSIGNED, and the parser records both; writing both back
    // is harmless and keeps this a field-by-field transcription.
    if (t.unsigned === true) out.push('UNSIGNED')
    if (t.unsigned === false) out.push('SIGNED')
    if (t.zerofill === true) out.push('ZEROFILL')
    if (t.charset !== undefined) out.push(`CHARACTER SET ${this.charsetName(t.charset)}`)
    if (t.collation !== undefined) out.push(`COLLATE ${this.charsetName(t.collation)}`)
    if (t.binary === true) out.push('BINARY')
    return out.join(' ')
  }

  /** `DEFAULT` is the keyword, not a charset named "default". */
  charsetName(name: string): string {
    return name === 'default' ? 'DEFAULT' : quoteName(name)
  }

  column(c: ColumnDefinition): string {
    const out = [quoteName(c.name), this.dataType(c.type)]
    // SERIAL implies these three, and the parser sets them; writing them again
    // after `SERIAL` is legal and changes nothing.
    if (c.notNull === true) out.push('NOT NULL')
    if (c.nullable === true) out.push('NULL')
    if (c.default !== undefined) out.push(`DEFAULT ${this.defaultValue(c.default)}`)
    if (c.onUpdate !== undefined) out.push(`ON UPDATE ${this.defaultValue(c.onUpdate)}`)
    if (c.autoIncrement === true) out.push('AUTO_INCREMENT')
    if (c.unique === true) out.push('UNIQUE KEY')
    if (c.primary === true) out.push('PRIMARY KEY')
    if (c.comment !== undefined) out.push(`COMMENT ${this.string(c.comment)}`)
    if (c.generated !== undefined) out.push(`GENERATED ALWAYS AS (${this.expr(c.generated.expr)}) ${c.generated.stored ? 'STORED' : 'VIRTUAL'}`)
    if (c.invisible === true) out.push('INVISIBLE')
    if (c.invisible === false) out.push('VISIBLE')
    if (c.srid !== undefined) out.push(`SRID ${c.srid}`)
    if (c.check !== undefined) out.push(`CHECK (${this.expr(c.check)})`)
    return out.join(' ')
  }

  /**
   * A `DEFAULT` or `ON UPDATE` value. A literal, a signed number or a
   * `NOW()`-family call may stand bare; anything else needs the parentheses
   * 8.0.13 made part of the syntax.
   */
  defaultValue(e: Expression): string {
    if (e.kind === NODE.LITERAL) return this.literal(e)
    if (e.kind === NODE.UNARY && (e.op === '-' || e.op === '+') && e.operand.kind === NODE.LITERAL) return this.expr(e)
    if (e.kind === NODE.CALL && DEFAULT_FUNCTIONS.has(e.name.toUpperCase())) return this.expr(e)
    return `(${this.expr(e)})`
  }

  indexColumns(columns: readonly IndexColumn[]): string {
    return `(${columns
      .map((col) => {
        const body =
          col.expr !== undefined
            ? `(${this.expr(col.expr)})`
            : `${quoteName(col.name as string)}${col.length === undefined ? '' : `(${col.length})`}`
        return col.desc === true ? `${body} DESC` : body
      })
      .join(', ')})`
  }

  key(k: KeyDefinition): string {
    const out: string[] = []
    if (k.constraint !== undefined) out.push(`CONSTRAINT ${quoteName(k.constraint)}`)
    out.push(KEY_WORDS[k.type])
    if (k.name !== undefined) out.push(quoteName(k.name))
    out.push(this.indexColumns(k.columns))
    if (k.references !== undefined) out.push(this.references(k.references))
    if (k.using !== undefined) out.push(`USING ${k.using}`)
    if (k.comment !== undefined) out.push(`COMMENT ${this.string(k.comment)}`)
    return out.join(' ')
  }

  references(r: Reference): string {
    const out = [`REFERENCES ${this.table(r.table)}`]
    if (r.columns.length > 0) out.push(this.indexColumns(r.columns))
    if (r.match !== undefined) out.push(`MATCH ${r.match}`)
    if (r.onDelete !== undefined) out.push(`ON DELETE ${r.onDelete}`)
    if (r.onUpdate !== undefined) out.push(`ON UPDATE ${r.onUpdate}`)
    return out.join(' ')
  }

  check(c: CheckConstraint): string {
    const name = c.name === undefined ? '' : `CONSTRAINT ${quoteName(c.name)} `
    return `${name}CHECK (${this.expr(c.expr)})${c.enforced ? '' : ' NOT ENFORCED'}`
  }

  tableOptions(options: Readonly<Record<string, string>>): string {
    const out: string[] = []
    for (const [name, value] of Object.entries(options)) {
      if (name === 'START TRANSACTION') out.push(name)
      else if (name === 'UNION') out.push(`UNION = (${value.split(',').map(quoteName).join(', ')})`)
      else if (STRING_OPTIONS.has(name)) out.push(`${name} = ${this.string(value)}`)
      else if (name === 'CHARACTER SET' || name === 'COLLATE') out.push(`${name} = ${value.toLowerCase() === 'default' ? 'DEFAULT' : this.word(value)}`)
      else out.push(`${name} = ${/^\d+$/.test(value) ? value : this.word(value)}`)
    }
    return out.join(' ')
  }

  drop(s: DropNode): string {
    const out = ['DROP']
    if (s.temporary === true) out.push('TEMPORARY')
    out.push(s.object)
    if (s.ifExists === true) out.push('IF EXISTS')
    out.push(s.names.map((n) => this.table(n)).join(', '))
    if (s.on !== undefined) out.push(`ON ${this.table(s.on)}`)
    if (s.behaviour !== undefined) out.push(s.behaviour)
    return out.join(' ')
  }
}

const KEY_WORDS = {
  [KEY.PRIMARY]: 'PRIMARY KEY',
  [KEY.UNIQUE]: 'UNIQUE KEY',
  [KEY.INDEX]: 'KEY',
  [KEY.FULLTEXT]: 'FULLTEXT KEY',
  [KEY.SPATIAL]: 'SPATIAL KEY',
  [KEY.FOREIGN]: 'FOREIGN KEY',
} as const

/** The functions a `DEFAULT` may name without parentheses around it. */
const DEFAULT_FUNCTIONS = new Set(['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'UTC_TIMESTAMP'])

/** Table options MySQL's grammar types as a string literal rather than a word. */
const STRING_OPTIONS = new Set([
  'COMMENT', 'CONNECTION', 'PASSWORD', 'DATA DIRECTORY', 'INDEX DIRECTORY', 'COMPRESSION', 'ENCRYPTION',
  'ENGINE_ATTRIBUTE', 'SECONDARY_ENGINE_ATTRIBUTE',
])
