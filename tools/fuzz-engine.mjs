#!/usr/bin/env node
// Ground rule 5 for M4: every decoder in `@myjs/engine` meets arbitrary bytes
// and answers with an `EngineError` or nothing — never a crash, never a hang,
// never an out-of-bounds read.
//
// Random bytes almost never get past a checksum, which would leave everything
// behind it unfuzzed — the trap M3.10 named for the parser. So most inputs here
// are *valid pages, mutated, then re-sealed*: the frame check passes and the
// structure check behind it has to do the work. The same goes for whole
// stores: about one input in 250 corrupts one sealed page of a real database
// and walks it with `verifyStore`. The log is the same kind of input (doc 43
// §6's "mutated real logs"): a real log with bytes changed, sometimes re-sealed
// so that the record decoder and recovery, not the checksum, have to answer.
//
// `tools/fuzz-reader.mjs`'s shape: a seed, a per-input time budget, and a
// crasher written to the corpus. Some targets draw their own bytes from the
// generator rather than the input, so what replays a crasher is its seed and
// iteration; the saved bytes are for reading.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryVfs } from '@myjs/vfs'
import {
  ClusteredIndex,
  EngineError,
  LOG_BLOCK,
  LOG_HEADER,
  PAGE_TYPE,
  Store,
  decodeGroup,
  decodeRecord,
  decodeUndo,
  encodeGroup,
  encodeUndo,
  groupLength,
  indexPage,
  initPage,
  readBlock,
  readSuperblock,
  sealBlock,
  sealPage,
  verifyPage,
  verifyStore,
  writeSuperblock,
} from '@myjs/engine'

const RUNS = Number(process.env.FUZZ_RUNS ?? 1_000_000)
const SEED = Number(process.env.FUZZ_SEED ?? (Date.now() & 0x7fffffff))
const PER_INPUT_BUDGET_MS = Number(process.env.FUZZ_INPUT_BUDGET_MS ?? 250)
const CORPUS = new URL('../test/format/fuzz-corpus/', import.meta.url).pathname
const PAGE = 512

let state = SEED || 1
function rnd() {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) / 0x100000000
}
const randInt = (n) => Math.floor(rnd() * n)

/** A well-formed index page with a few cells, as the seed to mutate. */
function validIndexPage() {
  const page = new Uint8Array(PAGE)
  indexPage.initIndexPage(page, 7, randInt(3), 1)
  const n = randInt(12)
  for (let i = 0; i < n; i++) {
    const key = Uint8Array.of(i * 3, randInt(256))
    const value = indexPage.level(page) > 0 ? indexPage.childValue(randInt(100)) : new Uint8Array(randInt(30))
    if (indexPage.fits(page, key, value)) indexPage.insertCell(page, indexPage.search(page, key).index, key, value)
  }
  return page
}

function mutate(page) {
  const flips = 1 + randInt(6)
  for (let i = 0; i < flips; i++) {
    const at = rnd() < 0.6 ? 24 + randInt(40) : randInt(page.length)
    page[at] = rnd() < 0.3 ? [0, 0xff, 0x80, 0x7f][randInt(4)] : randInt(256)
  }
  return page
}

/**
 * A small real database, for the store-level targets: its data pages and its
 * log, with work after the last checkpoint so that opening it replays groups.
 */
