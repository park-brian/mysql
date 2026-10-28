// M5.31 — generated columns, VIRTUAL and STORED, as 8.4.11 defines and fills
// them.
//
// A column `AS (expr)` holds its expression as written, and whether it is
// STORED. Both kinds are computed as a row is written, from the row's values
// as stored, in column order, and kept: a VIRTUAL column's value is the one
// MySQL would compute when read, since nothing an expression may name can
// change between the write and the read. What 8.4.11 refuses at CREATE:
//
//   - a DEFAULT on one (1221);
//   - a column the table lacks (1054, "in 'generated column function'"), a
//     generated column at or after its own place (3107), an AUTO_INCREMENT
//     column (3109);
//   - a subquery (3102), a variable (3772, in DEFAULT's words), a function
//     whose value is not the row's alone (3763, naming it);
//   - an aggregate (1111) or window function (3593).
//
// A value written to one is 3105, unless it is DEFAULT. A virtual column takes
// no foreign key (3733), and a column one names may not be dropped (3108).
//
// Named divergence: 8.4.11 computes a VIRTUAL column each time a statement
// reads it, so what its expression warns of is warned again on every read of
// it, and is an error to a strict UPDATE or DELETE reading the row; here the
// value is computed once, as the row is written.
import type { ColumnDef } from '@myjs/engine'
import { NODE, parseExpression, type ColumnDefinition, type Expression, type SqlMode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { admitValueGenerator, GENERATED_ADMISSION } from './value-generator.ts'
import { wrongUsage } from './errors.ts'
import { someNode } from './ast.ts'
import { columnIndex as indexOfColumn, unknownColumnError } from './scope.ts'
import { isAggregate } from './group.ts'
import { windowNotAllowed } from './window.ts'
import { escapePrinted, printTableExpression, Unprintable } from './print.ts'
import { invalidGroupFunction, NOT_ROW_DETERMINED } from './registry.ts'

export interface Generation {
  /** The expression as written. */
  readonly text: string
  readonly stored: boolean
}

/** A column's generation, if it is a generated column. */
export function generationOf(column: ColumnDef): Generation | undefined {
  const text = column.attributes?.['generated']
  return typeof text === 'string' ? { text, stored: column.attributes?.['stored'] === true } : undefined
}

/**
 * The expression as the server prints it back (`Item::print`): a column by
 * its name, a string with the charset it was read in. SHOW CREATE TABLE
 * wraps it in parentheses; GENERATION_EXPRESSION does not.
 */
export function printGeneration(column: ColumnDef, generation: Generation, information = false): string {
  const stored = column.attributes?.['generatedCharset']
  const charset = typeof stored === 'string' ? stored : 'utf8mb4'
  let printed: string
  try {
    printed = printTableExpression(parseExpression(generation.text), charset, generation.text)
  } catch (e) {
    if (!(e instanceof Unprintable)) throw e
    return information ? escapePrinted(generation.text, 'binary') : generation.text
  }
  return information ? escapePrinted(printed, charset) : printed
}

/** The connection's charset at CREATE or ALTER, which the expression's strings were read in, kept for printing them. */
export function stampGenerated(columns: readonly ColumnDef[], charset: string): ColumnDef[] {
  return columns.map((c) => (generationOf(c) === undefined || c.attributes?.['generatedCharset'] !== undefined ? c : { ...c, attributes: { ...c.attributes, generatedCharset: charset } }))
}

/** DEFAULT and generated expressions are mutually exclusive in both DDL phases. */
export function checkGeneratedDefault(column: Pick<ColumnDefinition, 'generated' | 'default'>): void {
  if (column.generated !== undefined && column.default !== undefined) throw wrongUsage('DEFAULT', 'generated column')
}

/** Early generated-expression admission, before references, aggregates or table effects. */
export function checkGeneratedAdmission(expression: Expression, column: string, mode: SqlMode): void {
  admitValueGenerator(expression, column, mode, GENERATED_ADMISSION, NOT_ROW_DETERMINED)
}

/** The table's generated columns, checked as CREATE TABLE and ALTER TABLE check them. */
export function checkGenerated(columns: readonly ColumnDef[], mode: SqlMode): void {
  columns.forEach((column, at) => {
    const generation = generationOf(column)
    if (generation === undefined) return
    const expression = parseExpression(generation.text)
    checkGeneratedAdmission(expression, column.name, mode)
    someNode(expression, (e) => {
      const n = e as Expression
      switch (n.kind) {
        case NODE.COLUMN: {
          const rawName = n.parts[n.parts.length - 1] as string
          const i = indexOfColumn(columns, rawName)
          if (i < 0) throw unknownColumnError(rawName, 'generated column function')
          const other = columns[i] as ColumnDef
          if (generationOf(other) !== undefined && i >= at) throw sqlError('ER_GENERATED_COLUMN_NON_PRIOR', 'Generated column can refer only to generated columns defined prior to it.')
          if (other.autoIncrement === true) throw sqlError('ER_GENERATED_COLUMN_REF_AUTO_INC', `Generated column '${column.name}' cannot refer to auto-increment column.`)
          return false
        }
        case NODE.CALL:
          if (n.over !== undefined) windowNotAllowed(n)
          if (isAggregate(n)) throw invalidGroupFunction()
          break
      }
      return undefined
    })
  })
}
