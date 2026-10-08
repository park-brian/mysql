// M5.25, M5.27 — ALTER TABLE: the actions an ORM's migrations send, by copying.
//
// Every ALTER here is `Catalog.rebuildTable`: the table made again from the
// changed definition, its rows copied through, in one DDL. MySQL would do
// most of these in place, and a client cannot tell the difference except by
// what it is told, which is MySQL's: "Records: n" counts the rows copied only
// when MySQL copies too — a foreign key added with the checks on, a
// constraint switched on, a column retyped other than a VARCHAR made longer,
// the primary key's columns changed — and is 0 otherwise (8.4.11).
//
// The actions, in the order MySQL applies them whatever order they are
// written in: drops, then columns changed and renamed, then what names them
// (keys, foreign keys on both sides, CHECKs, FULLTEXT), then keys renamed,
// columns added, indexes and foreign keys added. One not here is refused by
// name.
import { FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { sqlError, messages, type OkResult } from '@myjs/protocol'
import type { Catalog, ColumnDef, FieldBytes, IndexDef, TableDef, TableSpec } from '@myjs/engine'
import { KEY, NODE, deparse, type AlterAction, type AlterTableNode, type ColumnDefinition, type Expression } from '@myjs/parser'
import { decodeField, encodeField, type StoreContext, type Value } from '@myjs/types'
import type { Compiled } from './compile.ts'
import { column as columnDef, columnDeprecations, DEFAULT_COLLATION, duplicateKeys } from './ddl.ts'
import { checker, checkForeignKeyActions, checksOf, checkViolated, columnChecks, columnsOf, withChecks, type CheckDef } from './checks.ts'
import { checkDefaults, defaultOf, implicitDefault, rowDependent } from './dml.ts'
import { checkParentOf, foreignKeyChecks, foreignKeyClause, foreignKeysOf, referencedIndex, referencingKeys, storageClass, supportingIndex, withForeignKeys, type ForeignKeyClause } from './foreign-keys.ts'
import { checkFulltext, fulltextOf, type FulltextDef } from './fulltext.ts'
import type { Run } from './query.ts'

const notSupported = (what: string) => sqlError('ER_NOT_SUPPORTED_YET', messages.notSupported(what))
const cantDrop = (name: string) => sqlError('ER_CANT_DROP_FIELD_OR_KEY', `Can't DROP '${name}'; check that column/key exists`)

const ACTION_NAMES: Readonly<Record<string, string>> = {
  columnVisibility: 'Invisible columns',
  indexVisibility: 'Invisible indexes',
  orderBy: 'ALTER TABLE … ORDER BY',
  convert: 'ALTER TABLE … CONVERT TO CHARACTER SET',
  keys: 'ALTER TABLE … ENABLE / DISABLE KEYS',
  force: 'ALTER TABLE … FORCE',
  tablespace: 'ALTER TABLE … TABLESPACE',
}

export function alterTable(run: Run, catalog: Catalog, statement: AlterTableNode): OkResult {
  const schema = statement.table.schema ?? run.env.session.database
  if (schema === null) throw sqlError('ER_NO_DB_ERROR', messages.noDatabaseSelected())
  // Table options: a COMMENT, an AUTO_INCREMENT counter, and the ENGINE it already has.
  for (const k of Object.keys(statement.options)) if (!['COMMENT', 'AUTO_INCREMENT', 'ENGINE'].includes(k.toUpperCase())) throw notSupported('ALTER TABLE table options')
  // DDL: an implicit commit first, as every DDL statement makes.
  run.state.commit()
  const def = catalog.definition(schema, statement.table.name)
  for (const a of statement.actions) {
    const named = ACTION_NAMES[a.type]
    if (named !== undefined) throw notSupported(named)
    if (a.type === 'drop' && a.what === 'PRIMARY KEY') throw notSupported('ALTER TABLE … DROP PRIMARY KEY')
    if (a.type === 'addKey' && (a.key.type === KEY.PRIMARY || a.key.type === KEY.SPATIAL)) throw notSupported(`ALTER TABLE … ADD ${a.key.type.toUpperCase()} KEY`)
    if (a.type === 'addColumn' && (a.column.autoIncrement === true || a.column.primary === true || a.column.type.serial === true)) throw notSupported('ALTER TABLE … ADD an AUTO_INCREMENT or PRIMARY KEY column')
  }
  const engineOption = Object.entries(statement.options).find(([k]) => k.toUpperCase() === 'ENGINE')?.[1]
  if (engineOption !== undefined && engineOption.toLowerCase() !== (def.engine === 'memory' ? 'memory' : 'innodb')) throw notSupported('ALTER TABLE … ENGINE to another engine')
  const tableCollation = typeof def.options['collationId'] === 'number' ? (def.options['collationId'] as number) : DEFAULT_COLLATION
  const of = <T extends AlterAction['type']>(type: T) => statement.actions.filter((a): a is Extract<AlterAction, { type: T }> => a.type === type)

  // --- columns as they stand, and where each one's value comes from ---
  const columns: ColumnDef[] = [...def.columns]
  /** For each new column, where its value comes from: an old column's position, or its default. */
  let sources: (number | ColumnDef)[] = def.columns.map((_, i) => i)
  /** The old columns dropped, and the new name of each one renamed, by old name in lower case. */
  const dropped = new Set<string>()
  const renamed = new Map<string, string>()
  const columnAt = (name: string): number => {
    const i = columns.findIndex((c) => c.name.toLowerCase() === name.toLowerCase())
    if (i < 0) throw sqlError('ER_BAD_FIELD_ERROR', `Unknown column '${name}' in '${def.name}'`)
    return i
  }
  const move = (i: number, position: Extract<AlterAction, { type: 'changeColumn' }>['position']) => {
    if (position === undefined) return
    const [c] = columns.splice(i, 1)
    const [from] = sources.splice(i, 1)
    let at = 0
    if (position !== 'FIRST') {
      const j = columns.findIndex((x) => x.name.toLowerCase() === position.after.toLowerCase())
      if (j < 0) throw sqlError('ER_BAD_FIELD_ERROR', messages.unknownColumn(position.after, 'table definition'))
      at = j + 1
    }
    columns.splice(at, 0, c as ColumnDef)
    sources.splice(at, 0, from as number | ColumnDef)
  }

  // Every column dropped is 1090, before any name is looked for (8.4.11).
  if (of('drop').filter((a) => a.what === 'COLUMN').length >= columns.length) throw sqlError('ER_CANT_REMOVE_ALL_FIELDS', "You can't delete all columns with ALTER TABLE; use DROP TABLE instead")

  // --- drops ---
  let foreignKeys = foreignKeysOf(def)
  let indexes: IndexDef[] = [...def.indexes]
  let fulltext: FulltextDef[] = fulltextOf(def)
  let checkDefs: CheckDef[] = checksOf(def)
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
  for (const a of of('drop')) {
    const name = a.name as string
    if (a.what === 'COLUMN') {
      const i = columns.findIndex((c) => same(c.name, name))
      if (i < 0) throw cantDrop(name)
      columns.splice(i, 1)
      sources.splice(i, 1)
      dropped.add(name.toLowerCase())
      continue
    }
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
    if (fulltext.some((f) => same(f.name, name))) {
      fulltext = fulltext.filter((f) => !same(f.name, name))
      continue
    }
    if (!indexes.some((i) => i.name.toLowerCase() === name.toLowerCase())) throw cantDrop(name)
    indexes = indexes.filter((i) => i.name.toLowerCase() !== name.toLowerCase())
  }
  if (columns.length === 0) throw sqlError('ER_CANT_REMOVE_ALL_FIELDS', "You can't delete all columns with ALTER TABLE; use DROP TABLE instead")

  // --- columns changed, renamed, given or stripped of a default, in the order written ---
  let notes = 0
  const primary = new Set((def.indexes.find((i) => i.kind === 'primary')?.parts ?? []).map((p) => p.column.toLowerCase()))
  const rename = (i: number, to: string) => {
    if (columns.some((c, j) => j !== i && same(c.name, to))) throw sqlError('ER_DUP_FIELDNAME', `Duplicate column name '${to}'`)
    const from = sources[i]
    if (typeof from === 'number') {
      const original = (def.columns[from] as ColumnDef).name
      if (!same(original, to)) renamed.set(original.toLowerCase(), to)
      else renamed.delete(original.toLowerCase())
    }
  }
  for (const a of statement.actions) {
    if (a.type === 'changeColumn') {
      const i = columnAt(a.name)
      const old = columns[i] as ColumnDef
      const made = columnDef(a.column, tableCollation, primary.has(old.name.toLowerCase()))
      if (made.autoIncrement === true && old.autoIncrement !== true) throw notSupported('ALTER TABLE … making a column AUTO_INCREMENT')
      rename(i, made.name)
      columns[i] = made
      notes += checkDefaults(run, [made], columns) + columnDeprecations(a.column)
      move(i, a.position)
    } else if (a.type === 'renameColumn') {
      const i = columnAt(a.from)
      rename(i, a.to)
      columns[i] = { ...(columns[i] as ColumnDef), name: a.to }
    } else if (a.type === 'setDefault' || a.type === 'dropDefault') {
      const i = columnAt(a.column)
      const c = columns[i] as ColumnDef
      const { default: _d, noDefault: _n, defaultExpression: _e, ...rest } = c.attributes ?? {}
      // DROP DEFAULT leaves no default at all, NULL included: a row that omits
      // the column is 1364, and SHOW CREATE TABLE says nothing (8.4.11).
      const attributes = a.type === 'setDefault' ? { ...rest, default: deparse(a.value), ...(a.expression === true ? { defaultExpression: true } : {}) } : { ...rest, noDefault: true }
      columns[i] = { ...c, attributes }
      if (a.type === 'setDefault') notes += checkDefaults(run, [columns[i] as ColumnDef], columns)
    }
  }
  /** An old column's name now, or undefined if it was dropped. */
  const now = (name: string): string | undefined => (dropped.has(name.toLowerCase()) ? undefined : (renamed.get(name.toLowerCase()) ?? name))

  // --- what names the columns: keys, foreign keys, constraints ---
  const mapParts = <P extends { readonly column: string }>(parts: readonly P[]): P[] => parts.flatMap((p) => {
    const n = now(p.column)
    return n === undefined ? [] : [{ ...p, column: n }]
  })
  indexes = indexes.map((i) => ({ ...i, parts: mapParts(i.parts) })).filter((i) => i.parts.length > 0)
  fulltext = fulltext.map((f) => ({ ...f, columns: f.columns.flatMap((c) => now(c) ?? []) })).filter((f) => f.columns.length > 0)
  // A FULLTEXT key's columns stay text (1283).
  for (const f of fulltext) checkFulltext(def.engine, columns, f.columns)
  const self = (fk: { references: { schema: string; table: string } }) => fk.references.schema === schema && fk.references.table === def.name
  foreignKeys = foreignKeys.map((fk) => {
    const lost = fk.columns.find((c) => now(c) === undefined)
    if (lost !== undefined) throw sqlError('ER_FK_COLUMN_CANNOT_DROP', `Cannot drop column '${lost}': needed in a foreign key constraint '${fk.name}'`)
    const columnsNow = fk.columns.map((c) => now(c) as string)
    return self(fk) ? { ...fk, columns: columnsNow, references: { ...fk.references, columns: fk.references.columns.map((c) => now(c) ?? c) } } : { ...fk, columns: columnsNow }
  })
  const children = referencingKeys(catalog, schema, def.name).filter(({ child }) => child.schema !== schema || child.name !== def.name)
  // A column a key joins, retyped, must still meet the other side (3780).
  const incompatible = (child: ColumnDef, parent: ColumnDef, fk: string) => sqlError('ER_FK_INCOMPATIBLE_COLUMNS', `Referencing column '${child.name}' and referenced column '${parent.name}' in foreign key constraint '${fk}' are incompatible.`)
  const columnNamed = (list: readonly ColumnDef[], n: string) => list.find((c) => same(c.name, n))
  for (const fk of foreignKeys) {
    const parent = self(fk) ? { columns } : (() => { try { return catalog.definition(fk.references.schema, fk.references.table) } catch { return undefined } })()
    if (parent === undefined) continue
    fk.columns.forEach((c, k) => {
      const mine = columnNamed(columns, c)
      const theirs = columnNamed(parent.columns, fk.references.columns[k] as string)
      if (mine !== undefined && theirs !== undefined && storageClass(mine.type) !== storageClass(theirs.type)) throw incompatible(mine, theirs, fk.name)
    })
  }
  for (const { child, fk } of children) {
    fk.columns.forEach((c, k) => {
      const theirs = columnNamed(child.columns, c)
      const mine = columnNamed(columns, now(fk.references.columns[k] as string) ?? '')
      if (mine !== undefined && theirs !== undefined && storageClass(mine.type) !== storageClass(theirs.type)) throw incompatible(theirs, mine, fk.name)
    })
  }
  for (const { child, fk } of children) {
    const lost = fk.references.columns.find((c) => now(c) === undefined)
    if (lost !== undefined) throw sqlError('ER_FK_COLUMN_CANNOT_DROP_CHILD', `Cannot drop column '${lost}': needed in a foreign key constraint '${fk.name}' of table '${child.name}'`)
  }
  // A constraint on a column renamed, or on one dropped with another, keeps
  // it (3959); one on a dropped column alone goes with it (8.4.11).
  checkDefs = checkDefs.filter((c) => {
    const named = [...columnsOf(c.text)]
    const touched = named.find((n) => now(n) !== n)
    if (touched === undefined) return true
    if (named.length === 1 && dropped.has(touched)) return false
    const original = def.columns.find((x) => x.name.toLowerCase() === touched)?.name ?? touched
    throw sqlError('ER_DEPENDENT_BY_CHECK_CONSTRAINT', `Check constraint '${c.name}' uses column '${original}', hence column cannot be dropped or renamed.`)
  })

  // --- keys renamed ---
  for (const a of of('renameIndex')) {
    const target = [...indexes, ...fulltext].find((i) => same(i.name, a.from))
    if (target === undefined) throw sqlError('ER_KEY_DOES_NOT_EXITS', `Key '${a.from}' doesn't exist in table '${def.name}'`)
    if ([...indexes, ...fulltext].some((i) => i !== target && same(i.name, a.to))) throw sqlError('ER_DUP_KEYNAME', `Duplicate key name '${a.to}'`)
    indexes = indexes.map((i) => (i === target ? { ...i, name: a.to } : i))
    fulltext = fulltext.map((f) => (f === target ? { ...f, name: a.to } : f))
  }

  // What was there, so a repeated key is counted only when it is new (1831).
  const kept = { indexes: indexes.length, fulltext: fulltext.length }

  // --- columns added ---
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
    notes += checkDefaults(run, [made], columns) + columnDeprecations(a.column)
    sources = [...sources.slice(0, at), made, ...sources.slice(at)]
    added.push(a.column)
  }

  // --- indexes ---
  const names = new Set([...indexes, ...fulltext].map((i) => i.name.toLowerCase()))
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
    if (k.type === KEY.FULLTEXT) {
      const parts = k.columns.map((p) => known(p.name ?? ''))
      checkFulltext(def.engine, columns, parts, k.columns.some((p) => p.desc === true))
      fulltext.push({ name: nameFor(k.name ?? k.constraint, parts[0] as string), columns: parts })
      continue
    }
    const parts = k.columns.map((p) => {
      if (p.name === undefined) throw notSupported('Functional key parts')
      return { column: known(p.name), ...(p.length === undefined ? {} : { prefix: p.length }), ...(p.desc === true ? { descending: true } : {}) }
    })
    indexes.push({ name: nameFor(k.name ?? k.constraint, (parts[0] as { column: string }).column), kind: k.type === KEY.UNIQUE ? 'unique' : 'index', parts })
  }

  // An index a foreign key needs, and no other serves, stays (1553): the
  // child's own keys need theirs, and the keys that reference this table
  // need its UNIQUE key on their columns. Decided after this statement's
  // own new indexes, which may be the ones that serve (8.4.11).
  for (const a of of('drop')) {
    if (a.what !== 'INDEX' && a.what !== 'CONSTRAINT') continue
    const refuse = () => sqlError('ER_DROP_INDEX_FK', `Cannot drop index '${a.name as string}': needed in a foreign key constraint`)
    for (const fk of foreignKeys) if (supportingIndex(indexes, fk.columns) === undefined) throw refuse()
    for (const { fk } of referencingKeys(catalog, schema, def.name)) if (referencedIndex({ indexes }, fk.references.columns) === undefined) throw refuse()
  }

  // --- the table's own name and options ---
  const renameTo = of('rename').at(-1)?.to
  if (renameTo !== undefined && renameTo.schema !== undefined && renameTo.schema !== schema) throw notSupported('ALTER TABLE … RENAME to another schema')
  const name = renameTo?.name ?? def.name
  if (!same(name, def.name) && (catalog.tables(schema).some((t) => same(t.name, name)) || catalog.view(schema, name) !== undefined)) throw sqlError('ER_TABLE_EXISTS_ERROR', `Table '${name}' already exists`)
  const optionOf = (key: string) => Object.entries(statement.options).find(([k]) => k.toUpperCase() === key)?.[1]

  // --- foreign keys ---
  const checks = foreignKeyChecks(run)
  const options: Record<string, unknown> = { ...def.options }
  const comment = optionOf('COMMENT')
  if (comment !== undefined) options['comment'] = comment
  if (fulltext.length > 0) options['fulltext'] = fulltext
  else delete options['fulltext']
  if (name !== def.name) foreignKeys = foreignKeys.map((fk) => (self(fk) ? { ...fk, references: { ...fk.references, table: name } } : fk))
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
  const checkClausesAdded = columnChecks(of('addCheck').map((a) => a.check), added)
  const withNewChecks = withChecks(catalog, schema, { name, engine: def.engine, columns, indexes, options }, run.sql, checkClausesAdded, run.env.session.characterSet)
  for (const c of checksOf(withNewChecks).slice(checkDefs.length)) if (c.enforced) enabled.add(c.name)
  const spec = withForeignKeys(catalog, schema, withNewChecks, clauses, checks)
  checkForeignKeyActions(spec, foreignKeysOf({ ...def, ...spec, options: spec.options ?? {} } as TableDef))
  const before = new Set(foreignKeys.map((fk) => fk.name))
  const made = foreignKeysOf({ ...def, ...spec, options: spec.options ?? {} } as TableDef).filter((fk) => !before.has(fk.name))

  // --- the copy ---
  const store: StoreContext = { strict: false, row: 1, warnings: 0, table: def.name }
  // A column whose type changed is converted as a strict INSERT would store
  // it: 1264, 1265 at the row, and NULL into NOT NULL 1138 (8.4.11).
  const strict: StoreContext = { strict: /\bSTRICT_(TRANS|ALL)_TABLES\b/.test(run.env.session.sqlMode), row: 1, warnings: 0, table: def.name }
  const converted = sources.map((src, i) => {
    if (typeof src !== 'number') return undefined
    const from = def.columns[src] as ColumnDef
    const to = columns[i] as ColumnDef
    return JSON.stringify(from.type) === JSON.stringify(to.type) && (from.nullable === to.nullable || to.nullable) ? undefined : { from, to }
  })
  const newDef = { ...def, columns } as TableDef
  const fill = sources.map((s) => (typeof s === 'number' ? undefined : defaultOf(run, s, newDef)))
  // A default naming another column is evaluated over the row as copied.
  const dependent = sources.flatMap((s, i) => (typeof s !== 'number' && rowDependent(s) ? [i] : []))
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
    const valueOf = (s: ColumnDef, value: Value) => encodeField(value === null && !s.nullable ? implicitDefault(s) : value, s, store)
    strict.row = records
    const out: FieldBytes[] = sources.map((s, i) => {
      const change = converted[i]
      if (typeof s === 'number' && change !== undefined) {
        const v = decodeField(row[s] ?? null, change.from.type)
        if (v === null && !change.to.nullable) throw sqlError('ER_INVALID_USE_OF_NULL', 'Invalid use of NULL value')
        try {
          return encodeField(v, change.to, strict)
        } catch (e) {
          // ALTER words a string too long as a truncation (8.4.11: 1265, not 1406).
          if (e instanceof MyjsError && e.errno === 1406) throw sqlError('WARN_DATA_TRUNCATED', `Data truncated for column '${change.to.name}' at row ${records}`)
          throw e
        }
      }
      if (typeof s === 'number') return row[s] ?? null
      if (dependent.includes(i)) return null
      const d = fill[i]
      return valueOf(s, d === undefined || d === 'none' ? implicitDefault(s) : d.eval([], run.env))
    })
    if (dependent.length > 0) {
      const values: Value[] = out.map((f, i) => decodeField(f, (columns[i] as ColumnDef).type))
      for (const i of dependent) {
        const s = columns[i] as ColumnDef
        out[i] = valueOf(s, (fill[i] as Compiled).eval(values, run.env))
        values[i] = decodeField(out[i] ?? null, s.type)
      }
    }
    if (check !== undefined) {
      for (const fk of made) check(checked, fk, out)
    }
    const violated = violation?.(out)
    if (violated !== undefined) throw checkViolated(violated)
    return out
  })
  // "Records" counts the rows only where MySQL copies too: a key or a
  // constraint the rows must be checked against.
  // And a column whose default is an expression, which 8.4 cannot add in place.
  const expression = added.some((c) => c.default !== undefined && !isConstantDefault(c.default))
  // And a column's type changed, other than a VARCHAR made longer, or the
  // primary key's columns, which InnoDB cannot do in place either.
  const retyped = converted.some((c) => c !== undefined && !widened(c.from, c.to))
  const keyOf = (ix: readonly IndexDef[]) => JSON.stringify(ix.find((i) => i.kind === 'primary')?.parts.map((p) => p.column.toLowerCase()) ?? [])
  const rekeyed = keyOf(def.indexes) !== keyOf(indexes.map((i) => ({ ...i, parts: i.parts })) ) && def.indexes.some((i) => i.kind === 'primary') && [...dropped].some((d) => primary.has(d))
  const copied = (checks && made.length > 0) || enabled.size > 0 || expression || retyped || rekeyed ? records : 0
  // AUTO_INCREMENT = n moves the counter on, never back past the rows.
  const counter = optionOf('AUTO_INCREMENT')
  if (counter !== undefined && /^\d+$/.test(counter)) catalog.table(schema, name).raiseAutoIncrement(BigInt(counter))
  // The tables whose keys name this one follow its new names.
  if (name !== def.name || renamed.size > 0) {
    for (const child of new Set(children.map((c) => c.child))) {
      const fks = foreignKeysOf(child).map((fk) => (fk.references.schema === schema && fk.references.table === def.name ? { ...fk, references: { ...fk.references, table: name, columns: fk.references.columns.map((c) => now(c) ?? c) } } : fk))
      catalog.rebuildTable(child.schema, child.name, { name: child.name, engine: child.engine, columns: child.columns, indexes: child.indexes, options: { ...child.options, foreignKeys: fks } }, (row) => row)
    }
  }
  // A rename alone is answered as RENAME TABLE is, without counts.
  if (statement.actions.every((a) => a.type === 'rename') && Object.keys(statement.options).length === 0) return { affectedRows: 0 }
  // A table's first FULLTEXT key makes InnoDB add its document id column, and
  // say so (124, "InnoDB rebuilding table to add column FTS_DOC_ID").
  const warnings = notes + duplicateKeys(indexes, fulltext, kept) + (fulltextOf(def).length === 0 && fulltext.length > 0 ? 1 : 0)
  return { affectedRows: copied, info: `Records: ${copied}  Duplicates: 0  Warnings: ${warnings}`, ...(warnings > 0 ? { warnings } : {}) }
}

/** A literal default, or CURRENT_TIMESTAMP's: one 8.4 adds a column with in place, without copying the rows. */
function isConstantDefault(e: Expression): boolean {
  if (e.kind === NODE.LITERAL) return true
  if (e.kind === NODE.UNARY && (e.op === '-' || e.op === '+') && e.operand.kind === NODE.LITERAL) return true
  return e.kind === NODE.CALL && ['CURRENT_TIMESTAMP', 'NOW', 'LOCALTIME', 'LOCALTIMESTAMP'].includes(e.name.toUpperCase()) && e.args.length <= 1
}

/** A change InnoDB makes in place: a VARCHAR made longer in the same collation, or only NULL allowed. */
function widened(from: ColumnDef, to: ColumnDef): boolean {
  const a = from.type
  const b = to.type
  if (JSON.stringify(a) === JSON.stringify(b)) return true
  const varchar = (t: typeof a) => t.type === FIELD_TYPE.VARCHAR || t.type === FIELD_TYPE.VAR_STRING
  return varchar(a) && varchar(b) && a.collationId === b.collationId && (b.length ?? 0) >= (a.length ?? 0)
}
