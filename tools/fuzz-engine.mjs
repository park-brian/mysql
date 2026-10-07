#!/usr/bin/env node
// Ground rule 5 for M4: every decoder in `@myjs/engine` meets arbitrary bytes
// and answers with an `EngineError` or nothing — never a crash, never a hang,
// never an out-of-bounds read.
//
// Random bytes almost never get past a checksum, which would leave everything
// behind it unfuzzed — the trap M3.10 named for the parser. So most inputs here
// are *valid pages, mutated, then re-sealed*: the frame check passes and the
// structure check behind it has to do the work. The same goes for whole
// stores: a few inputs in a hundred corrupt one sealed page of a real database
// and walk it with `verifyStore`.
//
// `tools/fuzz-reader.mjs`'s shape: a seed, a per-input time budget, and a
// crasher written to the corpus so it replays.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryVfs } from '@myjs/vfs'
import {
  EngineError,
  PAGE_TYPE,
  Store,
  decodeRecord,
  indexPage,
  initPage,
  readSuperblock,
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

/** A small real database, for the store-level target. */
const fixture = await (async () => {
  const file = await new MemoryVfs({ pageSize: PAGE }).open('d', { create: true })
  const store = Store.create(file, { frames: 16 })
  const tree = store.createTree()
  for (let i = 0; i < 300; i++) tree.put(Uint8Array.of(i >> 8, i & 0xff), new Uint8Array(i % 20))
  store.flush()
  const pages = []
  for (let p = 0; p < store.alloc.pageCount; p++) {
    const page = new Uint8Array(PAGE)
    file.readPage(p, page)
    pages.push(page)
  }
  return pages
})()

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
    writeSuperblock(page, { pageSize: PAGE, lsn: randInt(1e9), pageCount: 64, nextIndexId: 2, directoryRoot: 3 })
    readSuperblock(mutate(page), PAGE)
  },
  // A record of a random layout over arbitrary bytes.
  (input) => {
    const layout = Array.from({ length: 1 + randInt(8) }, () => (rnd() < 0.5 ? { nullable: rnd() < 0.5 } : { nullable: rnd() < 0.5, fixed: 1 + randInt(8) }))
    decodeRecord(layout, input)
  },
  // A whole store with one page corrupted and re-sealed, walked end to end.
  async () => {
    if (rnd() > 0.02) return
    const file = await new MemoryVfs({ pageSize: PAGE }).open('d', { create: true })
    const victim = randInt(fixture.length)
    fixture.forEach((p, i) => {
      const copy = p.slice()
      if (i === victim) {
        mutate(copy)
        sealPage(copy)
      }
      file.writePage(i, copy)
    })
    const store = Store.open(file, { frames: 16 })
    verifyStore(store)
    for (const { indexId } of store.trees()) for (const _ of store.openTree(indexId).entries());
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
