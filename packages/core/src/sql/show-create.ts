// M5.9 — SHOW CREATE TABLE, as 8.4.11 writes it, byte for byte.
//
// A column's type is COLUMNS' COLUMN_TYPE (`typeFacts`), and its keys and
// constraints are the definition's. What the probes taught, beyond the type:
//
//   - A literal default is the value as the column stores it, quoted, a
//     number too (`DEFAULT '1.50'`); a BIT's is `b'101'`; CURRENT_TIMESTAMP is
//     bare; any other expression is printed and parenthesized again
//     (`DEFAULT ((1 + 2))`). A nullable column with no default says
//     `DEFAULT NULL`, except a TEXT or BLOB, which says nothing; a nullable
//     TIMESTAMP says `NULL` before it.
//   - A column's CHARACTER SET and COLLATE appear, both, only when its
//     collation is not the table's.
//   - Keys in `sort_keys` order: PRIMARY, then UNIQUE keys with no nullable
//     part, then other UNIQUE keys, then those with a prefix part, then the
//     rest, each group in the order the keys were made. Foreign keys, then
//     CHECK constraints, each in name order; a CHECK that is not enforced
//     says so in a versioned comment.
//   - The table's COLLATE appears unless it is its character set's primary
//     collation, and always for utf8mb4_0900_ai_ci. AUTO_INCREMENT appears
//     when the table has such a column and its counter is past 1.
import { CHARSET_BINARY, FIELD_TYPE } from '@myjs/bytes'
import { requireCollationInfo } from '@myjs/charsets'
import type { ColumnDef, IndexDef, Table, TableDef } from '@myjs/engine'
import { NODE, parseExpression, type Expression } from '@myjs/parser'
import { checksOf } from './checks.ts'
import { foreignKeysOf, referenceText } from './foreign-keys.ts'
import { fulltextOf } from './fulltext.ts'
import { isTemporary } from './temporary.ts'
import { columnDefault, generatedDefault, tableCollation, typeFacts } from './information-schema.ts'
import { escapeString, printExpression } from './print.ts'
import type { Run } from './query.ts'

const q = (name: string): string => `\`${name.replace(/`/g, '``')}\``
/** sql_show.cc's append_unescaped: NUL, newline, CR and backslash escaped, a quote doubled. */
const quoted = (s: string): string => `'${s.replace(/[\0\n\r\\']/g, (ch) => UNESCAPED[ch] as string)}'`
const UNESCAPED: Readonly<Record<string, string>> = { '\0': '\\0', '\n': '\\n', '\r': '\\r', '\\': '\\\\', "'": "''" }

const BLOBS: ReadonlySet<number> = new Set([FIELD_TYPE.TINY_BLOB, FIELD_TYPE.BLOB, FIELD_TYPE.MEDIUM_BLOB, FIELD_TYPE.LONG_BLOB])

/** A collation the character set's own default, and not utf8mb4_0900_ai_ci: COLLATE is left unsaid. */
function isPrimary(id: number): boolean {
  const info = requireCollationInfo(id)
  return info.isDefault && info.name !== 'utf8mb4_0900_ai_ci'
}

function defaultClause(run: Run, c: ColumnDef): string {
  const text = c.attributes?.['default']
  if (typeof text !== 'string') {
    if (!c.nullable || BLOBS.has(c.type.type) || c.attributes?.['noDefault'] === true) return ''
    return ' DEFAULT NULL'
  }
  const generated = generatedDefault(text)
  if (generated !== undefined) return ` DEFAULT ${generated}`
  let e: Expression
  try {
    e = parseExpression(text)
  } catch {
    return ` DEFAULT ${quoted(text)}`
  }
  const literal = e.kind === NODE.LITERAL || (e.kind === NODE.UNARY && e.op === '-' && e.operand.kind === NODE.LITERAL)
  if (literal && c.attributes?.['defaultExpression'] !== true) {
    if (e.kind === NODE.LITERAL && e.type === 'null') return ' DEFAULT NULL'
    const stored = columnDefault(run, c)
    if (stored === null) return ' DEFAULT NULL'
    if (c.type.type === FIELD_TYPE.BIT) return ` DEFAULT b'${BigInt(stored).toString(2)}'`
    return ` DEFAULT ${quoted(stored)}`
  }
  const charset = requireCollationInfo(run.env.session.characterSet).charset
  try {
    return ` DEFAULT (${printExpression(e, { column: (parts) => q(parts[parts.length - 1] as string), string: (v, cs) => `_${cs ?? charset}'${escapeString(v)}'`, source: text })})`
  } catch {
    return ` DEFAULT (${text})`
  }
}

