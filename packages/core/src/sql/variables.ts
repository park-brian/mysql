// M5.13 — the system variables, as 8.4.11 has them (`system-variables.ts`,
// captured by `tools/capture-variables.mjs`): what a variable is, its default,
// and how SHOW VARIABLES writes its value.
import type { SqlValue } from '@myjs/protocol'
import { SYSTEM_VARIABLES } from './system-variables.ts'

export interface SystemVariable {
  readonly name: string
  /** Where it lives: one value for the server, one for each session, or a global default each session copies. */
  readonly scope: 'global' | 'session' | 'both'
  readonly readOnly: boolean
  /** A session's copy is read-only, and only SET GLOBAL assigns it (1621: `max_allowed_packet`). */
  readonly globalOnly: boolean
  /** A session's DEFAULT is 0, not the global value (the two that are bits of a session's options). */
  readonly zeroDefault: boolean
  readonly kind: 'bool' | 'int' | 'double' | 'string'
  /** The server's default, or `undefined` for a value that is the machine's, which `OURS` gives. */
  readonly value: SqlValue | undefined
  /** An integer's bounds, which a `SET` clamps to with a 1292 warning. */
  readonly min?: bigint
  readonly max?: bigint
}

const SCOPES = { G: 'global', S: 'session', B: 'both' } as const
const KINDS = { b: 'bool', i: 'int', d: 'double', s: 'string' } as const

let registry: ReadonlyMap<string, SystemVariable> | undefined

/** The registry, parsed on first use. */
function variables(): ReadonlyMap<string, SystemVariable> {
  if (registry !== undefined) return registry
  const out = new Map<string, SystemVariable>()
  for (const line of SYSTEM_VARIABLES.split('\n')) {
    const [name, flags, text, min, max] = line.split('\t') as [string, string, string, string?, string?]
    const kind = KINDS[flags[2] as keyof typeof KINDS]
    const machine = text === '\u0000'
    const nullable = flags.includes('n', 3)
    out.set(name, {
      name,
      scope: SCOPES[flags[0] as keyof typeof SCOPES],
      readOnly: flags[1] === 'r',
      globalOnly: flags[1] === 'g',
      zeroDefault: flags.includes('z', 3),
      kind,
      value: machine ? undefined : nullable && text === '' ? null : parsed(kind, text),
      ...(kind === 'int' && min !== undefined && max !== undefined ? { min: BigInt(min), max: BigInt(max) } : {}),
    })
  }
  registry = out
  return out
}

function parsed(kind: SystemVariable['kind'], text: string): SqlValue {
  if (kind === 'bool') return text === 'ON' ? 1 : 0
  if (kind === 'int') return BigInt(text)
  if (kind === 'double') return Number(text)
  return text
}

export function systemVariableInfo(name: string): SystemVariable | undefined {
  return variables().get(name)
}

/** Every variable's name, in SHOW VARIABLES' order. */
export function systemVariableNames(): readonly string[] {
  return [...variables().keys()]
}

/**
 * The values that are this server's rather than 8.4.11's: what it is, and
 * the machine it would describe, which an in-process database has none of.
 * Each is a variable the registry knows; `ServerState` lays them over its
 * defaults, and `MySQL.open`'s `systemVariables` over these.
 */
export const OURS: Readonly<Record<string, SqlValue>> = {
  version_comment: 'myjs — an in-process MySQL for JavaScript',
  license: 'MIT',
  // No performance schema is kept and no binary log written.
  performance_schema: 0,
  log_bin: 0,
  sql_log_bin: 1,
  hostname: 'localhost',
  port: 3306n,
  // Read by Rust's mysql_async (Prisma's engines) as it connects. There is
  // no socket in-process; this is MySQL's compiled-in default path.
  socket: '/tmp/mysql.sock',
  datadir: '/',
  pid_file: '',
  log_error: 'stderr',
  general_log_file: 'myjs.log',
  slow_query_log_file: 'myjs-slow.log',
  log_bin_basename: '',
  log_bin_index: '',
  relay_log: '',
  relay_log_basename: '',
  relay_log_index: '',
  server_id: 1n,
  server_uuid: '00000000-0000-0000-0000-000000000000',
  build_id: '',
  binlog_format: 'ROW',
  binlog_row_image: 'FULL',
  skip_name_resolve: 0,
  system_time_zone: 'UTC',
}
