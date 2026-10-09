// Every builtin function the executor compiles, by name, and what is known
// about each beyond how to compile it.
//
// `call()` used to try six channels in turn: two JSON sets, the string and
// numeric library, the temporal family, "more functions" and an inline
// switch, each with its own calling convention and each answering
// `undefined` for a name that was not its own. A name in a family's set that
// its switch had lost reached the row loop as `undefined`. Now each family
// exports its names and one compiler with one signature, the table below is
// built from them once (a name in two families is a fault at load), and a
// family's switch meets an unknown name only as an internal error.
//
// The table is built on first use rather than at load: the families import
// `compile.ts`, which imports this, and a module in that cycle can be the
// first one loaded.
import { MyjsError } from '@myjs/bytes'
import type { CallNode } from '@myjs/parser'
import { BUILTINS, CLOCK_FUNCTIONS, CONTROL_FUNCTIONS, INFORMATION_FUNCTIONS, REGEXP_FUNCTIONS, builtinFunction, clockFunction, controlFunction, informationFunction, regexpFunction } from './builtins.ts'
import { compile, type CompileContext, type Compiled } from './compile.ts'
import { JSON_PATH_FUNCTIONS, jsonPathFunction } from './json-path.ts'
import { JSON_CONSTRUCTORS, jsonConstructor } from './json.ts'
import { MATH_FUNCTIONS, mathFunction } from './math-functions.ts'
import { NETWORK_FUNCTIONS, networkFunction } from './network-functions.ts'
import { STRING_FUNCTIONS, stringFunction } from './string-functions.ts'
import { TEMPORAL_FUNCTIONS, temporalFunction } from './temporal-functions.ts'

/** Compile one call of the function `name` (upper case). */
export type FunctionCompiler = (name: string, e: CallNode, ctx: CompileContext) => Compiled

const args = (e: CallNode, ctx: CompileContext): Compiled[] => e.args.map((a) => compile(a, ctx))

/** Each family's names and its compiler. A function, so nothing here is read while the cycle loads. */
const families = (): readonly (readonly [ReadonlySet<string>, FunctionCompiler])[] => [
  [JSON_CONSTRUCTORS, (name, e, ctx) => jsonConstructor(name, args(e, ctx), e.name)],
  [JSON_PATH_FUNCTIONS, (name, e, ctx) => jsonPathFunction(name, args(e, ctx), e.name)],
  [STRING_FUNCTIONS, stringFunction],
  [TEMPORAL_FUNCTIONS, temporalFunction],
  [MATH_FUNCTIONS, mathFunction],
  [NETWORK_FUNCTIONS, networkFunction],
  [BUILTINS, builtinFunction],
  [CONTROL_FUNCTIONS, controlFunction],
  [INFORMATION_FUNCTIONS, informationFunction],
  [REGEXP_FUNCTIONS, regexpFunction],
  [CLOCK_FUNCTIONS, clockFunction],
]

let table: Map<string, FunctionCompiler> | undefined

function build(): Map<string, FunctionCompiler> {
  const out = new Map<string, FunctionCompiler>()
  for (const [names, compiler] of families()) {
    for (const name of names) {
      if (out.has(name)) throw new MyjsError('FUNCTION_REGISTERED_TWICE', `the function ${name} is in two families`)
      out.set(name, compiler)
    }
  }
  return out
}

/** The compiler for a builtin, or undefined when this executor has none. */
export function functionCompiler(name: string): FunctionCompiler | undefined {
  table ??= build()
  return table.get(name)
}

/** Every builtin name the executor compiles. */
export function functionNames(): Iterable<string> {
  table ??= build()
  return table.keys()
}

/** A name a family's set holds and its compiler does not: a fault in this package, never a client's. */
export function unregistered(name: string): MyjsError {
  return new MyjsError('FUNCTION_NOT_COMPILED', `the function ${name} is registered but its family does not compile it`)
}

/** Builtins MySQL has that this executor refuses by name, rather than as a function that does not exist. */
export const NOT_YET: ReadonlySet<string> = new Set([
  'UUID',
  // Without OVER these are MySQL's 1064; refused by name until the parser makes them that.
  'ROW_NUMBER',
  'RANK',
])

/** Functions whose value can change between two evaluations in one statement: never folded to a constant. */
export const VARIES_PER_EVALUATION: ReadonlySet<string> = new Set([
  'RAND', 'UUID', 'UUID_SHORT', 'SYSDATE', 'RANDOM_BYTES', 'SLEEP', 'LAST_INSERT_ID', 'ROW_COUNT', 'FOUND_ROWS', 'GET_LOCK', 'RELEASE_LOCK',
])

/**
 * Functions whose value is not the row's alone (the statement's clock, the
 * session, the server): refused in a CHECK (3814) and in a generated column
 * (3763), each under the name the server prints for it there.
 */
export const NOT_ROW_DETERMINED: ReadonlyMap<string, string> = new Map([
  ['RAND', 'rand'], ['UUID', 'uuid'], ['UUID_SHORT', 'uuid_short'], ['RANDOM_BYTES', 'random_bytes'],
  ['NOW', 'now'], ['CURRENT_TIMESTAMP', 'now'], ['LOCALTIME', 'now'], ['LOCALTIMESTAMP', 'now'], ['SYSDATE', 'sysdate'],
  ['CURDATE', 'curdate'], ['CURRENT_DATE', 'curdate'], ['CURTIME', 'curtime'], ['CURRENT_TIME', 'curtime'],
  ['UTC_DATE', 'utc_date'], ['UTC_TIME', 'utc_time'], ['UTC_TIMESTAMP', 'utc_timestamp'], ['UNIX_TIMESTAMP', 'unix_timestamp'],
  ['CONNECTION_ID', 'connection_id'], ['USER', 'user'], ['CURRENT_USER', 'current_user'], ['SESSION_USER', 'session_user'],
  ['SYSTEM_USER', 'system_user'], ['CURRENT_ROLE', 'current_role'], ['DATABASE', 'database'], ['SCHEMA', 'database'],
  ['LAST_INSERT_ID', 'last_insert_id'], ['FOUND_ROWS', 'found_rows'], ['ROW_COUNT', 'row_count'],
  ['SLEEP', 'sleep'], ['GET_LOCK', 'get_lock'], ['RELEASE_LOCK', 'release_lock'], ['RELEASE_ALL_LOCKS', 'release_all_locks'],
  ['IS_FREE_LOCK', 'is_free_lock'], ['IS_USED_LOCK', 'is_used_lock'], ['BENCHMARK', 'benchmark'], ['LOAD_FILE', 'load_file'],
  ['MASTER_POS_WAIT', 'master_pos_wait'], ['SOURCE_POS_WAIT', 'source_pos_wait'], ['VERSION', 'version'],
])

/** The functions that are conditions themselves, as a comparison is: a CHECK may be one alone. */
export const CONDITION_FUNCTIONS: ReadonlySet<string> = new Set(['JSON_VALID', 'REGEXP_LIKE', 'ISNULL', 'STRCMP', 'JSON_CONTAINS', 'JSON_CONTAINS_PATH', 'JSON_OVERLAPS'])
