// M5.2 — MySQL's arithmetic.
//
// The result type of an operator is chosen from its operands before anything
// is computed (`Item_num_op::find_num_type`): a double or a string anywhere
// makes the result a double, otherwise a DECIMAL anywhere makes it a DECIMAL,
// otherwise it is a BIGINT — unsigned if either operand is. Overflow is an
// error, never a wrap: `9223372036854775807 + 1` is ER_DATA_OUT_OF_RANGE.
//
// Four facts here came from a server rather than a document, through M3.2's
// precedence corpus, and each is a test:
//
//   - Negating an unsigned BIGINT that does not fit a signed one saturates at
//     -2^63 rather than wrapping or failing.
//   - `%` does not promote to unsigned the way `+`, `-` and `*` do: the
//     result follows the dividend's signedness. `DIV` *does* promote —
//     `-7 DIV (0 ^ 2)` is ER_DATA_OUT_OF_RANGE — which M3.2's corpus could not
//     show, because every vector that would is a refusal its replay skips; the
//     executor running the same corpus found it (M5.17).
//   - Division or modulo by zero is NULL, not an error.
//   - `/` of exact operands is a DECIMAL with `div_precision_increment` (4)
//     more digits of scale than the dividend, rounded half up.
import { valueOutOfRange } from './errors.ts'
import {
  MAX_SIGNED,
  MAX_UNSIGNED,
  MIN_SIGNED,
  bool,
  decimal,
  decimalFractionCapacity,
  magnitudeDigits,
  displayScale,
  double,
  int,
  rescale,
  toDecimal,
  toDouble,
  toInteger,
  truth,
  valInt,
  type DecimalValue,
  type Value,
} from './sql-value.ts'

/** `div_precision_increment`'s default. */
export const DIV_PRECISION_INCREMENT = 4
/** `DECIMAL_MAX_SCALE`, `include/decimal.h`. */
const MAX_SCALE = 30

type Kind = 'int' | 'decimal' | 'double'

/** The numeric type an operand contributes: a temporal with no fraction is an integer, as `NOW() + 0` is. */
function numericKind(v: Exclude<Value, null>): Kind {
  switch (v.kind) {
    case 'int':
      return 'int'
    // A hex literal is an unsigned BIGINT in arithmetic (8.4.11: `X'41' - 100` is 1690).
    case 'bytes':
      return v.hex === true ? 'int' : 'double'
    case 'decimal':
      return 'decimal'
    case 'datetime':
    case 'time':
      return v.fsp > 0 ? 'decimal' : 'int'
    default:
      return 'double'
  }
}

function resultKind(a: Exclude<Value, null>, b: Exclude<Value, null>): Kind {
  const x = numericKind(a)
  const y = numericKind(b)
  if (x === 'double' || y === 'double') return 'double'
  if (x === 'decimal' || y === 'decimal') return 'decimal'
  return 'int'
}

const isUnsigned = (v: Exclude<Value, null>): boolean => (v.kind === 'int' && v.unsigned) || (v.kind === 'bytes' && v.hex === true)

/**
 * What an overflow's message names: the expression's text, or a function
 * that prints it, called only when there is an error to word — a printing
 * can cost a compile, and most arithmetic never overflows.
 */
export type ExprLabel = string | (() => string)

const labelOf = (expr: ExprLabel): string => (typeof expr === 'string' ? expr : expr())

/** A BIGINT result, range-checked. `expr` names the expression in the error, as MySQL's message does. */
function checked(n: bigint, unsigned: boolean, expr: ExprLabel): Value {
  if (unsigned ? n < 0n || n > MAX_UNSIGNED : n < MIN_SIGNED || n > MAX_SIGNED) {
    // Retain the coefficient without changing direct callers' error serialization.
    throw Object.defineProperty(valueOutOfRange(unsigned ? 'BIGINT UNSIGNED' : 'BIGINT', labelOf(expr)), 'integer', { value: n })
  }
  return int(n, unsigned)
}

function decimalOp(a: DecimalValue, b: DecimalValue, op: '+' | '-' | '*'): DecimalValue {
  if (op === '*') {
    const product = decimal(a.v * b.v, a.scale + b.scale)
    const scale = product.v === 0n ? 0 : Math.min(MAX_SCALE, product.scale)
    return decimal(rescale(product, scale).v, scale, Math.min(MAX_SCALE, displayScale(a) + displayScale(b)))
  }
  const scale = Math.max(a.scale, b.scale)
  const x = rescale(a, scale).v
  const y = rescale(b, scale).v
  const v = op === '+' ? x + y : x - y
  // Subtraction and cancellation normalize zero; adding two zeros retains scale.
  return decimal(v, v === 0n && (op === '-' || x !== 0n) ? 0 : scale, Math.max(displayScale(a), displayScale(b)))
}

/** `a + b`, `a - b`, `a * b`. */
export function add(a: Value, b: Value, op: '+' | '-' | '*', expr: ExprLabel = op): Value {
  if (a === null || b === null) return null
  switch (resultKind(a, b)) {
    case 'double': {
      const x = toDouble(a)
      const y = toDouble(b)
      const r = op === '+' ? x + y : op === '-' ? x - y : x * y
      if (!Number.isFinite(r)) throw valueOutOfRange('DOUBLE', labelOf(expr))
      return double(r)
    }
    case 'decimal':
      return decimalOp(toDecimal(a), toDecimal(b), op)
    case 'int': {
      const x = toInteger(a)
      const y = toInteger(b)
      return checked(op === '+' ? x + y : op === '-' ? x - y : x * y, isUnsigned(a) || isUnsigned(b), expr)
    }
  }
}

