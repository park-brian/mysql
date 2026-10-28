// Sources own the diagnostic identity and prohibited set. Callers own timing;
// this early syntax check has no catalogue, evaluator or transaction writer.
import { NODE, type Expression, type SqlMode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { nativeCallName } from './ast.ts'
import { valueGeneratorFunctionName } from './registry.ts'

export const GENERATED_ADMISSION = {
  label: 'Expression of generated column',
  unnamed: 'ER_GENERATED_COLUMN_FUNCTION_IS_NOT_ALLOWED',
  named: 'ER_GENERATED_COLUMN_NAMED_FUNCTION_IS_NOT_ALLOWED',
} as const

export const DEFAULT_ADMISSION = {
  label: 'Default value expression of column',
  unnamed: 'ER_DEFAULT_VAL_GENERATED_FUNCTION_IS_NOT_ALLOWED',
  named: 'ER_DEFAULT_VAL_GENERATED_NAMED_FUNCTION_IS_NOT_ALLOWED',
} as const

export function admitValueGenerator(expression: Expression, column: string, mode: SqlMode, diagnostic: typeof GENERATED_ADMISSION | typeof DEFAULT_ADMISSION, forbidden: { has(name: string): boolean }): void {
  const refuse = (symbol: string, suffix = ''): never => {
    throw sqlError(symbol, `${diagnostic.label} '${column}' contains a disallowed function${suffix}.`)
  }
  const quote = mode.ansiQuotes ? '"' : '`'
  const admit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return
    Object.values(value).forEach(admit)
    const n = value as Expression
    if (n.kind === NODE.SUBQUERY || n.kind === NODE.PLACEHOLDER) refuse(diagnostic.unnamed)
    if (n.kind === NODE.VARIABLE) throw sqlError('ER_DEFAULT_VAL_GENERATED_VARIABLES', `${DEFAULT_ADMISSION.label} '${column}' cannot refer user or system variables.`)
    if (n.kind !== NODE.CALL) return
    const name = nativeCallName(n)
    if (name === '') refuse(diagnostic.named, `: ${quote + n.name.replaceAll(quote, quote + quote) + quote}`)
    if (forbidden.has(name)) refuse(diagnostic.named, `: ${valueGeneratorFunctionName(name)}`)
  }
  admit(expression)
}
