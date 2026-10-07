// M4.13 — what the log says: the record format (doc 26 §Our log, D-46, D-48).
//
// A **group** is one mini-transaction: a length, then records, then `END`. The
// length is what lets a reader tell a group cut short by the end of the log —
// discarded, as InnoDB discards a group with no `MLOG_MULTI_REC_END` — from a
// group that is whole and wrong, which is corruption.
//
// Redo is **a byte diff of each page**, taken by the journal against the page
// as the mini-transaction found it, so nothing above the pool writes a log
// record or knows the log exists. A page's first change after it was last
// written is logged as an **image** — the same diff, taken against zeros — so
// every page recovery touches starts from bytes the log holds whole (D-46).
// The frame's checksum and LSNs are never logged: recovery stamps the LSN, and
// the pool seals the checksum on the way out.
//
// `ROW` is the logical half D-25 asked for from the first version: a row's
// before and after images, every field inline, which redo ignores and a change
// stream reads. A field list is MySQL's text-row encoding — a length-encoded
// string per field, `0xFB` for NULL — because that is a fact of a format
// already in this repository rather than a new one.
import { MyjsError, Reader, Writer } from '@myjs/bytes'
import type { FieldBytes } from './record.ts'
import { corruptLog } from './errors.ts'

export const RECORD = {
  PAGE: 1,
  META: 2,
  ROW: 3,
  END: 15,
  /** A transaction's commit, in the mini-transaction that makes it: a change stream's boundary (M4.21). */
  COMMIT: 16,
} as const

/** A page record's flag: the runs apply to a zeroed page, not the current one. */
const IMAGE = 1

/** A run of bytes to write at an offset. */
export interface Run {
  readonly at: number
  readonly bytes: Uint8Array
}

/** The superblock's mutable fields. The last `META` a recovery sees wins. */
export interface Meta {
  readonly pageCount: number
  readonly nextIndexId: number
  readonly nextTrxId: number
}

export type Redo =
  | { readonly type: 'page'; readonly pageNo: number; readonly image: boolean; readonly runs: readonly Run[] }
  | ({ readonly type: 'meta' } & Meta)
  | { readonly type: 'row'; readonly indexId: number; readonly trxId: number; readonly before: readonly FieldBytes[] | null; readonly after: readonly FieldBytes[] | null }
  | { readonly type: 'commit'; readonly trxId: number }

/** A decoded group and the LSNs it spans. */
export interface Group {
  readonly start: number
  readonly end: number
  readonly records: readonly Redo[]
}

// --- the page diff ------------------------------------------------------------

/**
 * The two regions of a page a diff covers: the page number, and everything
 * from the type byte to the trailer. Bytes 0–3 (checksum), 8–15 (head LSN) and
 * the last 8 (tail LSN) are the frame's bookkeeping.
 */
const regions = (size: number): readonly [number, number][] => [
  [4, 8],
  [16, size - 8],
]

/** Equal bytes shorter than this between two differences are carried in one run: a run costs about this much. */
const MERGE_GAP = 8

/** The runs that turn `before` — or a zeroed page, for `null` — into `after`. */
export function diffPage(before: Uint8Array | null, after: Uint8Array): Run[] {
  const runs: Run[] = []
  const at = (i: number): number => (before === null ? 0 : (before[i] as number))
  for (const [from, to] of regions(after.length)) {
    let i = from
    while (i < to) {
      if (after[i] === at(i)) {
        i++
        continue
      }
      const start = i
      let end = i + 1
      // The bound moves with `end`, so this extends until a gap of MERGE_GAP equal bytes.
      for (let j = end; j < to && j - end < MERGE_GAP; j++) if (after[j] !== at(j)) end = j + 1
      runs.push({ at: start, bytes: after.slice(start, end) })
      i = end
    }
  }
  return runs
}

/** Apply a page record. Every run must land inside a logged region: anything else is a corrupt log, not a write. */
export function applyPage(page: Uint8Array, record: { readonly image: boolean; readonly runs: readonly Run[] }, pageNo: number): void {
  const inside = (r: Run): boolean => regions(page.length).some(([from, to]) => r.at >= from && r.at + r.bytes.length <= to)
  for (const r of record.runs) if (!inside(r)) throw corruptLog(`a run for page ${pageNo} at ${r.at}+${r.bytes.length} leaves the page's content`)
  if (record.image) page.fill(0)
  for (const r of record.runs) page.set(r.bytes, r.at)
}

// --- records ------------------------------------------------------------------

