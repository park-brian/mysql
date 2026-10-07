// Types for round-trip.mjs, so the unit tests can import it under `tsc`.
import type { DeparseOptions, ParseStatementOptions, Statement } from '@myjs/parser'

export function withoutPositions<T>(node: T): T
export function roundTrip(
  ast: Statement,
  options?: ParseStatementOptions & DeparseOptions,
): { sql: string; error: string } | null
export function parsed(sql: string): Statement
export function same(a: string, b: string): void
export function refused(...sqls: string[]): void
