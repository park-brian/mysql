// M5.25 — ALTER TABLE: the actions an ORM's migrations send, by copying.
//
// Every ALTER here is `Catalog.rebuildTable`: the table made again from the
// changed definition, its rows copied through, in one DDL. MySQL would do
// most of these in place, and a client cannot tell the difference except by
// what it is told, which is MySQL's: "Records: n" counts the rows copied only
// when MySQL copies too — an ALTER that adds a foreign key with the checks on
// — and is 0 otherwise (8.4.11).
//
// The actions, in the order MySQL applies them whatever order they are
// written in: drops, then columns, then indexes, then foreign keys. One not
// here is refused by name.
import { sqlError, messages, type OkResult } from '@myjs/protocol'
import type { Catalog, ColumnDef, FieldBytes, IndexDef, TableDef, TableSpec } from '@myjs/engine'
import { KEY, type AlterAction, type AlterTableNode, type ColumnDefinition } from '@myjs/parser'
import type { StoreContext } from '@myjs/types'
import { encodeField } from '@myjs/types'
import { column as columnDef, DEFAULT_COLLATION } from './ddl.ts'
import { checker, checksOf, checkViolated, withChecks, type CheckDef } from './checks.ts'
import { defaultOf, implicitDefault } from './dml.ts'
import { checkParentOf, foreignKeyChecks, foreignKeyClause, foreignKeysOf, referencedIndex, referencingKeys, supportingIndex, withForeignKeys, type ForeignKeyClause } from './foreign-keys.ts'
import type { Run } from './query.ts'

const notSupported = (what: string) => sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what))
const cantDrop = (name: string) => sqlError('ER_CANT_DROP_FIELD_OR_KEY', `Can't DROP '${name}'; check that column/key exists`)

const ACTION_NAMES: Readonly<Record<string, string>> = {
  changeColumn: 'ALTER TABLE … CHANGE / MODIFY COLUMN',
  setDefault: 'ALTER TABLE … ALTER COLUMN … SET DEFAULT',
  dropDefault: 'ALTER TABLE … ALTER COLUMN … DROP DEFAULT',
  columnVisibility: 'Invisible columns',
  indexVisibility: 'Invisible indexes',
  rename: 'ALTER TABLE … RENAME',
  renameColumn: 'ALTER TABLE … RENAME COLUMN',
  renameIndex: 'ALTER TABLE … RENAME INDEX',
  orderBy: 'ALTER TABLE … ORDER BY',
  convert: 'ALTER TABLE … CONVERT TO CHARACTER SET',
  keys: 'ALTER TABLE … ENABLE / DISABLE KEYS',
  force: 'ALTER TABLE … FORCE',
  tablespace: 'ALTER TABLE … TABLESPACE',
}

