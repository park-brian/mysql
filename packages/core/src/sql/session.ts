// M5.14 — a connection's transaction, and what makes one statement atomic.
//
// Three shapes of transaction, as MySQL has them:
//
//   - **autocommit** (the default): each statement is its own transaction,
//     begun before it and committed after it — or rolled back, if it fails.
//   - **explicit**: `BEGIN` / `START TRANSACTION` opens one that lasts until
//     `COMMIT` or `ROLLBACK`, whatever `autocommit` says.
//   - **implicit**, with `autocommit = 0`: the first statement opens one and
//     it lasts until `COMMIT` or `ROLLBACK`.
//
// Inside a transaction that outlives the statement, a failing statement is
// undone and the transaction is not: each statement runs from a savepoint and
// rolls back to it on error (D-64), as InnoDB's statement rollback does. A
// multi-row INSERT whose third row is a duplicate therefore leaves nothing of
// its first two, and the transaction's earlier statements stand.
//
// DDL commits first (MySQL's implicit commit) and then runs as a transaction
// of its own, which is what `Catalog` already does (D-59).
import type { Isolation, Store, Trx } from '@myjs/engine'
import { sqlError, type Session } from '@myjs/protocol'
import { intValue, stringValue, type Condition, type Value } from '@myjs/types'
import type { SessionValues } from './compile.ts'
import type { ServerState } from './admin.ts'

/** `READ UNCOMMITTED` reads committed data and `SERIALIZABLE` is `REPEATABLE READ`: one writer (D-08) leaves nothing between them to tell apart. */
export function isolationOf(level: string): Isolation {
  const l = level.toUpperCase().replace(/[-_]/g, ' ')
  return l === 'READ COMMITTED' || l === 'READ UNCOMMITTED' ? 'READ COMMITTED' : 'REPEATABLE READ'
}

/**
 * The diagnostics area: one statement's conditions, as SHOW WARNINGS lists
 * them (at most `max_error_count`, 1,024), and how many there were.
 */
export interface Diagnostics {
  readonly conditions: readonly Condition[]
  readonly warnings: number
  readonly errors: number
}

const NO_DIAGNOSTICS: Diagnostics = { conditions: [], warnings: 0, errors: 0 }

export class SqlSession implements SessionValues {
  readonly session: Session
  readonly #server: ServerState
  /** A transaction that outlives one statement: explicit, or implicit under `autocommit = 0`. */
  trx: Trx | undefined
  readOnly = false
  readonly savepoints = new Map<string, number>()
  readonly userVariables = new Map<string, Value>()
  /** What the session has `SET` that is not one of the variables it holds itself. */
  readonly ownVariables = new Map<string, Value>()
  lastInsertId = 0n
  insertIdSet = false
  rowCount = -1n
  /** `SET SESSION TRANSACTION ISOLATION LEVEL`. */
  isolation: Isolation = 'REPEATABLE READ'
  /** `SET TRANSACTION …` with no scope: the next transaction only. */
  nextIsolation: Isolation | undefined
  /**
   * Whether the session has assigned its own `sql_mode`. On 8.4.11 that
   * changes how a select item is named: before it, an item ending in a word
   * keeps the whitespace after it (`-id `); after any `SET sql_mode = …`,
   * even to the value it already had, it does not. Observed, not explained.
   */
  sqlModeAssigned = false
  /** The last statement's diagnostics, which SHOW WARNINGS and SHOW ERRORS read and leave alone. */
  diagnostics: Diagnostics = NO_DIAGNOSTICS
  /** The diagnostics as the running statement began: what `@@warning_count` reads (8.4.11). */
  previous: Diagnostics = NO_DIAGNOSTICS

  constructor(session: Session, server: ServerState) {
    this.session = session
    this.#server = server
    // A session starts at the server's level, as `SET GLOBAL TRANSACTION` leaves it.
    this.isolation = isolationOf(String(server.vars.get('transaction_isolation') ?? 'REPEATABLE-READ'))
  }

  /**
   * `SET SESSION TRANSACTION ISOLATION LEVEL …` and `SET transaction_isolation
   * = …` are one setting: what transactions run at, and what
   * `@@transaction_isolation` reads back — in MySQL's spelling, `READ-COMMITTED`.
   */
  setIsolation(level: string): void {
    const name = level.toUpperCase().replace(/[ _]/g, '-')
    if (!['READ-UNCOMMITTED', 'READ-COMMITTED', 'REPEATABLE-READ', 'SERIALIZABLE'].includes(name)) {
      throw sqlError('ER_WRONG_VALUE_FOR_VAR', `Variable 'transaction_isolation' can't be set to the value of '${level}'`)
    }
    this.isolation = isolationOf(name)
    this.ownVariables.set('transaction_isolation', stringValue(name, 255))
  }