/** Unary minus. */
export function negate(a: Value, expr: string = '-'): Value {
  if (a === null) return null
  switch (numericKind(a)) {
    case 'double':
      return double(-toDouble(a))
    case 'decimal': {
      const d = toDecimal(a)
      return decimal(-d.v, d.scale, d.display)
    }
    case 'int': {
      const n = toInteger(a)
      // Saturates rather than failing: M3.2's corpus, `3 | - ~ 4`.
      if (isUnsigned(a) && n > MAX_SIGNED) return int(MIN_SIGNED)
      return checked(-n, false, expr)
    }
  }
}

/** The quotient reserves integer words using exponent difference and leading-word order. */
function divisionCapacity(x: DecimalValue, y: DecimalValue): number {
  const a = magnitudeDigits(x.v)
  const b = magnitudeDigits(y.v)
  const digits = a.length - x.scale - b.length + y.scale
  // Only a whole-word exponent difference is sensitive to this comparison;
  // then both operands have the same leading-word width.
  const first = (a.length + 8 - x.scale % 9) % 9 + 1
  return decimalFractionCapacity(a.slice(0, first).padEnd(first, '0') >= b.slice(0, first).padEnd(first, '0') ? digits + 1 : digits)
}

/** Exact coefficient after non-rounding alignment; callers own zero and range checks. */
function decimalQuotient(a: DecimalValue, b: DecimalValue, fraction = 0): bigint {
  const scale = Math.max(a.scale, b.scale)
  return rescale(a, scale + fraction).v / rescale(b, scale).v
}

/** `a / b`: NULL for a zero divisor. */
export function divide(a: Value, b: Value, expr: ExprLabel = '/'): Value {
  if (a === null || b === null) return null
  if (resultKind(a, b) === 'double') {
    const y = toDouble(b)
    if (y === 0) return null
    return double(toDouble(a) / y)
  }
  const x = toDecimal(a)
  const y = toDecimal(b)
  if (y.v === 0n) return null
  const display = Math.min(MAX_SCALE, displayScale(x) + DIV_PRECISION_INCREMENT)
  if (x.v === 0n) return decimal(0n, 0, display)
  const capacity = divisionCapacity(x, y)
  if (capacity < 0) throw valueOutOfRange('DECIMAL', labelOf(expr))
  const words = Math.max(Math.ceil(x.scale / 9) + Math.ceil(y.scale / 9), Math.ceil((x.scale + y.scale + DIV_PRECISION_INCREMENT) / 9))
  const held = Math.min(capacity, words * 9)
  const value = decimalQuotient(x, y, held)
  return value === 0n ? decimal(0n, 0, display) : decimal(value, held, Math.min(display, held))
}

/** `a DIV b`: an integer quotient, truncated, unsigned if either side is; NULL for a zero divisor. */
export function intDivide(a: Value, b: Value, expr: ExprLabel = 'DIV'): Value {
  if (a === null || b === null) return null
  const x = toDecimal(a)
  const y = toDecimal(b)
  if (y.v === 0n) return null
  return checked(decimalQuotient(x, y), isUnsigned(a) || isUnsigned(b), expr)
}

/** `a % b` and `MOD(a, b)`: the remainder takes the dividend's sign; NULL for a zero divisor. */
export function modulo(a: Value, b: Value, expr: ExprLabel = '%'): Value {
  if (a === null || b === null) return null
  switch (resultKind(a, b)) {
    case 'double': {
      const y = toDouble(b)
      if (y === 0) return null
      return double(toDouble(a) % y)
    }
    case 'decimal': {
      const x = toDecimal(a)
      const y = toDecimal(b)
      if (y.v === 0n) return null
      const scale = Math.max(x.scale, y.scale)
      return decimal(rescale(x, scale).v % rescale(y, scale).v, scale, Math.max(displayScale(x), displayScale(y)))
    }
    case 'int': {
      const y = toInteger(b)
      if (y === 0n) return null
      return checked(toInteger(a) % y, isUnsigned(a), expr)
    }
  }
}

/** An operand of a bitwise operator: its 64-bit two's-complement pattern. */
function bits(v: Exclude<Value, null>): bigint {
  // Text is read as `val_uint` reads it: '1.5' | 0 is 1 (8.4.11).
  const n = v.kind === 'string' || v.kind === 'bytes' ? valInt(v) : numericKind(v) === 'int' ? toInteger(v) : toInteger(toDecimal(v))
  if (n > MAX_UNSIGNED) return MAX_UNSIGNED
  if (n < MIN_SIGNED) return 1n << 63n
  return n & MAX_UNSIGNED
}

/** `|`, `&`, `^`, `<<`, `>>`: always an unsigned BIGINT, whatever went in. */
export function bitwise(a: Value, b: Value, op: '|' | '&' | '^' | '<<' | '>>'): Value {
  if (a === null || b === null) return null
  const x = bits(a)
  const y = bits(b)
  switch (op) {
    case '|':
      return int(x | y, true)
    case '&':
      return int(x & y, true)
    case '^':
      return int(x ^ y, true)
    case '<<':
      return int(y >= 64n ? 0n : (x << y) & MAX_UNSIGNED, true)
    case '>>':
      return int(y >= 64n ? 0n : x >> y, true)
  }
}

/** `~a`. */
export function bitNot(a: Value): Value {
  return a === null ? null : int(~bits(a) & MAX_UNSIGNED, true)
}

/** `NOT a` and `!a`. */
export function not(a: Value): Value {
  const t = truth(a)
  return t === null ? null : bool(!t)
}
