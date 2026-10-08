// MySQL's reprint of a resolved expression (`Item::print`), as VIEW_DEFINITION
// and CHECK_CLAUSE show it. One printer for both, because the server uses one;
// what differs is how a column is named and how a string is written. What it
// prints, put to 8.4.11:
//
//   - Every operator in parentheses, `!=` as `<>`, `DIV` in capitals and
//     `MOD` as `%`; a chain of AND or OR as one group, `((a) and (b) and (c))`.
//   - NOT LIKE as `(not((a like b)))`, REGEXP as `regexp_like(a,b)`, NOT of a
//     column as `(0 = c)`, `c IS TRUE` as `((0 <> c) is true)`, MEMBER OF
//     bare, `x member of (j)`; NOT IN and NOT BETWEEN as written.
//   - A negative literal as `-(1.50)`, a float as written (`1e2`), functions
//     in lower case with their arguments joined by a bare comma, `COUNT(*)` as
//     `count(0)`, and CASE in parentheses.
//
// Anything past that is `Unprintable`, and the caller decides what to show.
import { NODE, type Expression } from '@myjs/parser'

export class Unprintable extends Error {}

export interface PrintOptions {
  /** A column reference, as this context names one. */
  readonly column: (parts: readonly string[]) => string
  /** A string literal: a view's is bare, a check's carries its charset. */
  readonly string: (value: string, charset: string | undefined) => string
  /** The text the expression was parsed from, for a float as it was written. */
  readonly source?: string
}

const OPERATORS: Readonly<Record<string, string>> = { XOR: 'xor', DIV: 'DIV', MOD: '%', '!=': '<>', IS: 'is', 'IS NOT': 'is not' }

/** A string's body as `Item_string::print` escapes it: a backslash and a quote, each after a backslash. */
export const escapeString = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const NUMBER = /^[0-9.]+(?:[eE][-+]?[0-9]+)?/

export function printExpression(e: Expression, o: PrintOptions): string {
  const p = (x: Expression): string => printExpression(x, o)
  switch (e.kind) {
    case NODE.COLUMN:
      return o.column(e.parts)
    case NODE.LITERAL:
      if (e.type === 'null') return 'NULL'
      if (e.type === 'bool') return e.value === true ? 'true' : 'false'
      if (e.type === 'string') return o.string(String(e.value), e.charset)
      if (e.type === 'int' || e.type === 'decimal') return String(e.value)
      if (e.type === 'double') {
        const written = o.source === undefined ? undefined : NUMBER.exec(o.source.slice(e.at))?.[0]
        return written ?? String(e.value)
      }
      throw new Unprintable()
    case NODE.UNARY:
      if (e.op === '-') return `-(${p(e.operand)})`
      // The optimizer's rewrite is what is stored: NOT c is (0 = c).
      if (e.op === 'NOT' || e.op === '!') return e.operand.kind === NODE.COLUMN ? `(0 = ${p(e.operand)})` : `(not(${p(e.operand)}))`
      if (e.op === 'IS NULL' || e.op === 'IS NOT NULL') return `(${p(e.operand)} ${e.op.toLowerCase()})`
      // IS [NOT] TRUE and FALSE test a truth value: a column is made one, `(0 <> c)`.
      if (/^IS (NOT )?(TRUE|FALSE|UNKNOWN)$/.test(e.op)) return `(${e.operand.kind === NODE.COLUMN ? `(0 <> ${p(e.operand)})` : p(e.operand)} ${e.op.toLowerCase()})`
      throw new Unprintable()
    case NODE.BINARY: {
      const op = e.op.toUpperCase()
      if (op === 'AND' || op === '&&' || op === 'OR' || op === '||') {
        // An AND (or OR) of ANDs is one condition with all their arguments.
        const word = op === 'AND' || op === '&&' ? 'and' : 'or'
        const flat: Expression[] = []
        const gather = (x: Expression) => {
          if (x.kind === NODE.BINARY && (word === 'and' ? x.op === 'AND' || x.op === '&&' : x.op === 'OR' || x.op === '||')) {
            gather(x.left)
            gather(x.right)
          } else flat.push(x)
        }
        gather(e)
        return `(${flat.map(p).join(` ${word} `)})`
      }
      if (op === 'IN' || op === 'NOT IN') {
        if (e.right.kind !== NODE.ROW) throw new Unprintable()
        return `(${p(e.left)} ${op.toLowerCase()} (${e.right.items.map(p).join(',')}))`
      }
      if (op === 'BETWEEN' || op === 'NOT BETWEEN') return `(${p(e.left)} ${op.toLowerCase()} ${p(e.right)} and ${p(e.extra as Expression)})`
      // `c->'$.p'` is the call it stands for, and `->>` its unquoting (8.4.11).
      if (op === '->') return `json_extract(${p(e.left)},${p(e.right)})`
      if (op === '->>') return `json_unquote(json_extract(${p(e.left)},${p(e.right)}))`
      // The only operator printed without parentheses of its own (8.4.11).
      if (op === 'MEMBER OF') return `${p(e.left)} member of (${p(e.right)})`
      if (op === 'LIKE' || op === 'NOT LIKE') {
        const escape = e.extra === undefined ? '' : ` escape ${p(e.extra as Expression)}`
        const like = `(${p(e.left)} like ${p(e.right)}${escape})`
        return op === 'LIKE' ? like : `(not(${like}))`
      }
      if (op === 'REGEXP' || op === 'RLIKE' || op === 'NOT REGEXP' || op === 'NOT RLIKE') {
        const call = `regexp_like(${p(e.left)},${p(e.right)})`
        return op.startsWith('NOT') ? `(not(${call}))` : call
      }
      return `(${p(e.left)} ${OPERATORS[op] ?? e.op} ${p(e.right)})`
    }
    case NODE.CALL: {
      if (e.over !== undefined || e.distinct === true || e.orderBy !== undefined) throw new Unprintable()
      const star = e.args.length === 1 && e.args[0]?.kind === NODE.COLUMN && e.args[0].parts.at(-1) === '*'
      return `${e.name.toLowerCase()}(${star ? '0' : e.args.map(p).join(',')})`
    }
    case NODE.CASE:
      return `(case ${e.operand === undefined ? '' : `${p(e.operand)} `}${e.whens.map((w) => `when ${p(w.when)} then ${p(w.then)}`).join(' ')}${e.else === undefined ? '' : ` else ${p(e.else)}`} end)`
    default:
      throw new Unprintable()
  }
}
