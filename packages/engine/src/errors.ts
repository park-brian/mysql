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

// --- the catalog's (M4.23) ------------------------------------------------------

/** A client-facing error with MySQL's number; `engine-errors.test.ts` checks each against the table. */
function sqlError(code: string, errno: number, sqlState: string, message: string): EngineError {
  return new EngineError(code, message, { errno, sqlState })
}

export const dbExists = (db: string) => sqlError('ER_DB_CREATE_EXISTS', 1007, 'HY000', `Can't create database '${db}'; database exists`)
export const dbMissingOnDrop = (db: string) => sqlError('ER_DB_DROP_EXISTS', 1008, 'HY000', `Can't drop database '${db}'; database doesn't exist`)
export const unknownDb = (db: string) => sqlError('ER_BAD_DB_ERROR', 1049, '42000', `Unknown database '${db}'`)
export const tableExists = (table: string) => sqlError('ER_TABLE_EXISTS_ERROR', 1050, '42S01', `Table '${table}' already exists`)
export const unknownTable = (table: string) => sqlError('ER_BAD_TABLE_ERROR', 1051, '42S02', `Unknown table '${table}'`)
export const noSuchTable = (db: string, table: string) => sqlError('ER_NO_SUCH_TABLE', 1146, '42S02', `Table '${db}.${table}' doesn't exist`)
export const tooLongIdent = (name: string) => sqlError('ER_TOO_LONG_IDENT', 1059, '42000', `Identifier name '${name}' is too long`)
export const dupFieldName = (name: string) => sqlError('ER_DUP_FIELDNAME', 1060, '42S21', `Duplicate column name '${name}'`)
export const dupKeyName = (name: string) => sqlError('ER_DUP_KEYNAME', 1061, '42000', `Duplicate key name '${name}'`)
export const wrongFieldSpec = (name: string) => sqlError('ER_WRONG_FIELD_SPEC', 1063, '42000', `Incorrect column specifier for column '${name}'`)
export const multiplePriKey = () => sqlError('ER_MULTIPLE_PRI_KEY', 1068, '42000', 'Multiple primary key defined')
export const tooManyKeys = (max: number) => sqlError('ER_TOO_MANY_KEYS', 1069, '42000', `Too many keys specified; max ${max} keys allowed`)
export const tooManyKeyParts = (max: number) => sqlError('ER_TOO_MANY_KEY_PARTS', 1070, '42000', `Too many key parts specified; max ${max} parts allowed`)
export const keyColumnMissing = (name: string) => sqlError('ER_KEY_COLUMN_DOES_NOT_EXITS', 1072, '42000', `Key column '${name}' doesn't exist in table`)
export const wrongAutoKey = () => sqlError('ER_WRONG_AUTO_KEY', 1075, '42000', 'Incorrect table definition; there can be only one auto column and it must be defined as a key')
export const wrongDbName = (name: string) => sqlError('ER_WRONG_DB_NAME', 1102, '42000', `Incorrect database name '${name}'`)
export const wrongTableName = (name: string) => sqlError('ER_WRONG_TABLE_NAME', 1103, '42000', `Incorrect table name '${name}'`)
export const mustHaveColumns = () => sqlError('ER_TABLE_MUST_HAVE_COLUMNS', 1113, '42000', 'A table must have at least 1 column')
export const wrongColumnName = (name: string) => sqlError('ER_WRONG_COLUMN_NAME', 1166, '42000', `Incorrect column name '${name}'`)
export const notSupportedYet = (what: string) => sqlError('ER_NOT_SUPPORTED_YET', 1235, '42000', `This version of myjs doesn't yet support '${what}'`)
export const unknownEngine = (name: string) => sqlError('ER_UNKNOWN_STORAGE_ENGINE', 1286, '42000', `Unknown storage engine '${name}'`)
export const wrongIndexName = (name: string) => sqlError('ER_WRONG_NAME_FOR_INDEX', 1280, '42000', `Incorrect index name '${name}'`)
/** A consistent read through a view older than the table's definition: InnoDB's answer, and MySQL's retry signal. */
export const notAView = (db: string, name: string) => sqlError('ER_WRONG_OBJECT', 1347, 'HY000', `'${db}.${name}' is not VIEW`)
export const tableDefChanged = () => sqlError('ER_TABLE_DEF_CHANGED', 1412, 'HY000', 'Table definition has changed, please retry transaction')

/** A catalog row or definition that does not decode, or does not describe the store it is in. */
export function corruptCatalog(what: string): EngineError {
  return new EngineError('ENGINE_CORRUPT_CATALOG', what)
}
