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
import { sqlError, type SqlError } from '@myjs/protocol'
import type { CallNode } from '@myjs/parser'
import { BUILTINS, CLOCK_FUNCTIONS, CONTROL_FUNCTIONS, INFORMATION_FUNCTIONS, REGEXP_FUNCTIONS, builtinFunction, clockFunction, controlFunction, informationFunction, regexpFunction } from './builtins.ts'
import { compile, type CompileContext, type Compiled } from './compile.ts'
import { JSON_PATH_FUNCTIONS, jsonPathFunction } from './json-path.ts'
import { JSON_CONSTRUCTORS, jsonConstructor } from './json.ts'
import { MATH_FUNCTIONS, mathFunction } from './math-functions.ts'
import { NETWORK_FUNCTIONS, networkFunction } from './network-functions.ts'
import { STRING_FUNCTIONS, stringFunction } from './string-functions.ts'
import { TEMPORAL_ARITHMETIC, TEMPORAL_FUNCTIONS, TEMPORAL_TEXT_FUNCTIONS, temporalArithmetic, temporalFunction, temporalTextFunction } from './temporal-functions.ts'

/** Native-call arity failures retain the spelling of the written function name. */
export function wrongParameterCount(name: string): SqlError {
  return sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${name}'`)
}

/** An aggregate in a forbidden context; callers retain admission timing. */
export function invalidGroupFunction(): SqlError {
  return sqlError('ER_INVALID_GROUP_FUNC_USE', 'Invalid use of group function')
}

/** Build a count check; the caller decides when binding has reached arity validation. */
export function nativeArity(name: string, count: number): (min: number, max?: number) => void {
  return (min, max = min) => {
    if (count < min || count > max) throw wrongParameterCount(name)
  }
}

/** Compile one call of the function `name` (upper case). */
export type FunctionCompiler = (name: string, e: CallNode, ctx: CompileContext) => Compiled

const args = (e: CallNode, ctx: CompileContext): Compiled[] => e.args.map((a) => compile(a, ctx))

/** Each family's names and its compiler. A function, so nothing here is read while the cycle loads. */
const families = (): readonly (readonly [ReadonlySet<string>, FunctionCompiler])[] => [
  [JSON_CONSTRUCTORS, (name, e, ctx) => jsonConstructor(name, args(e, ctx), e.name)],
  [JSON_PATH_FUNCTIONS, (name, e, ctx) => jsonPathFunction(name, args(e, ctx), e.name)],
  [STRING_FUNCTIONS, stringFunction],
  [TEMPORAL_FUNCTIONS, temporalFunction],
  [TEMPORAL_TEXT_FUNCTIONS, temporalTextFunction],
  [TEMPORAL_ARITHMETIC, temporalArithmetic],
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
export const NOT_YET: readonly string[] = [
  'UUID',
  // Without OVER these are MySQL's 1064; refused by name until the parser makes them that.
  'ROW_NUMBER',
  'RANK',
]

/** Functions whose value can change between two evaluations in one statement: never folded to a constant. */
export const VARIES_PER_EVALUATION: ReadonlySet<string> = new Set([
  'RAND', 'UUID', 'UUID_SHORT', 'SYSDATE', 'RANDOM_BYTES', 'SLEEP', 'LAST_INSERT_ID', 'ROW_COUNT', 'FOUND_ROWS', 'GET_LOCK', 'RELEASE_LOCK',
])

/** Native diagnostic spelling differs from the lookup key only for these aliases. */
const GENERATOR_FUNCTION_ALIASES: Readonly<Record<string, string>> = {
  CURRENT_TIMESTAMP: 'now',
  LOCALTIME: 'now',
  LOCALTIMESTAMP: 'now',
  CURRENT_DATE: 'curdate',
  CURRENT_TIME: 'curtime',
  SCHEMA: 'database',
  SESSION_USER: 'user',
  SYSTEM_USER: 'user',
  MASTER_POS_WAIT: 'source_pos_wait',
  VERSION: 'version()',
}

/** Diagnostic spelling for a native ASCII lookup key, independent of admission policy. */
export function valueGeneratorFunctionName(name: string): string {
  return GENERATOR_FUNCTION_ALIASES[name] ?? name.toLowerCase()
}

// These cohorts describe only the 39 verified names below, not CHECK or
// a universal relation between the two contexts' prohibition policies.
/** Prohibited in generated columns, permitted in DEFAULT admission. */
const GENERATED_ONLY = [
  'RAND', 'UUID', 'UUID_SHORT', 'RANDOM_BYTES', 'NOW', 'CURRENT_TIMESTAMP',
  'LOCALTIME', 'LOCALTIMESTAMP', 'SYSDATE', 'CURDATE', 'CURRENT_DATE', 'CURTIME',
  'CURRENT_TIME', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'UNIX_TIMESTAMP', 'CONNECTION_ID',
  'USER', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER', 'CURRENT_ROLE', 'DATABASE',
  'SCHEMA',
] as const

/** Independently verified as prohibited in both generated and DEFAULT expressions. */
const GENERATED_AND_DEFAULT = [
  'LAST_INSERT_ID', 'FOUND_ROWS', 'ROW_COUNT', 'SLEEP', 'GET_LOCK', 'RELEASE_LOCK',
  'RELEASE_ALL_LOCKS', 'IS_FREE_LOCK', 'IS_USED_LOCK', 'BENCHMARK', 'LOAD_FILE', 'MASTER_POS_WAIT',
  'SOURCE_POS_WAIT', 'VERSION',
] as const

export const DISALLOWED_DEFAULT_FUNCTIONS: ReadonlySet<string> = new Set(GENERATED_AND_DEFAULT)

/** Native generated-column diagnostic spelling; CHECK's distinct permissions remain separate. */
export const NOT_ROW_DETERMINED: ReadonlyMap<string, string> = new Map(
  [...GENERATED_ONLY, ...GENERATED_AND_DEFAULT].map((name) => [name, valueGeneratorFunctionName(name)] as const),
)

/** The functions that are conditions themselves, as a comparison is: a CHECK may be one alone. */
export const CONDITION_FUNCTIONS: ReadonlySet<string> = new Set(['JSON_VALID', 'REGEXP_LIKE', 'ISNULL', 'STRCMP', 'JSON_CONTAINS', 'JSON_CONTAINS_PATH', 'JSON_OVERLAPS'])
