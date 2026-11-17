// M5.10 — the functions of doubles: PI, POW, POWER, SQRT, EXP, LN, LOG,
// LOG2, LOG10, SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, COT, DEGREES and
// RADIANS; and BIT_COUNT.
//
// Written against `tools/capture-more-functions.mjs`'s corpus, captured from
// 8.4.11 first. An argument is read as a double, text with its 1292; a
// result that is not finite is 1690 naming the expression as written, and a
// logarithm of a non-positive number is NULL with 3020.
import { deparse, type CallNode } from '@myjs/parser'
import { doubleValue, intValue, toDouble, valueOutOfRange } from '@myjs/types'
import { asNumber, compile, raise, readNonNull, type CompileContext, type Compiled, type Env, type Row } from './compile.ts'
import { doubleType, intType } from './meta.ts'
import { nativeArity, unregistered } from './registry.ts'
import { intReader } from './string-functions.ts'

const UNARY = {
  SQRT: (x: number) => x < 0 ? null : Math.sqrt(x),
  EXP: Math.exp,
  SIN: Math.sin,
  COS: Math.cos,
  TAN: Math.tan,
  ASIN: (x: number) => x < -1 || x > 1 ? null : Math.asin(x),
  ACOS: (x: number) => x < -1 || x > 1 ? null : Math.acos(x),
  COT: (x: number) => 1 / Math.tan(x),
}
const LOGARITHMS = { LN: Math.log, LOG2: Math.log2, LOG10: Math.log10 }

export const MATH_FUNCTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(UNARY), ...Object.keys(LOGARITHMS),
  'PI', 'BIT_COUNT', 'LOG', 'DEGREES', 'RADIANS', 'ATAN', 'ATAN2', 'POW', 'POWER',
])

/** A double argument read with its 1292. */
function doubleReader(c: Compiled): (r: Row, env: Env) => number | null {
  return readNonNull(asNumber(c, 'DOUBLE').eval, toDouble)
}

function invalidLogarithm(env: Env): null {
  raise(env, 3020, 'Invalid argument for logarithm')
  return null
}

export function mathFunction(name: string, e: CallNode, ctx: CompileContext): Compiled {
  const xs = e.args.map((a) => compile(a, ctx))
  const label = deparse(e)
  const arity = nativeArity(e.name, xs.length)
  switch (name) {
    case 'PI':
      arity(0)
      return { eval: () => doubleValue(Math.PI), type: { ...doubleType(false, 8), scale: 6 } }
    case 'BIT_COUNT': {
      arity(1)
      const x = intReader(xs[0] as Compiled)
      return {
        eval: readNonNull(x, (n) => {
          let u = BigInt.asUintN(64, n)
          let c = 0n
          while (u > 0n) {
            c += u & 1n
            u >>= 1n
          }
          return intValue(c)
        }),
        type: intType(21, (xs[0] as Compiled).type.nullable),
      }
    }
  }

  const checkedDouble = (out: number) => {
    if (!Number.isFinite(out)) throw valueOutOfRange('DOUBLE', label)
    return doubleValue(out)
  }
  // The numeric functions of doubles. Logarithms own their domain diagnostics.
  const one = (f: (x: number, env: Env) => number | null, nullable = true, checked = true): Compiled => {
    arity(1)
    const x = doubleReader(xs[0] as Compiled)
    return {
      eval: readNonNull(x, (v, env) => {
        const out = f(v, env)
        if (out === null) return null
        return checked ? checkedDouble(out) : doubleValue(out)
      }),
      type: doubleType(nullable),
    }
  }
  const logged = (f: (x: number) => number): Compiled =>
    one((x, env) => x <= 0 ? invalidLogarithm(env) : f(x), true, false)
  if (Object.hasOwn(UNARY, name)) return one(UNARY[name as keyof typeof UNARY])
  if (Object.hasOwn(LOGARITHMS, name)) return logged(LOGARITHMS[name as keyof typeof LOGARITHMS])
  switch (name) {
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
          if (base <= 0) return invalidLogarithm(env)
          const v = x(r, env)
          if (v === null) return null
          if (v <= 0 || base === 1) return invalidLogarithm(env)
          return doubleValue(Math.log(v) / Math.log(base))
        },
        type: doubleType(true),
      }
    }
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
          return checkedDouble(pow ? Math.pow(x, y) : Math.atan2(x, y))
        },
        type: doubleType(true),
      }
    }
  }
  throw unregistered(name)
}
