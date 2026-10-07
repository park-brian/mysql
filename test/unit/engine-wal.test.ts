// M4.14 — the log file: self-verifying 4 KiB blocks, a ring, and a scan that
// stops at the first block it cannot trust.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs, type VfsFile } from '@myjs/vfs'
import { EngineError, LOG_BLOCK, LOG_HEADER, LOG_PAYLOAD, Log, encodeGroup, readBlock, scanLog, sealBlock, type Group } from '@myjs/engine'

const logFile = (): Promise<VfsFile> => new MemoryVfs().open('log', { create: true })

/** A group of about `size` bytes whose one META record says `n`. */
const group = (n: number, size = 100): Uint8Array =>
  encodeGroup([
    { type: 'meta', pageCount: n, nextIndexId: n },
    { type: 'row', indexId: 1, before: null, after: [new Uint8Array(Math.max(0, size - 20))] },
  ])

const metaOf = (g: Group): number => (g.records[0] as { pageCount: number }).pageCount
const scan = (file: VfsFile, blocks: number, from = { block: 0, lsn: 0 }, salt = 1) => [...scanLog(file, { salt, blocks, ...from })]

/** Where a scan from `lsn` starts. */
const startAt = (log: Log, lsn: number) => {
  const p = log.positionOf(lsn)
  return { block: p.seq % log.blocks, lsn: p.lsn }
}

function readRaw(file: VfsFile, block: number): Uint8Array {
  const out = new Uint8Array(LOG_BLOCK)
  file.readBytes(block * LOG_BLOCK, out)
  return out
}

test('M4.14: a block round-trips, and any change to it makes it not a block', () => {
  const block = new Uint8Array(LOG_BLOCK)
  block.fill(7, LOG_HEADER, LOG_HEADER + 100)
  sealBlock(block, { salt: 9, lsn: 2 ** 40 + 3, used: 100, firstGroup: 12 })
  assert.deepEqual(readBlock(block), { salt: 9, lsn: 2 ** 40 + 3, used: 100, firstGroup: 12 })
  for (const at of [0, 5, 17, LOG_HEADER, LOG_BLOCK - 1]) {
    const bad = block.slice()
    bad[at] = (bad[at] as number) ^ 0x10
    assert.equal(readBlock(bad), undefined, `a flip at ${at}`)
  }
  assert.equal(readBlock(new Uint8Array(LOG_BLOCK)), undefined, 'a never-written block')
  assert.equal(readBlock(block.subarray(1)), undefined)
})

test('M4.14: groups come back in order, across block boundaries, with their LSNs', async () => {
  const file = await logFile()
  const log = Log.restart(file, 16, 1, 0)
  const spans = [1, 2, 3, 4, 5].map((n) => log.append(group(n, n * 1500)))
  log.flush()
  const groups = scan(file, 16)
  assert.deepEqual(groups.map(metaOf), [1, 2, 3, 4, 5])
  assert.deepEqual(groups.map((g) => [g.start, g.end]), spans.map((s) => [s.start, s.end]))
  // From a later checkpoint: only what follows it.
  const third = spans[2] as { start: number }
  assert.deepEqual(scan(file, 16, startAt(log, third.start)).map(metaOf), [3, 4, 5])
})

test('M4.14: a mutated block is the end of the log, and the group it cuts short never happened', async () => {
  const file = await logFile()
  const log = Log.restart(file, 16, 1, 0)
  for (let n = 1; n <= 6; n++) log.append(group(n, 1500))
  log.flush()
  const all = scan(file, 16)
  assert.equal(all.length, 6)
  const bad = readRaw(file, 1)
  bad[LOG_HEADER + 10] = (bad[LOG_HEADER + 10] as number) ^ 1
  file.writeBytes(LOG_BLOCK, bad)
  const kept = scan(file, 16)
  assert.ok(kept.every((g) => g.end <= LOG_PAYLOAD), 'nothing that reaches past block 0 survives')
  assert.deepEqual(kept.map(metaOf), all.filter((g) => g.end <= LOG_PAYLOAD).map(metaOf))
})

