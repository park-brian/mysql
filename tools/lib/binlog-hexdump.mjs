// M2.21 — reading row images out of `mysqlbinlog --hexdump`.
//
// Its own module so it can be tested without a MySQL. That is not a nicety:
// the first version of this parser was wrong in a way no test could have
// caught, because it only ever ran inside a CI job that had a server and no
// assertions. The fixtures it produced looked well formed and were one event
// out of step.
/**
 * Refuse rather than guess.
 *
 * A thrown error, not `gen-common`'s `check` — that one calls `process.exit`,
 * which is right for a generator and useless for a module a test drives.
 */
function check(ok, message) {
  if (!ok) throw new Error(message)
}

/** MySQL's `WRITE_ROWS_EVENT` type code (v2 — what 8.0 and 8.4 write). */
const WRITE_ROWS_EVENT = 30

/** Bytes of a binary-log common header, before any event-specific body. */
const COMMON_HEADER_LEN = 19

/**
 * Split `--hexdump` output into events, keeping each one's header and body.
 *
 * The first version of this looked for the line saying `Write_rows:` and took
 * the hex that followed. That is backwards, and quietly so: `mysqlbinlog`
 * prints the label *after* the event it labels, so every capture was one event
 * out of step — a fixture full of the next statement's bytes, with no way to
 * tell from the JSON. This reads the structure instead:
 *
 *     # Position  Timestamp   Type   Master ID        Size      Master Pos    Flags
 *     # 000004ca ac 10 a2 6a   1e   01 00 00 00   25 00 00 00   6a 05 00 00   00 00
 *     #
 *     # 000004dd 55 00 00 00 00 00  |U.....|
 *
 * The legend line opens an event, the line after it is the 19-byte common
 * header, and everything up to the next non-hex line is the body. The event
 * type is byte 4 of the header, so which events are row images is read off the
 * bytes rather than off a label.
 */
export function parseEvents(dump) {
  const events = []
  const hexOf = (line) => {
    const m = /^#\s+[0-9a-f]{8}\s+(.*)$/.exec(line)
    if (m === null) return null
    const bytes = []
    for (const tok of m[1].replace(/\|.*$/, '').trim().split(/\s+/)) {
      if (!/^[0-9A-Fa-f]{2}$/.test(tok)) return bytes
      bytes.push(parseInt(tok, 16))
    }
    return bytes
  }

  const lines = dump.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^#\s*Position\s+Timestamp\s+Type\b/.test(lines[i])) continue
    const header = hexOf(lines[i + 1] ?? '')
    if (header === null || header.length < COMMON_HEADER_LEN) continue
    const body = []
    for (let j = i + 2; j < lines.length; j++) {
      if (lines[j].trim() === '#') continue // the blank separator between header and body
      const bytes = hexOf(lines[j])
      if (bytes === null) break
      body.push(...bytes)
    }
    events.push({ type: header[4], size: header[9] | (header[10] << 8) | (header[11] << 16) | (header[12] << 24), body })
  }
  return events
}

/** Ceiling division, for the two bitmaps a row event carries. */
const bitmapBytes = (n) => (n + 7) >> 3

/**
 * The one column's value bytes out of one `WRITE_ROWS_EVENT` body.
 *
 * The v2 body is `table_id(6) flags(2) extra_len(2) extra(extra_len-2)
 * column_count(packed) columns_present(ceil(n/8))`, then per row a null bitmap
 * of `ceil(n/8)` and the values. Every table this tool creates has exactly one
 * column and every event carries exactly one row, so no offset arithmetic is
 * needed past that — which is why `captureColumn` makes a table per column
 * instead of one wide one.
 *
 * `checksum` is whether the server appends a CRC32, which is a four-byte
 * trailer on the body rather than part of the row.
 */
export function rowValue(body, checksum) {
  const end = body.length - (checksum ? 4 : 0)
  let at = 6 + 2
  const extraLen = body[at] | (body[at + 1] << 8)
  check(extraLen >= 2, `capture-types: extra-data length ${extraLen} is below the two-byte minimum`)
  at += extraLen
  const columnCount = body[at]
  check(columnCount === 1, `capture-types: expected a single-column row image, got ${columnCount} columns`)
  at += 1
  at += bitmapBytes(columnCount) // columns present
  const nullBitmap = body[at]
  at += bitmapBytes(columnCount)
  if ((nullBitmap & 1) === 1) return null
  check(at <= end, 'capture-types: row image is shorter than its own header')
  return body.slice(at, end)
}

/** Every single-column row image in a `--hexdump`, in log order. */
export function parseRowImages(dump, checksum) {
  return parseEvents(dump)
    .filter((e) => e.type === WRITE_ROWS_EVENT)
    .map((e) => rowValue(e.body, checksum))
}
