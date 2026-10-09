// The builtins compiled here rather than in a family of their own: control
// flow (IF, IFNULL, COALESCE, NULLIF), the string basics every query reaches
// (CONCAT, LENGTH, LOWER, HEX), the session's own facts (DATABASE, USER,
// LAST_INSERT_ID), and the statement's clock (NOW, CURDATE, SYSDATE).
// `registry.ts` routes a call here by name, so nothing here returns
// "not mine".
import { CHARSET_BINARY, FIELD_TYPE, type MysqlDateTime } from '@myjs/bytes'
import { encodeCollation, requireCollationInfo } from '@myjs/charsets'
import { NODE, deparse, type CallNode, type Expression } from '@myjs/parser'
import { messages, sqlError } from '@myjs/protocol'
import {
  COERCIBILITY,
  MAX_SIGNED,
  bool,
  bytesValue,
  compareValues,
  doubleValue,
  hexNumber,
  intValue,
  negate,
  stringValue,
  toDouble,
  toInteger,
  toText,
  truth,
  type Value,
  valueBytes,
} from '@myjs/types'
import {
  aggregate,
  aggregateCollations,
  aggregateTypes,
  asNumber,
  branchOf,
  byteWidth,
  coercibilityOf,
  comparer,
  compile,
  constantEnv,
  convertTo,
  doubleOf,
  expressionOf,
  isBits,
  isText,
  lit,
  readsColumn,
  type CompileContext,
  type Compiled,
  type Env,
  type Row,
} from './compile.ts'
import { dateAdd, isInterval } from './interval.ts'
import {
  CHARSET_UTF8MB3_GENERAL_CI,
  CHARSET_UTF8MB4_BIN,
  NULL_TYPE,
  boolType,
  charWidth,
  datetimeType,
  doubleType,
  floatLength,
  intType,
  stringType,
  type ResultType,
} from './meta.ts'
import { matchType, regexpInstr, regexpLike, regexpReplace, regexpSubstr } from './regexp.ts'
import { unregistered } from './registry.ts'
import { bitBytes } from './wire.ts'

/** The names `builtinFunction` compiles. */
export const BUILTINS: ReadonlySet<string> = new Set([
  'MOD', 'STRCMP', 'REGEXP_INSTR', 'REGEXP_SUBSTR', 'REGEXP_REPLACE', 'REGEXP_LIKE', 'COLLATION', 'CHARSET', 'IF', 'IFNULL', 'COALESCE', 'RAND',
  'ANY_VALUE', 'NULLIF', 'CONCAT', 'LENGTH', 'OCTET_LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'LOWER', 'LCASE', 'UPPER', 'UCASE', 'COERCIBILITY',
  'BIN', 'OCT', 'HEX', 'UNHEX', 'ABS', 'VERSION', 'DATABASE', 'SCHEMA', 'USER', 'CURRENT_USER', 'SESSION_USER', 'SYSTEM_USER',
  'CONNECTION_ID', 'LAST_INSERT_ID', 'VALUES', 'ROW_COUNT', 'NOW', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_TIMESTAMP', 'SYSDATE', 'DATE_ADD', 'DATE_SUB',
  'ADDDATE', 'SUBDATE', 'CURDATE', 'CURRENT_DATE', 'UTC_DATE', 'CURTIME', 'CURRENT_TIME', 'UTC_TIME', 'ISNULL', 'INTERVAL',
])