  systemVariable(name: string, scope: 'GLOBAL' | 'SESSION' | undefined, session: Session): Value | undefined {
    if (scope !== 'GLOBAL' && (name === 'warning_count' || name === 'error_count')) return intValue(BigInt(name === 'warning_count' ? this.previous.warnings : this.previous.errors), true)
    return this.#server.systemVariable(name, scope, session, this.ownVariables)
  }

  #begin(store: Store): Trx {
    const trx = store.begin(this.nextIsolation ?? this.isolation)
    this.nextIsolation = undefined
    return trx
  }

  /** `START TRANSACTION`: whatever is open commits first. */
  begin(store: Store, options: { readonly readOnly?: boolean; readonly snapshot?: boolean } = {}): void {
    this.commit()
    this.trx = this.#begin(store)
    this.readOnly = options.readOnly === true
    if (options.snapshot === true) void this.trx.view
    this.#sync()
  }

  commit(): void {
    const trx = this.trx
    this.#end()
    trx?.commit()
  }

  rollback(): void {
    const trx = this.trx
    this.#end()
    trx?.rollback()
  }

  #end(): void {
    this.trx = undefined
    this.readOnly = false
    this.savepoints.clear()
    this.#sync()
  }

  #sync(): void {
    this.session.inTransaction = this.trx !== undefined
  }

  savepoint(name: string): void {
    // Outside a transaction a savepoint has nothing to mark, and is not an error.
    if (this.trx === undefined) return
    const key = name.toLowerCase()
    this.savepoints.delete(key)
    this.savepoints.set(key, this.trx.savepoint())
  }

  rollbackTo(name: string): void {
    const key = name.toLowerCase()
    const at = this.savepoints.get(key)
    if (this.trx === undefined || at === undefined) throw sqlError('ER_SP_DOES_NOT_EXIST', `SAVEPOINT ${name} does not exist`)
    this.trx.rollbackTo(at)
    // Later savepoints are gone; this one stays.
    let after = false
    for (const k of [...this.savepoints.keys()]) {
      if (after) this.savepoints.delete(k)
      if (k === key) after = true
    }
  }

  release(name: string): void {
    const key = name.toLowerCase()
    if (!this.savepoints.has(key)) throw sqlError('ER_SP_DOES_NOT_EXIST', `SAVEPOINT ${name} does not exist`)
    let after = false
    for (const k of [...this.savepoints.keys()]) {
      if (k === key) after = true
      if (after) this.savepoints.delete(k)
    }
  }

  /**
   * Run one statement in the session's transaction. `write` says whether it
   * changes data: a write takes the writer slot first, so that a busy slot is
   * found before anything has happened and the statement can simply be run
   * again (D-53). Returns what `run` returns; on an error the statement's
   * effects are undone and the error rethrown.
   */
  statement<T>(store: Store, write: boolean, run: (trx: Trx) => T): T {
    return finish(this.steps(store, write, function* (trx) {
      return run(trx)
    }))
  }

  /**
   * `statement()` for a statement that pauses (D-77): `run` is a generator
   * that yields between mini-transactions, and whoever drives this one
   * decides when to resume it; `statement()` is this run straight through. The transaction is the same — the
   * statement's own under autocommit, the session's otherwise — and so is
   * its end: a failure, or an error thrown in at a pause, rolls back the
   * statement whole. The writer slot is held across every pause, so no
   * other writer, DDL or purge changes a page while it waits.
   */
  *steps<T>(store: Store, write: boolean, run: (trx: Trx) => Generator<void, T>): Generator<void, T> {
    if (write && this.readOnly) throw sqlError('ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION', 'Cannot execute statement in a READ ONLY transaction.')
    if (this.trx === undefined && !this.session.autocommit) {
      this.trx = this.#begin(store)
      this.#sync()
    }
    const kept = this.trx
    if (kept === undefined) {
      const trx = this.#begin(store)
      try {
        if (write) trx.lock()
        const out = yield* run(trx)
        trx.commit()
        return out
      } catch (e) {
        trx.rollback()
        throw e
      }
    }
    kept.statement()
    if (write) kept.lock()
    const at = kept.savepoint()
    try {
      return yield* run(kept)
    } catch (e) {
      if (kept.state === 'active') kept.rollbackTo(at)
      throw e
    }
  }
}

/** A generator run to its end without pausing, and what it returns. */
export function finish<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next()
    if (r.done === true) return r.value
  }
}
