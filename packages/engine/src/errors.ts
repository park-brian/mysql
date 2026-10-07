// Typed errors (ground rule 5). A malformed page, a full pool or a key too long
// for the format is an `EngineError` — never a bare `Error`, never a crash.
//
// The codes a client may see carry MySQL's number and SQLSTATE, written out as
// `@myjs/types` writes its own: `@myjs/engine` does not depend on
// `@myjs/protocol`, and `engine-errors.test.ts` checks these against the
// generated table so the copy cannot drift.
import { MyjsError } from '@myjs/bytes'

export class EngineError extends MyjsError {}

/** A page that failed verification, or whose contents contradict its header. */
export function corrupt(pageNo: number, what: string): EngineError {
  return new EngineError('ENGINE_CORRUPT_PAGE', `page ${pageNo}: ${what}`)
}

/** Every frame of the buffer pool is pinned: an operation holds more pages than the pool has. */
export function poolExhausted(frames: number): EngineError {
  return new EngineError('ENGINE_POOL_EXHAUSTED', `all ${frames} buffer pool frames are pinned`)
}

/** A file whose superblock this build cannot read (D-26: refuse, never misread). */
export function badFormat(what: string): EngineError {
  return new EngineError('ENGINE_BAD_FORMAT', what)
}

/** ER_DUP_ENTRY, 1062 / 23000 — D-09 keeps the number ORMs retry on. */
export function duplicateKey(index: string): EngineError {
  return new EngineError('ER_DUP_ENTRY', `Duplicate entry for key '${index}'`, { errno: 1062, sqlState: '23000' })
}

/** ER_TOO_LONG_KEY, 1071 / 42000. */
export function keyTooLong(max: number): EngineError {
  return new EngineError('ER_TOO_LONG_KEY', `Specified key was too long; max key length is ${max} bytes`, {
    errno: 1071,
    sqlState: '42000',
  })
}

/** ER_TOO_BIG_ROWSIZE, 1118 / 42000. */
export function rowTooBig(max: number): EngineError {
  return new EngineError('ER_TOO_BIG_ROWSIZE', `Row size too large. The maximum row size for this page size is ${max}`, {
    errno: 1118,
    sqlState: '42000',
  })
}

/** A call the engine's own contract forbids — a bug in the caller, reported rather than obeyed. */
export function misuse(what: string): EngineError {
  return new EngineError('ENGINE_MISUSE', what)
}

/** A log block that verified but whose contents do not decode: tampering or a bug, never a torn write. */
export function corruptLog(what: string): EngineError {
  return new EngineError('ENGINE_CORRUPT_LOG', what)
}

/** A mini-transaction whose records need more log than a checkpoint can free. */
export function logFull(need: number, free: number): EngineError {
  return new EngineError('ENGINE_LOG_FULL', `a mini-transaction needs ${need} bytes of log and ${free} are free`)
}

/**
 * Another transaction holds the writer slot (D-08). The synchronous engine
 * cannot wait for it; the async edge queues the statement and reports
 * `ER_LOCK_WAIT_TIMEOUT` (1205) once `innodb_lock_wait_timeout` passes.
 */
export function writerBusy(): EngineError {
  return new EngineError('ENGINE_WRITER_BUSY', 'another transaction is writing')
}

/**
 * ER_LOCK_DEADLOCK, 1213 / 40001 — a read view the store could not keep (Q-09).
 * Not a deadlock, which one writer cannot have; the error retry loops already
 * handle when a transaction must start again (D-09).
 */
export function snapshotTooOld(): EngineError {
  return new EngineError('ER_LOCK_DEADLOCK', 'Deadlock found when trying to get lock; try restarting transaction (the snapshot is older than the store keeps)', {
    errno: 1213,
    sqlState: '40001',
  })
}