test('M4.14: an LSN gap stops the scan there, even under a valid checksum', async () => {
  const file = await logFile()
  const log = Log.restart(file, 16, 1, 0)
  for (let n = 1; n <= 6; n++) log.append(group(n, 1500))
  log.flush()
  const block = readRaw(file, 1)
  const h = readBlock(block) as { lsn: number; used: number; firstGroup: number | undefined }
  sealBlock(block, { salt: 1, lsn: h.lsn + 1, used: h.used, firstGroup: h.firstGroup })
  file.writeBytes(LOG_BLOCK, block)
  assert.ok(scan(file, 16).every((g) => g.end <= LOG_PAYLOAD))
})

test('M4.14: a block of another salt, or a stale block from an earlier lap, never chains', async () => {
  const file = await logFile()
  // Lap one, salt 1.
  const first = Log.restart(file, 4, 1, 0)
  for (let n = 1; n <= 3; n++) first.append(group(n, 3000))
  first.flush()
  assert.equal(scan(file, 4, { block: 0, lsn: 0 }, 2).length, 0, 'another salt reads nothing')
  // Salt 2 starts again at block 0 and writes one short group: block 1 still
  // holds salt 1's bytes, and must not be read as its continuation.
  const second = Log.restart(file, 4, 2, first.end)
  second.append(group(9, 100))
  second.flush()
  assert.deepEqual(scan(file, 4, { block: 0, lsn: first.end }, 2).map(metaOf), [9])
  // Same salt, next lap: the ring wraps over blocks the tail has passed.
  const ring = Log.restart(await logFile(), 4, 1, 0)
  const spans: { start: number; end: number }[] = []
  for (let n = 1; n <= 12; n++) {
    spans.push(ring.append(group(n, 2000)))
    ring.flush()
    ring.advanceTail(ring.positionOf((spans[spans.length - 1] as { start: number }).start))
  }
  const tail = ring.tail
  assert.deepEqual(scan(ring.file, 4, tail).map(metaOf), [12])
})

test('M4.14: a block once written is never written again — a flush seals it and the next group starts a new one', async () => {
  const file = await logFile()
  const log = Log.restart(file, 16, 1, 0)
  log.append(group(1, 50))
  log.flush()
  const sealed = readRaw(file, 0)
  log.append(group(2, 50))
  log.flush()
  assert.deepEqual(readRaw(file, 0), sealed)
  assert.equal((readBlock(readRaw(file, 1)) as { lsn: number }).lsn, (readBlock(sealed) as { used: number }).used)
  assert.deepEqual(scan(file, 16).map(metaOf), [1, 2])
})

test('M4.14: a group the ring cannot hold is ENGINE_LOG_FULL, and nothing is written', async () => {
  const file = await logFile()
  const log = Log.restart(file, 4, 1, 0)
  log.append(group(1, 2 * LOG_PAYLOAD))
  assert.throws(() => log.append(group(2, 2 * LOG_PAYLOAD)), (e: EngineError) => e.code === 'ENGINE_LOG_FULL')
  log.flush()
  assert.deepEqual(scan(file, 4).map(metaOf), [1])
})

test('M4.14: a group length the checksum cannot catch is caught by the first-group offset', async () => {
  const file = await logFile()
  const log = Log.restart(file, 16, 1, 0)
  for (let n = 1; n <= 4; n++) log.append(group(n, 1500))
  log.flush()
  // Say a group starts somewhere it does not, and re-seal: the scan must refuse.
  const block = readRaw(file, 1)
  const h = readBlock(block) as { lsn: number; used: number; firstGroup: number }
  sealBlock(block, { salt: 1, lsn: h.lsn, used: h.used, firstGroup: h.firstGroup + 1 })
  file.writeBytes(LOG_BLOCK, block)
  assert.throws(() => scan(file, 16), (e: EngineError) => e.code === 'ENGINE_CORRUPT_LOG')
})
