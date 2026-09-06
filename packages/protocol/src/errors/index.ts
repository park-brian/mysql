// D-30 — the typed-error taxonomy, resolved against the generated table.
//
// `@myjs/bytes` defines `MyjsError`/`ProtocolError` but deliberately knows no
// error numbers: it has no dependencies. This module is where a symbol becomes
// an errno and a SQLSTATE, using the table M1.6 generates from MySQL's own
// source (D-14) rather than anything transcribed by hand.
//
// D-29: the table carries facts only. Message text is ours (see `messages.ts`).

import { MyjsError, ProtocolError } from '@myjs/bytes'
import { PACKED_ERROR_TABLE } from './table.ts'

/** MySQL's fallback SQLSTATE for a code that declares none. */
export const DEFAULT_SQLSTATE = 'HY000'

interface Entry {
  readonly errno: number
  readonly symbol: string
  readonly sqlState: string
}

let bySymbol: Map<string, Entry> | null = null
let byErrno: Map<number, Entry> | null = null

/**
 * Expand the packed table on first lookup.
 *
 * The table is ~2,100 entries. Shipping it as an object literal costs several
 * times what the packed string costs after gzip, and most connections never
 * look up more than a handful of codes.
 */
function load(): { bySymbol: Map<string, Entry>; byErrno: Map<number, Entry> } {
  if (bySymbol === null || byErrno === null) {
    const s = new Map<string, Entry>()
    const n = new Map<number, Entry>()
    for (const line of PACKED_ERROR_TABLE.split('\n')) {
      if (line === '') continue
      const sp1 = line.indexOf(' ')
      const sp2 = line.indexOf(' ', sp1 + 1)
      const errno = Number(line.slice(0, sp1))
      const symbol = sp2 === -1 ? line.slice(sp1 + 1) : line.slice(sp1 + 1, sp2)
      const sqlState = sp2 === -1 ? DEFAULT_SQLSTATE : line.slice(sp2 + 1)
      const entry: Entry = { errno, symbol, sqlState }
      s.set(symbol, entry)
      // Some symbols share a number (aliases); the first wins for errno lookup.
      if (!n.has(errno)) n.set(errno, entry)
    }
    bySymbol = s
    byErrno = n
  }
  return { bySymbol, byErrno }
}

/** The MySQL error number for a symbol, e.g. `ER_DUP_ENTRY` -> 1062. */
export function errnoOf(symbol: string): number {
  const entry = load().bySymbol.get(symbol)
  if (entry === undefined) {
    throw new MyjsError('UNKNOWN_ERROR_SYMBOL', `no such MySQL error symbol: ${symbol}`)
  }
  return entry.errno
}

/** The symbol for a number, or undefined if the server never defined one. */
export function symbolOf(errno: number): string | undefined {
  return load().byErrno.get(errno)?.symbol
}

/** The SQLSTATE for a symbol or number; `HY000` when none is declared. */
export function sqlStateOf(symbolOrErrno: string | number): string {
  const table = load()
  const entry =
    typeof symbolOrErrno === 'number'
      ? table.byErrno.get(symbolOrErrno)
      : table.bySymbol.get(symbolOrErrno)
  return entry?.sqlState ?? DEFAULT_SQLSTATE
}

export function hasErrorSymbol(symbol: string): boolean {
  return load().bySymbol.has(symbol)
}

/**
 * An error a client sees, in `mysql2`'s exact shape (doc 42): `code`, `errno`,
 * `sqlState`, `sqlMessage` — so existing `catch` blocks keep working.
 */
export class SqlError extends MyjsError {
  readonly sqlMessage: string

  constructor(symbol: string, sqlMessage: string, options: { errno?: number; sqlState?: string } = {}) {
    const errno = options.errno ?? errnoOf(symbol)
    const sqlState = options.sqlState ?? sqlStateOf(symbol)
    super(symbol, sqlMessage, { errno, sqlState })
    this.sqlMessage = sqlMessage
  }
}

/** Build a `SqlError` from a symbol and an already-formatted message. */
export function sqlError(symbol: string, sqlMessage: string): SqlError {
  return new SqlError(symbol, sqlMessage)
}

/**
 * A framing or parse fault that is also reportable to a client.
 *
 * `ProtocolError` lives in `@myjs/bytes` without numbers; this attaches them,
 * so a `ER_NET_PACKETS_OUT_OF_ORDER` raised by the framer can be written out
 * as a real ERR packet.
 */
export function protocolError(symbol: string, message: string): ProtocolError {
  return new ProtocolError(symbol, message, { errno: errnoOf(symbol), sqlState: sqlStateOf(symbol) })
}

export { ERROR_TABLE_SOURCE, ERROR_TABLE_SOURCE_SHA256, ERROR_TABLE_SIZE } from './table.ts'
