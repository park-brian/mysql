// Types for `binlog-hexdump.mjs`, hand-written because the tools are plain
// ESM JavaScript and only this one is imported by a TypeScript test. Turning
// `allowJs` on for the whole repo to type one module would put every generator
// in the program.

/** One binary-log event, as `--hexdump` printed it. */
export interface BinlogEvent {
  /** Event type code — byte 4 of the 19-byte common header. */
  readonly type: number
  /** Total event length including the common header, from bytes 9..12. */
  readonly size: number
  /** Everything after the common header, CRC32 trailer included. */
  readonly body: readonly number[]
}

export function parseEvents(dump: string): BinlogEvent[]

export function rowValue(body: readonly number[], checksum: boolean): number[] | null

export function parseRowImages(dump: string, checksum: boolean): (number[] | null)[]
