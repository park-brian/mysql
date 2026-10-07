// M4.1 and M4.2 — the checksum, and a page that can tell it was torn.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EngineError, FRAME_HEADER, PAGE_TYPE, crc32c, initPage, pageLsn, readSuperblock, sealPage, setPageLsn, verifyPage, writeSuperblock } from '@myjs/engine'

const ascii = (s: string) => new TextEncoder().encode(s)

test('M4.1: CRC32C matches the RFC 3720 §B.4 vectors', () => {
  assert.equal(crc32c(new Uint8Array(32)), 0x8a9136aa, '32 bytes of zeros')
  assert.equal(crc32c(new Uint8Array(32).fill(0xff)), 0x62a8ab43, '32 bytes of ones')
  assert.equal(crc32c(Uint8Array.from({ length: 32 }, (_, i) => i)), 0x46dd794e, 'incrementing')
  assert.equal(crc32c(Uint8Array.from({ length: 32 }, (_, i) => 31 - i)), 0x113fdb5c, 'decrementing')
  // The check value every CRC catalogue quotes for CRC-32C.
  assert.equal(crc32c(ascii('123456789')), 0xe3069283)
})

const PAGE = 1024
const sealed = (pageNo = 7, lsn = 42) => {
  const page = new Uint8Array(PAGE)
  initPage(page, pageNo, PAGE_TYPE.INDEX)
  page.fill(0xab, FRAME_HEADER, PAGE - 8)
  setPageLsn(page, lsn)
  sealPage(page)
  return page
}
const corrupt = (fn: () => void, what: RegExp) =>
  assert.throws(fn, (e: EngineError) => e instanceof EngineError && e.code === 'ENGINE_CORRUPT_PAGE' && what.test(e.message))

test('M4.2: a sealed page verifies, and its LSN survives 2^32', () => {
  verifyPage(sealed(), 7, PAGE)
  const page = sealed(7, 2 ** 40 + 5)
  verifyPage(page, 7, PAGE)
  assert.equal(pageLsn(page), 2 ** 40 + 5)
})

test('M4.2: a torn page is detected without consulting the log', () => {
  // The first sector new and the last old: the tail LSN is the previous one.
  const torn = sealed(7, 100)
  const older = sealed(7, 99)
  torn.set(older.subarray(PAGE - 512), PAGE - 512)
  corrupt(() => verifyPage(torn, 7, PAGE), /checksum|torn/)
  // A tear the checksum alone would miss cannot be built without forging the
  // CRC — so check the LSN rule on its own with a re-sealed page.
  const forged = sealed(7, 100)
  new DataView(forged.buffer).setUint32(PAGE - 4, 99)
  sealPage(forged)
  corrupt(() => verifyPage(forged, 7, PAGE), /torn/)
  // One flipped bit anywhere after the checksum.
  for (const at of [4, 16, FRAME_HEADER, PAGE / 2, PAGE - 1]) {
    const page = sealed()
    page[at] = (page[at] as number) ^ 1
    corrupt(() => verifyPage(page, 7, PAGE), /./)
  }
})

test('M4.2: a page in the wrong place, of an unknown type, or never written, is refused', () => {
  corrupt(() => verifyPage(sealed(7), 8, PAGE), /holds page 7/)
  corrupt(() => verifyPage(new Uint8Array(PAGE), 3, PAGE), /checksum/)
  const odd = sealed()
  odd[16] = 99
  sealPage(odd)
  corrupt(() => verifyPage(odd, 7, PAGE), /unknown page type/)
  corrupt(() => verifyPage(new Uint8Array(10), 7, PAGE), /expected 1024 bytes/)
})

test('D-41: the superblock round-trips, and a file this build cannot read is refused', () => {
  const page = new Uint8Array(PAGE)
  const s = { pageSize: PAGE, generation: 3, salt: 0xdeadbeef, logBlocks: 64, checkpointLsn: 2 ** 35, checkpointBlock: 5, pageCount: 128, nextIndexId: 4, directoryRoot: 3, trxRoot: 6, nextTrxId: 2 ** 40 + 7 }
  writeSuperblock(page, s)
  verifyPage(page, 1, PAGE)
  assert.deepEqual(readSuperblock(page, PAGE), s)
  assert.throws(() => readSuperblock(page, 2048), (e: EngineError) => e.code === 'ENGINE_BAD_FORMAT')
  const future = page.slice()
  new DataView(future.buffer).setUint16(FRAME_HEADER + 8, 5)
  assert.throws(() => readSuperblock(future, PAGE), /format version 5/)
  // Version 3 had no catalog: refused with its reason too.
  const three = page.slice()
  new DataView(three.buffer).setUint16(FRAME_HEADER + 8, 3)
  assert.throws(() => readSuperblock(three, PAGE), /version 3 had no catalog/)
  // Version 1 had no log. It is refused with the reason, never migrated (D-26).
  const old = page.slice()
  new DataView(old.buffer).setUint16(FRAME_HEADER + 8, 1)
  assert.throws(() => readSuperblock(old, PAGE), /version 1 had no log/)
  const alien = page.slice()
  alien[FRAME_HEADER] = 0
  assert.throws(() => readSuperblock(alien, PAGE), /not a myjs database/)
})
