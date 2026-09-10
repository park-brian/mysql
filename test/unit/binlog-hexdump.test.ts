// M2.21 — the `mysqlbinlog --hexdump` parser, tested without a MySQL.
//
// The bytes below are not invented. They are one real `WRITE_ROWS_EVENT` that
// the first capture run recorded, lifted out of the `type-vectors` artifact
// and re-laid-out in `--hexdump`'s own format. That matters: the bug this file
// exists to prevent was a parser that read a real dump and produced plausible
// nonsense, which is exactly the failure a hand-written fixture would have
// reproduced too kindly.
//
// The event is `INSERT INTO t_i8 VALUES (0)` — one TINYINT column, one row,
// value `00`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvents, parseRowImages } from '../../tools/lib/binlog-hexdump.mjs'

/** The 19-byte common header: timestamp, type 0x1e, server id, size 0x25. */
const HEADER = 'ac 10 a2 6a   1e   01 00 00 00   25 00 00 00   6a 05 00 00   00 00'

/**
 * One event in `--hexdump` form.
 *
 * The `Write_rows:` label goes *after* the hex, because that is where
 * `mysqlbinlog` puts it — and reading it as though it came first is precisely
 * the bug. A parser that keys off the label instead of the structure passes
 * every other test in this file and fails `two events in a row`.
 */
function event(header: string, body: readonly string[], label = 'Write_rows: table id 85 flags: STMT_END_F'): string {
  const lines = [
    '# at 1226',
    '#260910  2:06:35 server id 1  end_log_pos 1263 CRC32 0xcf959db1',
    '# Position  Timestamp   Type   Master ID        Size      Master Pos    Flags',
    `# 000004ca ${header}`,
    '#',
  ]
  let at = 0x4dd
  for (const b of body) {
    const bytes = b.split(' ')
    lines.push(`# ${at.toString(16).padStart(8, '0')} ${b}  |${'.'.repeat(bytes.length)}|`)
    at += bytes.length
  }
  lines.push(`# \t${label}`)
  lines.push('')
  return lines.join('\n')
}

// table_id(6) flags(2) extra_len(2) ncols(1) present(1) null(1) value(1) crc(4)
const I8_BODY = ['55 00 00 00 00 00', '01 00 02 00 01 ff', '00 00', 'cf 95 9d b1']

test('M2.21: an event is found by its header bytes, not by its trailing label', () => {
  const events = parseEvents(event(HEADER, I8_BODY))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 30, 'byte 4 of the common header is the event type')
  assert.equal(events[0]?.size, 0x25, 'bytes 9..12 are the event size')
  assert.equal(events[0]?.body.length, 0x25 - 19, 'body is size minus the common header')
})

test('M2.21: the row value is the payload, without header, bitmaps or CRC', () => {
  assert.deepEqual(parseRowImages(event(HEADER, I8_BODY), true), [[0x00]])
})

test('M2.21: without checksums the last four bytes are payload, not a trailer', () => {
  // Not hypothetical: `binlog_checksum=NONE` is settable, and reading it wrong
  // silently appends four bytes to every vector. The tool reads the variable
  // rather than assuming the default, and this is the branch that proves the
  // reading is used.
  assert.deepEqual(parseRowImages(event(HEADER, I8_BODY), false), [[0x00, 0xcf, 0x95, 0x9d, 0xb1]])
})

test('M2.21: two events in a row are two rows — the off-by-one that started this', () => {
  // A label-driven parser opens its first event on the *first* `Write_rows:`
  // line, which is at the end of event one, so it collects event two's bytes
  // and reports one row instead of two. This is the assertion that fails for
  // it and passes for a structure-driven parser.
  const dump = event(HEADER, I8_BODY) + event(HEADER, ['55 00 00 00 00 00', '01 00 02 00 01 ff', '00 7f', 'cf 95 9d b1'])
  assert.deepEqual(parseRowImages(dump, true), [[0x00], [0x7f]])
})

test('M2.21: a non-row event between two row events is skipped', () => {
  // Query events (type 2) carry the `BEGIN` and the DDL, and they are the
  // majority of a real dump. They are excluded by type code, so an event whose
  // body would parse as a row image cannot slip in.
  const query = event('ac 10 a2 6a   02   01 00 00 00   25 00 00 00   6a 05 00 00   00 00', I8_BODY, 'Query\tthread_id=8')
  const dump = event(HEADER, I8_BODY) + query + event(HEADER, ['55 00 00 00 00 00', '01 00 02 00 01 ff', '00 7f', 'cf 95 9d b1'])
  assert.deepEqual(parseRowImages(dump, true), [[0x00], [0x7f]])
})

test('M2.21: a NULL column is recorded as null rather than as no bytes', () => {
  const nulled = ['55 00 00 00 00 00', '01 00 02 00 01 ff', '01', 'cf 95 9d b1']
  assert.deepEqual(parseRowImages(event(HEADER, nulled), true), [null])
})

test('M2.21: a multi-column row image is refused rather than mis-sliced', () => {
  // `captureColumn` makes one table per column precisely so this never
  // happens; if it ever does, the tool must stop rather than record the first
  // column's bytes and call them the row.
  const wide = ['55 00 00 00 00 00', '01 00 02 00 02 ff', '00 00 7f', 'cf 95 9d b1']
  assert.throws(() => parseRowImages(event(HEADER, wide), true), /single-column/)
})