export function alterTable(run: Run, catalog: Catalog, statement: AlterTableNode): OkResult {
  const schema = statement.table.schema ?? run.env.session.database
  if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
  if (Object.keys(statement.options).length > 0) throw notSupported('ALTER TABLE table options')
  // DDL: an implicit commit first, as every DDL statement makes.
  run.state.commit()
  const def = catalog.definition(schema, statement.table.name)
  for (const a of statement.actions) {
    const named = ACTION_NAMES[a.type]
    if (named !== undefined) throw notSupported(named)
    if (a.type === 'drop' && (a.what === 'COLUMN' || a.what === 'PRIMARY KEY')) throw notSupported(`ALTER TABLE … DROP ${a.what}`)
    if (a.type === 'addKey' && (a.key.type === KEY.PRIMARY || a.key.type === KEY.FULLTEXT || a.key.type === KEY.SPATIAL)) throw notSupported(`ALTER TABLE … ADD ${a.key.type.toUpperCase()} KEY`)
    if (a.type === 'addColumn' && (a.column.autoIncrement === true || a.column.primary === true || a.column.type.serial === true)) throw notSupported('ALTER TABLE … ADD an AUTO_INCREMENT or PRIMARY KEY column')
  }
  const tableCollation = typeof def.options['collationId'] === 'number' ? (def.options['collationId'] as number) : DEFAULT_COLLATION
  const of = <T extends AlterAction['type']>(type: T) => statement.actions.filter((a): a is Extract<AlterAction, { type: T }> => a.type === type)

  // --- drops ---
  let foreignKeys = foreignKeysOf(def)
  let indexes: IndexDef[] = [...def.indexes]
  let checkDefs: CheckDef[] = checksOf(def)
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
  for (const a of of('drop')) {
    const name = a.name as string
    if (a.what === 'CHECK' || (a.what === 'CONSTRAINT' && checkDefs.some((c) => same(c.name, name)))) {
      if (!checkDefs.some((c) => same(c.name, name))) throw sqlError('ER_CHECK_CONSTRAINT_NOT_FOUND', `Check constraint '${name}' is not found in the table.`)
      checkDefs = checkDefs.filter((c) => !same(c.name, name))
      continue
    }
    // DROP CONSTRAINT names a constraint of any kind (8.4.11: 3940 when none is).
    if (a.what === 'CONSTRAINT') {
      if (foreignKeys.some((fk) => same(fk.name, name))) foreignKeys = foreignKeys.filter((fk) => !same(fk.name, name))
      else if (indexes.some((i) => i.kind === 'unique' && same(i.name, name))) indexes = indexes.filter((i) => !same(i.name, name))
      else throw sqlError('ER_CONSTRAINT_NOT_FOUND', `Constraint '${name}' does not exist.`)
      continue
    }
    if (a.what === 'FOREIGN KEY') {
      if (!foreignKeys.some((fk) => fk.name.toLowerCase() === name.toLowerCase())) throw cantDrop(name)
      foreignKeys = foreignKeys.filter((fk) => fk.name.toLowerCase() !== name.toLowerCase())
      continue
    }
    if (!indexes.some((i) => i.name.toLowerCase() === name.toLowerCase())) throw cantDrop(name)
    indexes = indexes.filter((i) => i.name.toLowerCase() !== name.toLowerCase())
  }
  // An index a foreign key needs, and no other serves, stays (1553): the
  // child's own keys need theirs, and the keys that reference this table
  // need its UNIQUE key on their columns.
  for (const a of of('drop')) {
    if (a.what !== 'INDEX' && a.what !== 'CONSTRAINT') continue
    const refuse = () => sqlError('ER_DROP_INDEX_FK', `Cannot drop index '${a.name as string}': needed in a foreign key constraint`)
    for (const fk of foreignKeys) if (supportingIndex(indexes, fk.columns) === undefined) throw refuse()
    for (const { fk } of referencingKeys(catalog, schema, def.name)) if (referencedIndex({ indexes }, fk.references.columns) === undefined) throw refuse()
  }

  // --- columns ---
  const columns: ColumnDef[] = [...def.columns]
  /** For each new column, where its value comes from: an old column's position, or its default. */
  let sources: (number | ColumnDef)[] = def.columns.map((_, i) => i)
  const added: ColumnDefinition[] = []
  for (const a of of('addColumn')) {
    if (columns.some((c) => c.name.toLowerCase() === a.column.name.toLowerCase())) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${a.column.name}'`)
    const made = columnDef(a.column, tableCollation, false)
    let at = columns.length
    if (a.position === 'FIRST') at = 0
    else if (a.position !== undefined) {
      const after = a.position.after
      const i = columns.findIndex((c) => c.name.toLowerCase() === after.toLowerCase())
      if (i < 0) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(after, 'table definition'))
      at = i + 1
    }
    columns.splice(at, 0, made)
    sources = [...sources.slice(0, at), made, ...sources.slice(at)]
    added.push(a.column)
  }

  // --- indexes ---
  const names = new Set(indexes.map((i) => i.name.toLowerCase()))
  const nameFor = (wanted: string | undefined, first: string): string => {
    if (wanted !== undefined) {
      if (names.has(wanted.toLowerCase())) throw sqlError('ER_DUP_KEYNAME', `Duplicate key name '${wanted}'`)
      names.add(wanted.toLowerCase())
      return wanted
    }
    let name = first
    for (let i = 2; names.has(name.toLowerCase()) || name.toUpperCase() === 'PRIMARY'; i++) name = `${first}_${i}`
    names.add(name.toLowerCase())
    return name
  }
  const known = (name: string): string => {
    const c = columns.find((col) => col.name.toLowerCase() === name.toLowerCase())
    if (c === undefined) throw sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', `Key column '${name}' doesn't exist in table`)
    return c.name
  }
  for (const c of added) if (c.unique === true) indexes.push({ name: nameFor(undefined, c.name), kind: 'unique', parts: [{ column: c.name }] })
  const clauses: ForeignKeyClause[] = []
  for (const a of of('addKey')) {
    const k = a.key
    if (k.type === KEY.FOREIGN) {
      clauses.push(foreignKeyClause(k))
      continue
    }
    const parts = k.columns.map((p) => {
      if (p.name === undefined) throw notSupported('Functional key parts')
      return { column: known(p.name), ...(p.length === undefined ? {} : { prefix: p.length }), ...(p.desc === true ? { descending: true } : {}) }
    })
    indexes.push({ name: nameFor(k.name ?? k.constraint, (parts[0] as { column: string }).column), kind: k.type === KEY.UNIQUE ? 'unique' : 'index', parts })
  }

  // --- foreign keys ---
  const checks = foreignKeyChecks(run)
  const options: Record<string, unknown> = { ...def.options }
  if (foreignKeys.length > 0) options['foreignKeys'] = foreignKeys
  else delete options['foreignKeys']
  // CHECK constraints: switched on or off, then the new ones, a column's own included.
  const enabled = new Set<string>()
  for (const a of of('enforce')) {
    const target = checkDefs.find((c) => same(c.name, a.name))
    if (target === undefined) {
      if (a.what === 'CHECK') throw sqlError('ER_CHECK_CONSTRAINT_NOT_FOUND', `Check constraint '${a.name}' is not found in the table.`)
      throw sqlError('ER_CONSTRAINT_NOT_FOUND', `Constraint '${a.name}' does not exist.`)
    }
    if (a.enforced && !target.enforced) enabled.add(target.name)
    checkDefs = checkDefs.map((c) => (c === target ? { ...c, enforced: a.enforced } : c))
  }
  if (checkDefs.length > 0) options['checks'] = checkDefs
  else delete options['checks']
  const checkClausesAdded = [...of('addCheck').map((a) => a.check), ...added.flatMap((c) => (c.check === undefined ? [] : [c.check]))].sort((x, y) => x.at - y.at)
  const withNewChecks = withChecks(catalog, schema, { name: def.name, engine: def.engine, columns, indexes, options }, run.sql, checkClausesAdded, run.env.session.characterSet)
  for (const c of checksOf(withNewChecks).slice(checkDefs.length)) if (c.enforced) enabled.add(c.name)
  const spec = withForeignKeys(catalog, schema, withNewChecks, clauses, checks)
  const before = new Set(foreignKeys.map((fk) => fk.name))
  const made = foreignKeysOf({ ...def, ...spec, options: spec.options ?? {} } as TableDef).filter((fk) => !before.has(fk.name))

  // --- the copy ---
  const store: StoreContext = { strict: false, row: 1, warnings: 0, table: def.name }
  const fill = sources.map((s) => (typeof s === 'number' ? undefined : defaultOf(run, s)))
  // The rows a new key is checked on are the copy's, under MySQL's temporary name.
  const shownAs = `#sql-0_${run.env.session.connectionId.toString(16)}`
  const check = checks && made.length > 0 ? checkParentOf(catalog) : undefined
  const checked = { ...def, columns, name: shownAs } as TableDef
  // A constraint added or switched on is checked on every row there (3819).
  const violation = enabled.size > 0 ? checker(run, { ...def, columns, indexes: def.indexes, options: spec.options ?? {} } as TableDef) : undefined
  let records = 0
  catalog.rebuildTable(schema, def.name, spec, (row) => {
    records++
    store.row = records
    const out: FieldBytes[] = sources.map((s, i) => {
      if (typeof s === 'number') return row[s] ?? null
      const d = fill[i]
      const value = d === undefined || d === 'none' ? implicitDefault(s) : d.eval([], run.env)
      return encodeField(value === null && !s.nullable ? implicitDefault(s) : value, s, store)
    })
    if (check !== undefined) {
      for (const fk of made) check(checked, fk, out)
    }
    const violated = violation?.(out)
    if (violated !== undefined) throw checkViolated(violated)
    return out
  })
  // "Records" counts the rows only where MySQL copies too: a key or a
  // constraint the rows must be checked against.
  const copied = (checks && made.length > 0) || enabled.size > 0 ? records : 0
  return { affectedRows: copied, info: `Records: ${copied}  Duplicates: 0  Warnings: 0` }
}
