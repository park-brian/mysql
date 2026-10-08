// M5.5 — the aggregate functions' values, and the precision their results are held at.
//
// D-62 keeps MySQL's value rules here and out of the executor, and the
// aggregates are value rules like any other: what `SUM` of integers is (an
// exact DECIMAL, never a wrapped BIGINT), how many digits `AVG` keeps, what an
// empty `BIT_AND` is. The executor decides which rows reach an accumulator;
// this decides what the accumulator makes of them.
//
// Every rule was read off 8.4.11 (`SELECT MIN(c), SUM(c), AVG(c) … FROM t`,
// for a column of each type) before it was written:
//
//   - `SUM` of an integer, a DECIMAL or a temporal is a DECIMAL 22 digits
//     wider than its argument (`DECIMAL_LONGLONG_DIGITS`): SUM of an INT is
//     DECIMAL(32,0), shown 33 wide with its sign; of a DECIMAL(6,2),
//     DECIMAL(28,2). Of a double or a string it is a DOUBLE.
//   - `AVG` of the same is a DECIMAL `div_precision_increment` (4) wider in
//     both precision and scale: AVG of an INT is DECIMAL(14,4), of a DATE
//     (an 8-digit number) DECIMAL(12,4).
//   - `BIT_AND` of no rows is 2^64 − 1, `BIT_OR` and `BIT_XOR` 0; every other
//     aggregate of no rows (COUNT aside) is NULL.
//   - `STD` and `VARIANCE` are the population forms, computed by Welford's
//     recurrence as `Item_sum_variance` does, so the last digit of a double
//     agrees too.
import { DIV_PRECISION_INCREMENT, divide } from './arith.ts'
import { orderValues } from './compare.ts'
import { plainValue } from './sql-value.ts'
import { MAX_UNSIGNED, decimal, double, int, rescale, toDecimal, toDouble, toInteger, type DecimalValue, type Value } from './sql-value.ts'

/** `DECIMAL_LONGLONG_DIGITS`, `include/decimal.h`: what `SUM` widens a DECIMAL by. */
export const SUM_PRECISION_INCREMENT = 22

export interface Accumulator {
  /** One row's argument. NULL is the caller's to skip or not; most aggregates skip it. */
  add(v: Exclude<Value, null>): void
  /** The aggregate over every value added so far. */
  result(): Value
}

/** `SUM`: exact over integers, DECIMALs and temporals; a double over anything else. NULL over no rows. */
export function sumAccumulator(exact: boolean): Accumulator {
  let total: DecimalValue | number | undefined
  return {
    add(v) {
      if (exact) {
        const d = toDecimal(v)
        const t = total as DecimalValue | undefined
        if (t === undefined) total = d
        else {
          const scale = Math.max(t.scale, d.scale)
          total = decimal(rescale(t, scale).v + rescale(d, scale).v, scale)
        }
      } else total = ((total as number | undefined) ?? 0) + toDouble(v)
    },
    result() {
      if (total === undefined) return null
      return typeof total === 'number' ? double(total) : total
    },
  }
}

/** `AVG`, held at the argument's scale plus `div_precision_increment` when exact. */
export function avgAccumulator(exact: boolean, argScale: number): Accumulator {
  const sum = sumAccumulator(exact)
  let count = 0
  return {
    add(v) {
      sum.add(v)
      count++
    },
    result() {
      const s = sum.result()
      if (s === null) return null
      if (!exact) return double((s as { v: number }).v / count)
      const q = divide(s, int(BigInt(count)))
      return q === null ? null : rescale(q as DecimalValue, argScale + DIV_PRECISION_INCREMENT)
    },
  }
}

/** `MIN` and `MAX`, ordering as the values' own comparison does — a string by its collation. */
export function extremeAccumulator(max: boolean): Accumulator {
  let best: Exclude<Value, null> | undefined
  return {
    add(v) {
      if (best === undefined) best = v
      else {
        const c = orderValues(v, best)
        if (max ? c > 0 : c < 0) best = v
      }
    },
    // MIN and MAX hand on a value: a hex literal's number and an ENUM's index are gone.
    result: () => (best === undefined ? null : plainValue(best)),
  }
}

/** `BIT_AND`, `BIT_OR`, `BIT_XOR` over 64-bit unsigned integers; an empty one is the operation's identity. */
export function bitAccumulator(op: 'AND' | 'OR' | 'XOR'): Accumulator {
  let acc = op === 'AND' ? MAX_UNSIGNED : 0n
  return {
    add(v) {
      const n = BigInt.asUintN(64, toInteger(v))
      acc = op === 'AND' ? acc & n : op === 'OR' ? acc | n : acc ^ n
    },
    result: () => int(acc, true),
  }
}

/**
 * The variance family: population or sample, as the variance or its square
 * root. Welford's recurrence, `variance_fp_recurrence_next` in
 * `sql/item_sum.cc`, so the rounding is the server's. A sample variance of one
 * row is NULL.
 */
export function varianceAccumulator(sample: boolean, root: boolean): Accumulator {
  let count = 0
  let mean = 0
  let m2 = 0
  return {
    add(v) {
      const x = toDouble(v)
      count++
      const delta = x - mean
      mean += delta / count
      m2 += delta * (x - mean)
    },
    result() {
      if (count === 0 || (sample && count === 1)) return null
      const variance = m2 / (sample ? count - 1 : count)
      return double(root ? Math.sqrt(variance) : variance)
    },
  }
}

/** The precision `SUM` of a DECIMAL-like argument of precision `p` is held at. */
export const sumPrecision = (p: number): number => p + SUM_PRECISION_INCREMENT

/** The precision and scale `AVG` of a DECIMAL-like argument is held at. */
export const avgPrecision = (p: number, scale: number): { precision: number; scale: number } => ({
  precision: p + DIV_PRECISION_INCREMENT,
  scale: scale + DIV_PRECISION_INCREMENT,
})
