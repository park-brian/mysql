// M5.10 — the functions of doubles: PI, POW, POWER, SQRT, EXP, LN, LOG,
// LOG2, LOG10, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, COT, DEGREES and
// RADIANS; and BIT_COUNT.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. An argument is read as a double, text with its 1292; a
// result that is not finite is 1690 naming the expression as written, and a
// logarithm of a non-positive number is NULL with 3020.
import { deparse, type CallNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { doubleValue, intValue, toDouble } from '@myjs/types'
import { asNumber, compile, raise, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { doubleType, intType, type ResultType } from './meta.ts'
import { unregistered } from './registry.ts'
import { intReader } from './string-functions.ts'

export const MATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'PI', 'BIT_COUNT', 'SQRT', 'EXP', 'LN', 'LOG2', 'LOG10', 'LOG', 'SIN', 'COS', 'TAN', 'ASIN',
  'ACOS', 'COT', 'DEGREES', 'RADIANS', 'ATAN', 'ATAN2', 'POW', 'POWER',
])

/** A double argument read with its 1292. */
function doubleReader(c: Compiled): (r: Row, env: Env) => number | null {
  const n = asNumber(c, 'DOUBLE')
  return (r, env) => {
    const v = n.eval(r, env)
    return v === null ? null : toDouble(v)
  }
}

/** ER_DATA_OUT_OF_RANGE for a double that is infinite or not a number, naming the expression as written. */
const doubleOutOfRange = (expr: string) => sqlError('ER_DATA_OUT_OF_RANGE', `DOUBLE value is out of range in '${expr}'`)

export function mathFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const xs = e.args.map((a) => compile(a, ctx))
  const label = deparse(e)
  const arity = (min: number, max = min): void => {
    if (xs.length < min || xs.length > max) throw sqlError('ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT', `Incorrect parameter count in the call to native function '${e.name}'`)
  }
  const dbl = (nullable = true): ResultType => doubleType(nullable, 23)
  switch (name) {
    case 'PI':
      arity(0)
      return { eval: () => doubleValue(Math.PI), type: { ...doubleType(false, 8), scale: 6 } }
    case 'BIT_COUNT': {
      arity(1)
      const x = intReader(xs[0] as Compiled)
      return {
        eval: (r, env) => {
          const n = x(r, env)
          if (n === null) return null
          let u = BigInt.asUintN(64, n)
          let c = 0n
          while (u > 0n) {
            c += u & 1n
            u >>= 1n
          }
          return intValue(c)
        },
        type: intType(21, (xs[0] as Compiled).type.nullable),
      }
    }
  }

  // The numeric functions of doubles.
  const one = (f: (x: number) => number | null, nullable = true): Compiled => {
    arity(1)
    const x = doubleReader(xs[0] as Compiled)
    return {
      eval: (r, env) => {
        const v = x(r, env)
        if (v === null) return null
        const out = f(v)
        if (out === null) return null
        if (!Number.isFinite(out)) throw doubleOutOfRange(label)
        return doubleValue(out)
      },
      type: dbl(nullable),
    }
  }
  const logOf = (f: (x: number) => number) => (env: Env, x: number): number | null => {
    if (x <= 0) {
      raise(env, 3020, 'Invalid argument for logarithm')
      return null
    }
    return f(x)
  }
  const logged = (f: (x: number) => number): Compiled => {
    arity(1)
    const x = doubleReader(xs[0] as Compiled)
    const g = logOf(f)
    return {
      eval: (r, env) => {
        const v = x(r, env)
        if (v === null) return null
        const out = g(env, v)
        return out === null ? null : doubleValue(out)
      },
      type: dbl(),
    }
  }
  switch (name) {
    case 'SQRT':
      return one((x) => (x < 0 ? null : Math.sqrt(x)))
    case 'EXP':
      return one(Math.exp)
    case 'LN':
      return logged(Math.log)
    case 'LOG2':
      return logged(Math.log2)
    case 'LOG10':
      return logged(Math.log10)
    case 'LOG': {
      if (xs.length === 1) return logged(Math.log)
      arity(2)
      const b = doubleReader(xs[0] as Compiled)
      const x = doubleReader(xs[1] as Compiled)
      return {
        eval: (r, env) => {
          // The base is read and judged before the value is read (`Item_func_log::val_real`).
          const base = b(r, env)
          if (base === null) return null
          if (base <= 0) {
            raise(env, 3020, 'Invalid argument for logarithm')
            return null
          }
          const v = x(r, env)
          if (v === null) return null
          if (v <= 0 || base === 1) {
            raise(env, 3020, 'Invalid argument for logarithm')
            return null
          }
          return doubleValue(Math.log(v) / Math.log(base))
        },
        type: dbl(),
      }
    }
    case 'SIN':
      return one(Math.sin)
    case 'COS':
      return one(Math.cos)
    case 'TAN':
      return one(Math.tan)
    case 'ASIN':
      return one((x) => (x < -1 || x > 1 ? null : Math.asin(x)))
    case 'ACOS':
      return one((x) => (x < -1 || x > 1 ? null : Math.acos(x)))
    case 'COT':
      return one((x) => 1 / Math.tan(x))
    case 'DEGREES':
      return one((x) => (x * 180) / Math.PI, (xs[0] as Compiled).type.nullable)
    case 'RADIANS':
      return one((x) => (x * Math.PI) / 180, (xs[0] as Compiled).type.nullable)
    case 'ATAN':
      if (xs.length === 1) return one(Math.atan)
    // falls through
    case 'ATAN2':
    case 'POW':
    case 'POWER': {
      arity(2)
      const a = doubleReader(xs[0] as Compiled)
      const b = doubleReader(xs[1] as Compiled)
      const pow = name === 'POW' || name === 'POWER'
      return {
        eval: (r, env) => {
          // POW reads both; ATAN stops at a NULL first (8.4.11).
          const x = a(r, env)
          if (x === null && !pow) return null
          const y = b(r, env)
          if (x === null || y === null) return null
          const out = pow ? Math.pow(x, y) : Math.atan2(x, y)
          if (!Number.isFinite(out)) throw doubleOutOfRange(label)
          return doubleValue(out)
        },
        type: dbl(),
      }
    }
  }
  throw unregistered(name)
}