export function builtinFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const args = (): Compiled[] => e.args.map((a) => compile(a, ctx))
  const arity = (n: number): void => {
    if (e.args.length !== n) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
  }
  const conn = ctx.connectionCollation
  const text = (value: (env: Env) => string | null, chars: number): Compiled => ({
    eval: (_r, env) => {
      const v = value(env)
      return v === null ? null : stringValue(v, conn, COERCIBILITY.SYSCONST)
    },
    type: stringType(chars, conn, false),
  })
  // MOD(a, b) is `a % b`, its name included in an overflow's message.
  if (name === 'MOD') {
    arity(2)
    return compile({ kind: NODE.BINARY, op: '%', left: e.args[0] as Expression, right: e.args[1] as Expression, at: e.at }, ctx)
  }
  switch (name) {
    case 'STRCMP': {
      // A comparison of the two as strings, in their aggregated collation:
      // `STRCMP(10, 9)` is -1 (8.4.11).
      arity(2)
      const [x, y] = args() as [Compiled, Compiled]
      aggregateCollations([x.type, y.type], 'strcmp', true)
      const id = aggregateTypes([x.type, y.type], conn)
      const asString = (v: Exclude<Value, null>): Value => (v.kind === 'string' || v.kind === 'bytes' ? v : stringValue(toText(v), id, COERCIBILITY.NUMERIC))
      return {
        eval: (r, env) => {
          const a = x.eval(r, env)
          const b = y.eval(r, env)
          if (a === null || b === null) return null
          return intValue(BigInt(Math.sign(compareValues(asString(a), asString(b)) ?? 0)))
        },
        type: intType(2, x.type.nullable || y.type.nullable),
      }
    }
    case 'REGEXP_INSTR':
    case 'REGEXP_SUBSTR':
    case 'REGEXP_REPLACE': {
      // (subject, pattern[, replacement], position, occurrence[, return option], match type)
      const replace = name === 'REGEXP_REPLACE'
      const max = name === 'REGEXP_SUBSTR' ? 5 : 6
      if (e.args.length < (replace ? 3 : 2) || e.args.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
      const xs = args()
      const fn = name.toLowerCase()
      const at = replace ? 3 : 2
      const subject = xs[0] as Compiled
      if (subject.type.kind === 'string' && (xs[1] as Compiled).type.kind === 'string') aggregateCollations([subject.type, (xs[1] as Compiled).type], fn, true)
      const collation = subject.type.kind === 'string' && (xs[1] as Compiled).type.kind === 'string' ? aggregateTypes([subject.type, (xs[1] as Compiled).type], conn) : subject.type.kind === 'bytes' ? CHARSET_BINARY : subject.type.kind === 'string' ? subject.type.collationId : conn
      // REGEXP_SUBSTR, and REGEXP_REPLACE of text, may be NULL whatever the
      // arguments; the others only when an argument may be (8.4.11).
      const nullable = xs.some((x) => x.type.nullable)
      const type =
        name === 'REGEXP_INSTR'
          ? intType(21, nullable)
          : replace
            ? { ...stringType(16_777_216, collation, collation !== CHARSET_BINARY || nullable), field: FIELD_TYPE.LONG_BLOB }
            : stringType(charWidth(subject.type), collation, true)
      return {
        eval: (r, env) => {
          const vs = xs.map((x) => x.eval(r, env))
          if (vs.some((v) => v === null)) return null
          const v = vs as Exclude<Value, null>[]
          const int = (i: number, fallback: bigint) => (v[i] === undefined ? fallback : toInteger(v[i] as Exclude<Value, null>))
          const options = name === 'REGEXP_INSTR' ? 3 : 2
          const mt = v[at + options] === undefined ? undefined : matchType(toText(v[at + options] as Exclude<Value, null>), fn)
          const search = { subject: v[0] as Exclude<Value, null>, pattern: v[1] as Exclude<Value, null>, position: int(at, 1n), occurrence: int(at + 1, replace ? 0n : 1n), type: mt }
          if (name === 'REGEXP_INSTR') {
            const ret = int(at + 2, 0n)
            if (ret !== 0n && ret !== 1n) throw sqlError('ER_WRONG_ARGUMENTS', 'Incorrect arguments to regexp_instr: return_option must be 1 or 0.')
            return intValue(regexpInstr(search, ret === 1n))
          }
          const out = replace ? regexpReplace(search, v[2] as Exclude<Value, null>) : regexpSubstr(search)
          if (out === undefined) return null
          return collation === CHARSET_BINARY ? bytesValue(Uint8Array.from(out, (c) => c.charCodeAt(0))) : stringValue(out, collation, COERCIBILITY.IMPLICIT)
        },
        type,
      }
    }
    case 'REGEXP_LIKE': {
      if (e.args.length < 2 || e.args.length > 3) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
      const [a, p, t] = args() as [Compiled, Compiled, Compiled | undefined]
      if (a.type.kind === 'string' && p.type.kind === 'string') aggregateCollations([a.type, p.type], 'regexp_like', true)
      return {
        eval: (r, env) => {
          const mt = t === undefined ? undefined : t.eval(r, env)
          if (mt === null) return null
          const m = regexpLike(a.eval(r, env), p.eval(r, env), mt === undefined ? undefined : matchType(toText(mt), 'regexp_like'))
          return m === null ? null : bool(m)
        },
        type: boolType(true),
      }
    }
    case 'COLLATION':
    case 'CHARSET': {
      // The argument's type decides, not its value: a number, a temporal or
      // NULL is `binary`, JSON utf8mb4_bin (8.4.11). A VARCHAR(64) in utf8mb3.
      arity(1)
      const [x] = args() as [Compiled]
      const id = x.type.kind === 'json' ? CHARSET_UTF8MB4_BIN : x.type.kind === 'string' ? x.type.collationId : CHARSET_BINARY
      const info = requireCollationInfo(id)
      const answer = name === 'COLLATION' ? info.name : info.charset
      return { eval: () => stringValue(answer, CHARSET_UTF8MB3_GENERAL_CI, COERCIBILITY.IMPLICIT), type: stringType(64, CHARSET_UTF8MB3_GENERAL_CI, true) }
    }
    case 'IF': {
      arity(3)
      const [c, x, y] = args() as [Compiled, Compiled, Compiled]
      const type = aggregate([x.type, y.type], x.type.nullable || y.type.nullable, conn, 'if')
      if (type.kind === 'double') return { eval: (r, env) => doubleOf(truth(c.eval(r, env)) === true ? x.eval(r, env) : y.eval(r, env), type), type }
      const [xv, yv] = [branchOf(x, type), branchOf(y, type)]
      return { eval: (r, env) => (truth(c.eval(r, env)) === true ? xv(r, env) : yv(r, env)), type }
    }
    case 'IFNULL': {
      arity(2)
      const [x, y] = args() as [Compiled, Compiled]
      const type = aggregate([x.type, y.type], x.type.nullable && y.type.nullable, conn, 'ifnull')
      const [xv, yv] = [chosenOf(x, type), chosenOf(y, type)]
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v !== null) return xv(v)
          const w = y.eval(r, env)
          return w === null ? null : yv(w)
        },
        type,
      }
    }
    case 'COALESCE': {
      if (e.args.length === 0) arity(1)
      const xs = args()
      const type = aggregate(
        xs.map((x) => x.type),
        xs.every((x) => x.type.nullable),
        conn,
        'coalesce',
      )
      const chosen = xs.map((x) => chosenOf(x, type))
      return {
        eval: (r, env) => {
          for (let i = 0; i < xs.length; i++) {
            const v = (xs[i] as Compiled).eval(r, env)
            if (v !== null) return (chosen[i] as (v: Exclude<Value, null>) => Value)(v)
          }
          return null
        },
        type,
      }
    }
    case 'RAND': {
      // MySQL's own generator (`randominit`, `my_rnd`), so a seed gives the
      // server's sequence: RAND(1) is 0.40540353712197724. The seed is read
      // as an integer and kept to 32 bits, NULL as 0. One that reads no
      // column seeds once a statement and the rows take the sequence; one
      // that reads the row seeds again for each (8.4.11). Without one, the
      // session's own sequence.
      if (e.args.length > 1) arity(1)
      const type = { ...doubleType(false), scale: 31 }
      if (e.args.length === 0) return { eval: () => doubleValue(Math.random()), type }
      const [seed] = args() as [Compiled]
      const perRow = readsColumn(e.args)
      const state: { seeds?: RandSeeds } = {}
      const seeded = (r: Row, env: Env): RandSeeds => {
        const v = seed.eval(r, env)
        return randSeeds(v === null ? 0n : toInteger(v))
      }
      return {
        eval: (r, env) => {
          if (perRow) return doubleValue(nextRand(seeded(r, env)))
          let seeds = env.memo?.get(state) as RandSeeds | undefined
          if (seeds === undefined) {
            seeds = seeded(r, env)
            env.memo?.set(state, seeds)
          }
          return doubleValue(nextRand(seeds))
        },
        type,
      }
    }
    case 'ANY_VALUE': {
      // A value from the group, with ONLY_FULL_GROUP_BY's check switched off for it.
      arity(1)
      const [x] = args() as [Compiled]
      return { eval: x.eval, type: expressionOf(x.type) }
    }
    case 'NULLIF': {
      arity(2)
      const [x, y] = args() as [Compiled, Compiled]
      if (isText(x.type) && isText(y.type)) aggregateCollations([x.type, y.type], 'nullif', true)
      const cmp = comparer(x.type, y.type)
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          return cmp(v, y.eval(r, env)) === 0 ? null : v
        },
        type: { ...expressionOf(x.type), nullable: true },
      }
    }
    case 'CONCAT': {
      if (e.args.length === 0) arity(1)
      const xs = args()
      const derived = aggregateCollations(
        xs.map((x) => x.type),
        'concat',
        false,
      )
      // Bytes make the result bytes unless text of a stronger derivation wins (8.4.11: `'a' COLLATE utf8mb4_bin` over `x'61'`).
      const binary = derived !== undefined ? derived.collationId === CHARSET_BINARY || xs.some((x) => isBits(x.type)) : xs.some((x) => x.type.kind === 'bytes' || isBits(x.type))
      const id = binary ? CHARSET_BINARY : (derived?.collationId ?? aggregateTypes(xs.map((x) => x.type), conn))
      const coercibility = derived?.derivation ?? Math.min(...xs.map((x) => coercibilityOf(x.type)))
      // A binary argument makes the result bytes: each argument contributes
      // its own bytes, a string in its own charset, and the width is counted
      // in bytes too (8.4.11).
      const width = binary ? xs.reduce((n, x) => n + charWidth(x.type) * (x.type.kind === 'string' ? requireCollationInfo(x.type.collationId).mbmaxlen : 1), 0) : xs.reduce((n, x) => n + charWidth(x.type), 0)
      return {
        eval: (r, env) => {
          const parts: Exclude<Value, null>[] = []
          for (const x of xs) {
            const v = x.eval(r, env)
            if (v === null) return null
            parts.push(v)
          }
          if (!binary) return stringValue(parts.map(toText).join(''), id, coercibility)
          // A BIT is its bytes in a string, as on the wire (8.4.11).
          const chunks = parts.map((v, i) => (v.kind === 'bytes' ? v.v : v.kind === 'string' ? encodeCollation(v.v, v.collationId) : v.kind === 'int' && v.str !== undefined ? v.str : v.kind === 'int' && isBits((xs[i] as Compiled).type) ? bitBytes(v.v, (xs[i] as Compiled).type.length) : new TextEncoder().encode(toText(v))))
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
          let at = 0
          for (const c of chunks) {
            out.set(c, at)
            at += c.length
          }
          return bytesValue(out)
        },
        // Always nullable on 8.4.11, NOT NULL arguments or not: a result past
        // `max_allowed_packet` is NULL.
        type: { ...stringType(width, id, true), coercibility },
      }
    }
    case 'LENGTH':
    case 'OCTET_LENGTH':
    case 'CHAR_LENGTH':
    case 'CHARACTER_LENGTH': {
      arity(1)
      const [x] = args() as [Compiled]
      const chars = name.startsWith('CHAR')
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          if (v.kind === 'bytes') return intValue(BigInt(v.v.length))
          const s = toText(v)
          return intValue(BigInt(chars ? [...s].length : encodeCollation(s, v.kind === 'string' ? v.collationId : 255).length))
        },
        type: intType(10, x.type.nullable),
      }
    }
    case 'LOWER':
    case 'LCASE':
    case 'UPPER':
    case 'UCASE': {
      arity(1)
      const [x] = args() as [Compiled]
      const upper = name === 'UPPER' || name === 'UCASE'
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null || v.kind === 'bytes') return v
          const s = toText(v)
          return stringValue(upper ? s.toUpperCase() : s.toLowerCase(), v.kind === 'string' ? v.collationId : conn, v.kind === 'string' ? v.coercibility : COERCIBILITY.COERCIBLE)
        },
        // Nullable whatever the argument is, as 8.4.11 reports it.
        type: x.type.kind === 'bytes' ? { ...expressionOf(x.type), nullable: true } : { ...stringType(charWidth(x.type), x.type.kind === 'string' ? x.type.collationId : conn, true), coercibility: coercibilityOf(x.type) },
      }
    }
    case 'COERCIBILITY': {
      // Text's, as it carries it; 5 for a number or a temporal, 6 for NULL (8.4.11).
      arity(1)
      const [x] = args() as [Compiled]
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          // The type's derivation when it says one (IF over two collations is NONE whichever value it returns), else the value's.
          if (x.type.kind === 'string' && x.type.coercibility !== undefined) return intValue(BigInt(x.type.coercibility))
          if (v !== null && v.kind === 'string') return intValue(BigInt(v.coercibility))
          if (x.type.kind === 'string' || x.type.kind === 'bytes') return intValue(BigInt(coercibilityOf(x.type)))
          return intValue(x.type.kind === 'null' || v === null ? 6n : 5n)
        },
        type: intType(10, false),
      }
    }
    case 'BIN':
    case 'OCT': {
      // CONV(N, 10, 2 or 8): N read as base-10 text up to its first
      // non-digit, so BIN(2.7) is '10'; a negative number is its 64-bit
      // complement; empty text is NULL (8.4.11). A hex literal is its number.
      arity(1)
      const [x] = args() as [Compiled]
      const radix = name === 'BIN' ? 2 : 8
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          let n: bigint
          if (v.kind === 'bytes' && v.hex === true) n = hexNumber(v.v)
          else {
            const text = toText(v)
            if (text === '') return null
            const m = /^[ \t\n\r]*([+-]?)(\d*)/.exec(text) as RegExpExecArray
            n = (m[2] as string) === '' ? 0n : BigInt(m[2] as string)
            if (n > (1n << 64n) - 1n) n = (1n << 64n) - 1n
            if (m[1] === '-') n = (1n << 64n) - n
          }
          return stringValue((n & ((1n << 64n) - 1n)).toString(radix), conn, COERCIBILITY.COERCIBLE)
        },
        type: stringType(65, conn, true),
      }
    }
    case 'HEX': {
      // A string's bytes in its own charset, or a number's rounded value as
      // 64-bit two's complement: HEX(-1) is sixteen Fs, HEX(1.5) is 2 (8.4.11).
      arity(1)
      const [x] = args() as [Compiled]
      const t = x.type
      const numeric = t.kind === 'int' || t.kind === 'decimal' || t.kind === 'double'
      const bytes = byteWidth(t)
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          if (v.kind === 'int' || v.kind === 'decimal' || v.kind === 'double') {
            const n = toInteger(v)
            const clamped = n > 2n ** 64n - 1n ? 2n ** 64n - 1n : n < -MAX_SIGNED - 1n ? -MAX_SIGNED - 1n : n
            return stringValue(BigInt.asUintN(64, clamped).toString(16).toUpperCase(), conn)
          }
          const raw = valueBytes(v)
          return stringValue(hexOf(raw), conn)
        },
        type: stringType(numeric ? 16 : bytes * 2, conn, true),
      }
    }
    case 'UNHEX': {
      // Pairs of hex digits as bytes, a lone first digit as its own byte; a
      // number is read as its decimal digits, and anything not hex is NULL
      // (8.4.11 warns 1411). The width is half the argument's, in bytes.
      arity(1)
      const [x] = args() as [Compiled]
      const t = x.type
      const bytes = byteWidth(t)
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          const text = v.kind === 'bytes' ? String.fromCharCode(...v.v) : toText(v)
          if (!/^[0-9a-fA-F]*$/.test(text)) return null
          const even = text.length % 2 === 0 ? text : `0${text}`
          const out = new Uint8Array(even.length / 2)
          for (let i = 0; i < out.length; i++) out[i] = parseInt(even.slice(i * 2, i * 2 + 2), 16)
          return bytesValue(out)
        },
        type: stringType(Math.ceil(bytes / 2), CHARSET_BINARY, true),
      }
    }
    case 'ABS': {
      arity(1)
      const x = asNumber((args() as [Compiled])[0], 'DOUBLE')
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          if (v === null) return null
          const sign = compareValues(v, intValue(0n))
          const out = sign !== null && sign < 0 ? negate(v) : v.kind === 'string' || v.kind === 'bytes' ? doubleValue(Math.abs(toDouble(v))) : v
          return x.type.kind === 'double' ? doubleOf(out, floatLength(x.type.scale, true)) : out
        },
        type: x.type.literalInt !== undefined ? { ...floatLength(0, x.type.nullable), unsigned: true } : x.type.kind === 'double' ? floatLength(x.type.scale, x.type.nullable) : x.type.kind === 'string' || x.type.kind === 'bytes' ? doubleType(x.type.nullable) : x.type.kind === 'int' ? intType(x.type.length, x.type.nullable, x.type.unsigned) : expressionOf(x.type),
      }
    }
    case 'VERSION':
      arity(0)
      return text(() => ctx.serverVersion, ctx.serverVersion.length)
    case 'DATABASE':
    case 'SCHEMA':
      arity(0)
      return { ...text((env) => env.session.database, 34), type: stringType(34, conn, true) }
    case 'USER':
    case 'CURRENT_USER':
    case 'SESSION_USER':
    case 'SYSTEM_USER':
      arity(0)
      return text((env) => `${env.session.user}@localhost`, 288)
    case 'CONNECTION_ID':
      arity(0)
      return { eval: (_r, env) => intValue(BigInt(env.session.connectionId), true), type: intType(10, false, true) }
    case 'LAST_INSERT_ID': {
      // BIGINT UNSIGNED, 21 wide, as 8.4.11 reports both forms. With an
      // argument it sets the value and returns it, and the INSERT or UPDATE
      // that evaluates it reports it as its `insertId` (the `UPDATE t SET id =
      // LAST_INSERT_ID(id + 1)` sequence idiom). The value is the argument's
      // `val_int()`: an integer as it is, a negative wrapped to 64 bits; any
      // other number rounded and held to the signed range — past it, 2^63 - 1,
      // below it, 1690 (8.4.11, found by review); NULL as 0.
      if (e.args.length === 0) return { eval: (_r, env) => intValue(env.state.lastInsertId, true), type: intType(21, false, true) }
      arity(1)
      const [x] = args() as [Compiled]
      const self = deparse(e)
      return {
        eval: (r, env) => {
          const v = x.eval(r, env)
          let n = v === null ? 0n : toInteger(v)
          // An integer past 64 bits is a DECIMAL to MySQL, so it saturates too.
          if (v !== null && (v.kind !== 'int' || n > 2n ** 64n - 1n || n < -MAX_SIGNED - 1n)) {
            if (n > MAX_SIGNED) n = MAX_SIGNED
            else if (n < -MAX_SIGNED - 1n) throw sqlError('ER_DATA_OUT_OF_RANGE', `BIGINT value is out of range in '${self}'`)
          }
          env.state.lastInsertId = BigInt.asUintN(64, n)
          env.state.insertIdSet = true
          return v === null ? null : intValue(env.state.lastInsertId, true)
        },
        type: intType(21, x.type.nullable, true),
      }
    }
    case 'VALUES': {
      // Deprecated in 8.4 in favour of the row alias, and still answered.
      arity(1)
      const target = e.args[0] as Expression
      if (target.kind !== NODE.COLUMN) throw sqlError('ER_PARSE_ERROR', messages.parseError(e.name, 1))
      const iv = ctx.insertValues
      if (iv === undefined) return lit(null, NULL_TYPE)
      iv.calls++
      const { index, type } = iv.resolve(target.parts[target.parts.length - 1] as string)
      return { eval: (row) => row[index] ?? null, type }
    }
    case 'ROW_COUNT':
      arity(0)
      return { eval: (_r, env) => intValue(env.state.rowCount), type: intType(21, false) }
    case 'NOW':
    case 'CURRENT_TIMESTAMP':
    case 'LOCALTIME':
    case 'LOCALTIMESTAMP':
    case 'UTC_TIMESTAMP': {
      const fsp = fspArgument(e, ctx)
      return { eval: (_r, env) => ({ kind: 'datetime', v: clock(env.now, fsp), type: 'DATETIME', fsp }), type: datetimeType(FIELD_TYPE.DATETIME, fsp, false) }
    }
    case 'SYSDATE': {
      // The time of evaluation, not the statement's start (`Item_func_sysdate_local`).
      const fsp = fspArgument(e, ctx)
      return { eval: () => ({ kind: 'datetime', v: clock(new Date(), fsp), type: 'DATETIME', fsp }), type: datetimeType(FIELD_TYPE.DATETIME, fsp, false) }
    }
    case 'DATE_ADD':
    case 'DATE_SUB':
    case 'ADDDATE':
    case 'SUBDATE': {
      arity(2)
      const [d, i] = e.args as [Expression, Expression]
      const negate = name === 'DATE_SUB' || name === 'SUBDATE'
      // ADDDATE and SUBDATE take a bare number of days as well.
      if (isInterval(i)) return dateAdd(d, i.value, i.unit, negate, ctx)
      if (name === 'ADDDATE' || name === 'SUBDATE') return dateAdd(d, i, 'DAY', negate, ctx)
      throw sqlError('ER_PARSE_ERROR', messages.parseError(deparse(i), 1))
    }
    case 'CURDATE':
    case 'CURRENT_DATE':
    case 'UTC_DATE':
      arity(0)
      return { eval: (_r, env) => ({ kind: 'datetime', v: { ...clock(env.now, 0), hour: 0, minute: 0, second: 0 }, type: 'DATE', fsp: 0 }), type: datetimeType(FIELD_TYPE.DATE, 0, false) }
    case 'CURTIME':
    case 'CURRENT_TIME':
    case 'UTC_TIME': {
      const fsp = fspArgument(e, ctx)
      return {
        eval: (_r, env) => {
          const d = clock(env.now, fsp)
          return { kind: 'time', v: { negative: false, days: 0, hour: d.hour, minute: d.minute, second: d.second, microsecond: d.microsecond }, fsp }
        },
        type: datetimeType(FIELD_TYPE.TIME, fsp, false),
      }
    }
    case 'ISNULL': {
      arity(1)
      const x = compile(e.args[0] as Expression, ctx)
      return { eval: (r, env) => bool(x.eval(r, env) === null), type: intType(1, false) }
    }
    case 'INTERVAL': {
      // INTERVAL(n, n1, n2, …): how many bounds n is not below, NULL bounds passed over.
      if (e.args.length < 2) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
      const xs = args()
      const exact = xs.every((x) => x.type.kind === 'int' || x.type.kind === 'decimal' || x.type.kind === 'null')
      const reads = xs.map((x) => asNumber(x, exact ? 'DECIMAL' : 'DOUBLE'))
      return {
        eval: (r, env) => {
          const v = (reads[0] as Compiled).eval(r, env)
          if (v === null) return intValue(-1n)
          for (let i = 1; i < reads.length; i++) {
            const w = (reads[i] as Compiled).eval(r, env)
            if (w === null) continue
            const greater = exact ? compareValues(w, v) === 1 : toDouble(w) > toDouble(v)
            if (greater) return intValue(BigInt(i - 1))
          }
          return intValue(BigInt(reads.length - 1))
        },
        type: intType(2, false),
      }
    }
    default:
      throw unregistered(name)
  }
}