function columnLine(run: Run, def: TableDef, c: ColumnDef): string {
  const facts = typeFacts(c)
  let out = `  ${q(c.name)} ${facts.columnType}`
  const id = c.type.collationId
  if (id !== undefined && id !== CHARSET_BINARY && id !== tableCollation(def)) {
    const info = requireCollationInfo(id)
    out += ` CHARACTER SET ${info.charset} COLLATE ${info.name}`
  }
  if (!c.nullable) out += ' NOT NULL'
  else if (c.type.type === FIELD_TYPE.TIMESTAMP) out += ' NULL'
  if (c.autoIncrement === true) out += ' AUTO_INCREMENT'
  else out += defaultClause(run, c)
  const onUpdate = c.attributes?.['onUpdate']
  if (typeof onUpdate === 'string') out += ` ON UPDATE ${generatedDefault(onUpdate) ?? onUpdate}`
  const comment = c.attributes?.['comment']
  if (typeof comment === 'string') out += ` COMMENT ${quoted(comment)}`
  return out
}

/** The key's place in `sort_keys`' order. */
function keyClass(def: TableDef, index: IndexDef): number {
  if (index.kind === 'primary') return 0
  if (index.kind !== 'unique') return 4
  if (index.parts.some((p) => p.prefix !== undefined)) return 3
  const nullable = index.parts.some((p) => def.columns.find((c) => c.name === p.column)?.nullable === true)
  return nullable ? 2 : 1
}

function keyLine(index: IndexDef): string {
  const parts = index.parts.map((p) => `${q(p.column)}${p.prefix === undefined ? '' : `(${p.prefix})`}${p.descending === true ? ' DESC' : ''}`).join(',')
  if (index.kind === 'primary') return `  PRIMARY KEY (${parts})${keyTail(index)}`
  return `  ${index.kind === 'unique' ? 'UNIQUE KEY' : 'KEY'} ${q(index.name)} (${parts})${keyTail(index)}`
}

/** A key's COMMENT, and its invisibility in a versioned comment (8.4.11: `KEY \`k\` (\`b\`) COMMENT 'x' /*!80000 INVISIBLE *\/`). */
function keyTail(index: { readonly comment?: string; readonly invisible?: true }): string {
  return `${index.comment === undefined ? '' : ` COMMENT ${quoted(index.comment)}`}${index.invisible === true ? ' /*!80000 INVISIBLE */' : ''}`
}

const byName = <T extends { readonly name: string }>(a: T, b: T): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/** The CREATE TABLE text for `def`; `table` gives its AUTO_INCREMENT counter. */
export function showCreateTable(run: Run, def: TableDef, table: Table): string {
  const lines = def.columns.map((c) => columnLine(run, def, c))
  const keys = def.indexes.map((index, i) => ({ index, i })).sort((a, b) => keyClass(def, a.index) - keyClass(def, b.index) || a.i - b.i)
  for (const { index } of keys) lines.push(keyLine(index))
  // FULLTEXT keys sort after every other kind (`sort_keys`).
  for (const f of fulltextOf(def)) lines.push(`  FULLTEXT KEY ${q(f.name)} (${f.columns.map(q).join(',')})${keyTail(f)}`)
  for (const fk of [...foreignKeysOf(def)].sort(byName)) lines.push(`  CONSTRAINT ${q(fk.name)} ${referenceText(fk, def.schema, false)}`)
  for (const c of [...checksOf(def)].sort(byName)) {
    let clause: string
    try {
      clause = printExpression(parseExpression(c.text), { column: (parts) => q(parts[parts.length - 1] as string), string: (v, cs) => `_${cs ?? c.charset}'${escapeString(v)}'`, source: c.text })
    } catch {
      clause = c.text
    }
    lines.push(`  CONSTRAINT ${q(c.name)} CHECK (${clause})${c.enforced ? '' : ' /*!80016 NOT ENFORCED */'}`)
  }
  let options = ` ENGINE=${def.engine === 'memory' ? 'MEMORY' : 'InnoDB'}`
  if (def.columns.some((c) => c.autoIncrement === true)) {
    const next = table.peekAutoIncrement()
    if (next > 1n) options += ` AUTO_INCREMENT=${next}`
  }
  const collation = tableCollation(def)
  const info = requireCollationInfo(collation)
  options += ` DEFAULT CHARSET=${info.charset}`
  if (!isPrimary(collation)) options += ` COLLATE=${info.name}`
  const comment = def.options['comment']
  if (typeof comment === 'string' && comment !== '') options += ` COMMENT=${quoted(comment)}`
  return `CREATE ${isTemporary(def) ? "TEMPORARY " : ""}TABLE ${q(def.name)} (\n${lines.join(',\n')}\n)${options}`
}
