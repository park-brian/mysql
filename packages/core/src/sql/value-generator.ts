// Sources own the diagnostic identity and prohibited set. Callers own timing;
// this early syntax check has no catalogue, evaluator or transaction writer.
import { NODE, type Expression, type SqlMode, type CallNode } from '@myjs/parser'
import { sqlError } from '@myjs/protocol'
import { nativeCallName, visitPostorder } from './ast.ts'
import { canonicalFunctionName } from './registry.ts'

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

/** Stored references retain each component and the session's identifier quotes. */
export function quotedFunctionName(n: Pick<CallNode, 'schema' | 'name'>, mode: SqlMode): string {
  const quote = mode.ansiQuotes ? '"' : '`'
  const parts = n.schema === undefined ? [n.name] : [n.schema, n.name]
  return parts.map(part => quote + part.replaceAll(quote, quote + quote) + quote).join('.')
}

export function admitValueGenerator(expression: Expression, column: string, mode: SqlMode, diagnostic: typeof GENERATED_ADMISSION | typeof DEFAULT_ADMISSION, forbidden: { has(name: string): boolean }): void {
  const refuse = (symbol: string, suffix = ''): never => {
    throw sqlError(symbol, `${diagnostic.label} '${column}' contains a disallowed function${suffix}.`)
  }
  visitPostorder(expression, (value) => {
    const n = value as Expression
    if (n.kind === NODE.SUBQUERY || n.kind === NODE.PLACEHOLDER) refuse(diagnostic.unnamed)
    if (n.kind === NODE.VARIABLE) throw sqlError('ER_DEFAULT_VAL_GENERATED_VARIABLES', `${DEFAULT_ADMISSION.label} '${column}' cannot refer user or system variables.`)
    if (n.kind !== NODE.CALL) return
    const name = nativeCallName(n)
    if (name === '') refuse(diagnostic.named, `: ${quotedFunctionName(n, mode)}`)
    if (forbidden.has(name)) refuse(diagnostic.named, `: ${canonicalFunctionName(name)}`)
  })
}