function fspArgument(e: CallNode, ctx: CompileContext): number {
  if (e.args.length === 0) return 0
  const v = compile(e.args[0] as Expression, ctx).eval([], constantEnv(ctx))
  const n = v === null ? 0 : Number(toInteger(v))
  if (n < 0 || n > 6) throw sqlError('ER_TOO_BIG_PRECISION', `Too-big precision ${n} specified for '${e.name}'. Maximum is 6.`)
  return n
}

/** The session's clock, in UTC (the `time_zone` this executor runs in). */
export function clock(now: Date, fsp: number): MysqlDateTime {
  const us = (now.getUTCMilliseconds() * 1000)
  const unit = 10 ** (6 - fsp)
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
    hour: now.getUTCHours(),
    minute: now.getUTCMinutes(),
    second: now.getUTCSeconds(),
    microsecond: Math.floor(us / unit) * unit,
  }
}

/** RAND's state: MySQL's `rand_struct`. */
interface RandSeeds {
  seed1: number
  seed2: number
}

const RAND_MAX = 0x3fffffff

/** `randominit` over the seed as `Item_func_rand::seed_random` spreads it: two 32-bit products of its low 32 bits. */
function randSeeds(n: bigint): RandSeeds {
  const tmp = BigInt.asUintN(32, n)
  return { seed1: Number(BigInt.asUintN(32, tmp * 0x10001n + 55555555n)) % RAND_MAX, seed2: Number(BigInt.asUintN(32, tmp * 0x10000001n)) % RAND_MAX }
}

