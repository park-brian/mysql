// M5.13 — the PERFORMANCE_SCHEMA tables SHOW VARIABLES and SHOW STATUS read.
//
// 8.4.11 answers SHOW VARIABLES as a query over
// `performance_schema.session_variables` (or `global_variables`), and SHOW
// STATUS over the status tables beside them, so a statement's own WHERE
// filters their rows as it would any table's. These are those tables, and no
// others: what performance_schema instruments, this executor does not keep.
import type { TableName } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import { COERCIBILITY, stringValue, type Value } from '@myjs/types'
import type { DerivedSource } from './from.ts'
import type { InformationSchemaColumn } from './information-schema-defs.ts'
import { systemColumnType } from './information-schema.ts'
import type { Run } from './query.ts'
import { systemVariableInfo } from './variables.ts'

const UTF8MB4_0900_AI_CI = 255

/** Each table's two columns, as 8.4.11 describes them: the name its primary key, the value nullable. */
const COLUMNS: readonly InformationSchemaColumn[] = [
  { name: 'VARIABLE_NAME', type: 253, length: 256, flags: 20483, decimals: 0, text: true, column: true, collation: 'utf8mb4_0900_ai_ci', streamed: [253, 256, 20483, 0] },
  { name: 'VARIABLE_VALUE', type: 253, length: 4096, flags: 0, decimals: 0, text: true, column: true, collation: 'utf8mb4_0900_ai_ci', streamed: [253, 4096, 0, 0] },
]

type Rows = (run: Run) => Iterable<readonly [string, string]>

const TABLES: Readonly<Record<string, Rows>> = {
  global_variables: (run) => variableRows(run, 'GLOBAL'),
  session_variables: (run) => variableRows(run, undefined),
  global_status: (run) => run.state.status(run.env.session, 'GLOBAL'),
  session_status: (run) => run.state.status(run.env.session, 'SESSION'),
}

/**
 * A PERFORMANCE_SCHEMA table, planned for one reference to it, or
 * `undefined` when `name` is not in PERFORMANCE_SCHEMA. Its name is compared
 * as written, as a database's is under `lower_case_table_names = 0`.
 */
export function performanceSchemaTable(run: Run, name: TableName, alias: string, database: string | null): { schema: string; source: DerivedSource } | undefined {
  const schema = name.schema ?? database
  if (schema === null || schema.toLowerCase() !== 'performance_schema') return undefined
  if (schema !== 'performance_schema') throw sqlError('ER_BAD_DB_ERROR', messages.unknownDatabase(schema))
  const rowsOf = TABLES[name.name]
  if (rowsOf === undefined) throw sqlError('ER_NO_SUCH_TABLE', messages.noSuchTable('performance_schema', name.name))
  const columns = COLUMNS.map((c) => ({ name: c.name, type: systemColumnType(c, name.name, alias, 'performance_schema') }))
  const text = (s: string): Value => stringValue(s, UTF8MB4_0900_AI_CI, COERCIBILITY.IMPLICIT)
  return {
    schema: 'performance_schema',
    source: { joined: true, columns, rows: () => [...rowsOf(run)].map(([n, v]) => [text(n), text(v)]) },
  }
}

/**
 * Every variable a scope has, by name, its value as SHOW VARIABLES writes it.
 * A session sees the global-only variables too, as 8.4.11's does; the global
 * table leaves out the session-only ones.
 */
function* variableRows(run: Run, scope: 'GLOBAL' | undefined): Iterable<readonly [string, string]> {
  for (const name of run.state.systemVariableNames()) {
    if (scope === 'GLOBAL' && systemVariableInfo(name)?.scope === 'session') continue
    yield [name, shownValue(name, run.state.systemVariable(name, scope, run.env.session) ?? null)]
  }
}

/** A variable's value as SHOW VARIABLES writes it: ON or OFF for a boolean, six decimals for a double, the empty string for NULL. */
export function shownValue(name: string, v: Value): string {
  if (v === null) return ''
  const kind = systemVariableInfo(name)?.kind
  if (kind === 'bool' && v.kind === 'int') return v.v === 0n ? 'OFF' : 'ON'
  if (v.kind === 'double') return v.v.toFixed(6)
  if (v.kind === 'int' || v.kind === 'string') return String(v.v)
  if (v.kind === 'bytes') return new TextDecoder().decode(v.v)
  return String((v as { v: unknown }).v)
}