export function encodeGroup(records: readonly Redo[]): Uint8Array {
  const body = new Writer()
  for (const r of records) {
    if (r.type === 'page') {
      body.u8(RECORD.PAGE).lenEncInt(r.pageNo).u8(r.image ? IMAGE : 0).lenEncInt(r.runs.length)
      let end = 0
      for (const run of r.runs) {
        body.lenEncInt(run.at - end).lenEncBytes(run.bytes)
        end = run.at + run.bytes.length
      }
    } else if (r.type === 'meta') {
      body.u8(RECORD.META).lenEncInt(r.pageCount).lenEncInt(r.nextIndexId).lenEncInt(r.nextTrxId)
    } else if (r.type === 'commit') {
      body.u8(RECORD.COMMIT).lenEncInt(r.trxId)
    } else {
      body.u8(RECORD.ROW).lenEncInt(r.indexId).lenEncInt(r.trxId)
      for (const image of [r.before, r.after]) {
        if (image === null) body.u8(0)
        else {
          body.u8(1).lenEncInt(image.length)
          for (const field of image) body.lenEncBytes(field)
        }
      }
    }
  }
  body.u8(RECORD.END)
  return new Writer(body.length + 9).lenEncInt(body.length).bytes(body.view()).toBytes()
}

/**
 * The length of the group at the front of `bytes`, prefix included, or
 * `undefined` when not even the prefix is there yet.
 */
export function groupLength(bytes: Uint8Array): number | undefined {
  const r = new Reader(bytes)
  try {
    const n = r.lenEncInt()
    if (n === null) throw corruptLog('a group length of NULL')
    return r.position + Number(n)
  } catch (e) {
    if (e instanceof MyjsError && e.code === 'PROTOCOL_OUT_OF_BOUNDS') return undefined
    throw wrap(e)
  }
}

/** Decode one whole group: exactly `groupLength(bytes)` bytes. */
export function decodeGroup(bytes: Uint8Array): Redo[] {
  try {
    const r = new Reader(bytes)
    const n = r.lenEncInt()
    if (n === null || Number(n) !== r.remaining) throw corruptLog('a group whose length does not match its bytes')
    const out: Redo[] = []
    for (;;) {
      const type = r.u8()
      if (type === RECORD.END) break
      if (type === RECORD.PAGE) {
        const pageNo = int(r)
        const flags = r.u8()
        if ((flags & ~IMAGE) !== 0) throw corruptLog(`unknown page-record flags ${flags}`)
        const runs: Run[] = []
        let end = 0
        for (let i = int(r); i > 0; i--) {
          const at = end + int(r)
          const run = r.lenEncBytes()
          if (run === null || run.length === 0) throw corruptLog('an empty run')
          runs.push({ at, bytes: run })
          end = at + run.length
        }
        out.push({ type: 'page', pageNo, image: (flags & IMAGE) !== 0, runs })
      } else if (type === RECORD.META) {
        out.push({ type: 'meta', pageCount: int(r), nextIndexId: int(r), nextTrxId: int(r) })
      } else if (type === RECORD.COMMIT) {
        out.push({ type: 'commit', trxId: int(r) })
      } else if (type === RECORD.ROW) {
        const indexId = int(r)
        const trxId = int(r)
        const before = rowImage(r)
        out.push({ type: 'row', indexId, trxId, before, after: rowImage(r) })
      } else {
        throw corruptLog(`unknown record type ${type}`)
      }
    }
    if (r.remaining !== 0) throw corruptLog('bytes after a group’s END')
    return out
  } catch (e) {
    throw wrap(e)
  }
}

function rowImage(r: Reader): FieldBytes[] | null {
  const present = r.u8()
  if (present === 0) return null
  if (present !== 1) throw corruptLog(`a row-image marker of ${present}`)
  const fields: FieldBytes[] = []
  for (let i = int(r); i > 0; i--) fields.push(r.lenEncBytes())
  return fields
}

/** A length-encoded integer that must be a safe, non-negative number. */
function int(r: Reader): number {
  const n = r.lenEncInt()
  if (n === null || n > BigInt(Number.MAX_SAFE_INTEGER)) throw corruptLog('an integer out of range')
  return Number(n)
}

/** A decode fault in the bytes below — a short read, a bad length prefix — is a corrupt log here. */
function wrap(e: unknown): unknown {
  if (e instanceof MyjsError && e.code !== 'ENGINE_CORRUPT_LOG') return corruptLog(e.message)
  return e
}