/** `my_rnd`: the next value, in [0, 1). */
function nextRand(s: RandSeeds): number {
  s.seed1 = (s.seed1 * 3 + s.seed2) % RAND_MAX
  s.seed2 = (s.seed1 + s.seed2 + 33) % RAND_MAX
  return s.seed1 / RAND_MAX
}

/** The largest single-precision float, `FLT_MAX` (<cfloat>). */

/**
 * An argument of COALESCE or IFNULL, as its result holds it: a BIT beside
 * text is its bytes, and BITs alone are the number, whose text is its
 * digits even under the BIT type (8.4.11: `COALESCE(b)` of b'101' sends '5').
 */
function chosenOf(x: Compiled, result: ResultType): (v: Exclude<Value, null>) => Value {
  if (!isBits(x.type) || !(result.kind === 'bytes' || isBits(result))) return (v) => convertTo(v, result)
  const bits = x.type.length
  if (result.kind === 'bytes') return (v) => (v.kind === 'int' ? bytesValue(bitBytes(v.v, bits)) : convertTo(v, result))
  return (v) => (v.kind === 'int' ? { ...v, str: new TextEncoder().encode(v.v.toString()) } : v)
}

/** Bytes as `HEX()` writes them: two upper-case digits each. */
/** Bytes as upper-case hex digits, two to a byte. */
export function hexOf(b: Uint8Array): string {
  let out = ''
  for (const x of b) out += x.toString(16).toUpperCase().padStart(2, '0')
  return out
}