const fixture = await (async () => {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const file = await vfs.open('d', { create: true })
  const logFile = await vfs.open('l', { create: true })
  const store = Store.create(file, logFile, { frames: 16, logBlocks: 32 })
  const tree = store.createTree()
  for (let i = 0; i < 150; i++) tree.put(Uint8Array.of(i >> 8, i & 0xff), new Uint8Array(i % 20))
  store.checkpoint()
  for (let i = 150; i < 300; i++) tree.put(Uint8Array.of(i >> 8, i & 0xff), new Uint8Array(i % 20))
  // A table with history a reader pins, and a transaction left open: opening
  // the store rolls it back, so every mutation below reaches undo too.
  const table = ClusteredIndex.create(store, [{ nullable: false, fixed: 2 }, { nullable: true }], [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  for (let i = 0; i < 40; i++) table.insert([Uint8Array.of(0, i), new Uint8Array(i % 30)])
  table.get(Uint8Array.of(0, 0), store.begin())
  for (let i = 0; i < 40; i += 3) table.update([Uint8Array.of(0, i), new Uint8Array(5).fill(i)])
  const open = store.begin()
  for (let i = 1; i < 40; i += 4) table.delete(Uint8Array.of(0, i), open)
  for (let i = 40; i < 50; i++) table.insert([Uint8Array.of(0, i), null], open)
  store.sync()
  const pages = []
  for (let p = 0; p < file.size() / PAGE; p++) {
    const page = new Uint8Array(PAGE)
    file.readPage(p, page)
    pages.push(page)
  }
  const log = new Uint8Array(logFile.size())
  logFile.readBytes(0, log)
  return { pages, log }
})()

/** The fixture as files, with `change` applied to copies of its bytes first. */
async function fixtureFiles(change) {
  const vfs = new MemoryVfs({ pageSize: PAGE })
  const file = await vfs.open('d', { create: true })
  const logFile = await vfs.open('l', { create: true })
  const pages = fixture.pages.map((p) => p.slice())
  const log = fixture.log.slice()
  change(pages, log)
  pages.forEach((p, i) => file.writePage(i, p))
  logFile.writeBytes(0, log)
  return [file, logFile]
}

/** Open what is left and walk all of it. */
function openAndWalk(files) {
  const store = Store.open(...files, { frames: 16 })
  verifyStore(store)
  for (const { indexId } of store.trees()) for (const _ of store.openTree(indexId).entries());
}

const TARGETS = [
  // A raw page, mostly failing the checksum — the first line of defence.
  (input) => verifyPage(input, 7, PAGE),
  // A mutated index page, re-sealed so the structure check is what answers.
  () => {
    const page = mutate(validIndexPage())
    sealPage(page)
    verifyPage(page, 7, PAGE)
    indexPage.validateIndexPage(page, 7)
  },
  // A mutated superblock.
  () => {
    const page = new Uint8Array(PAGE)
    writeSuperblock(page, { pageSize: PAGE, generation: randInt(9), salt: randInt(1e9), logBlocks: 64, checkpointLsn: randInt(1e9), checkpointBlock: randInt(64), pageCount: 64, nextIndexId: 2, directoryRoot: 3, trxRoot: 4, nextTrxId: randInt(1e9) })
    readSuperblock(mutate(page), PAGE)
  },
  // A record of a random layout over arbitrary bytes.
  (input) => {
    const layout = Array.from({ length: 1 + randInt(8) }, () => (rnd() < 0.5 ? { nullable: rnd() < 0.5 } : { nullable: rnd() < 0.5, fixed: 1 + randInt(8) }))
    decodeRecord(layout, input)
  },
  // A whole store with one page corrupted and re-sealed, recovered and walked end to end.
  async () => {
    if (rnd() > 0.02) return
    const victim = randInt(fixture.pages.length)
    openAndWalk(
      await fixtureFiles((pages) => {
        mutate(pages[victim])
        sealPage(pages[victim])
      }),
    )
  },
  // A real log with bytes changed in one block — re-sealed half the time, so
  // the scan and the record decoder have to answer rather than the checksum.
  async () => {
    if (rnd() > 0.02) return
    openAndWalk(
      await fixtureFiles((_, log) => {
        const block = randInt(log.length / LOG_BLOCK)
        const at = block * LOG_BLOCK
        const view = log.subarray(at, at + LOG_BLOCK)
        const header = readBlock(view)
        for (let i = 1 + randInt(4); i > 0; i--) view[(rnd() < 0.3 ? 4 + randInt(LOG_HEADER - 4) : LOG_HEADER + randInt(200))] = randInt(256)
        if (header !== undefined && rnd() < 0.5) sealBlock(view, header)
      }),
    )
  },
  // An undo record's bytes, mutated: decode answers with a record or ENGINE_CORRUPT_UNDO.
  (input) => {
    const record = encodeUndo({ isInsert: false, purgeRemoves: rnd() < 0.5, indexId: randInt(1000), key: input.subarray(0, randInt(20)), old: input.subarray(0, randInt(60)), freeOnPurge: [new Uint8Array(8)], freeOnRollback: [] })
    for (let i = 1 + randInt(3); i > 0; i--) record[randInt(record.length)] = randInt(256)
    decodeUndo(record.subarray(0, 1 + randInt(record.length)))
  },
  // A group's bytes, mutated: decode answers with records or ENGINE_CORRUPT_LOG.
  (input) => {
    const group = encodeGroup([
      { type: 'page', pageNo: randInt(1000), image: rnd() < 0.5, runs: [{ at: 24, bytes: input.subarray(0, 1 + randInt(20)) }] },
      { type: 'meta', pageCount: 64, nextIndexId: 2, nextTrxId: 9 },
      { type: 'row', indexId: 1, trxId: 3, before: null, after: [input.subarray(0, randInt(10)), null] },
      { type: 'commit', trxId: 3 },
    ])
    for (let i = 1 + randInt(3); i > 0; i--) group[randInt(group.length)] = randInt(256)
    const n = groupLength(group)
    if (n !== undefined && n <= group.length) decodeGroup(group.subarray(0, n))
  },
]

function makeInput() {
  const bytes = new Uint8Array(rnd() < 0.5 ? PAGE : randInt(80))
  for (let i = 0; i < bytes.length; i++) bytes[i] = randInt(256)
  if (bytes.length === PAGE && rnd() < 0.5) {
    initPage(bytes, 7, [PAGE_TYPE.INDEX, PAGE_TYPE.OVERFLOW, 9][randInt(3)])
    sealPage(bytes)
  }
  return bytes
}

let errors = 0
const started = Date.now()
for (let iter = 0; iter < RUNS; iter++) {
  const input = makeInput()
  const target = randInt(TARGETS.length)
  const t0 = Date.now()
  try {
    await TARGETS[target](input)
  } catch (err) {
    if (err instanceof EngineError) errors++
    else {
      mkdirSync(CORPUS, { recursive: true })
      const file = join(CORPUS, `engine-crash-${SEED}-${iter}.json`)
      writeFileSync(file, JSON.stringify({ seed: SEED, iteration: iter, target, bytes: [...input], error: { name: err?.name, message: err?.message } }, null, 2))
      console.error(`fuzz-engine: non-EngineError escaped on iteration ${iter} (seed ${SEED}, target ${target})`)
      console.error(`  ${err?.name}: ${err?.message}`)
      console.error(`  ${err?.stack?.split('\n').slice(1, 4).join('\n  ')}`)
      console.error(`  corpus entry: ${file}`)
      process.exit(1)
    }
  }
  const elapsed = Date.now() - t0
  if (elapsed > PER_INPUT_BUDGET_MS) {
    console.error(`fuzz-engine: possible hang on iteration ${iter} — ${elapsed}ms (seed ${SEED}, target ${target})`)
    process.exit(1)
  }
}
console.log(
  `fuzz-engine: ${RUNS.toLocaleString()} inputs in ${((Date.now() - started) / 1000).toFixed(1)}s, seed ${SEED}; ` +
    `${errors.toLocaleString()} EngineErrors, 0 crashes, 0 hangs`,
)
