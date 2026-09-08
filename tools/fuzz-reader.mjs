#!/usr/bin/env node
// M0.8 — arbitrary bytes into `Reader`.
//
// Ground rule 5 / doc 43 §6: the invariant is the same for every parser we
// write — a typed error, never a crash, never a hang, never an out-of-bounds
// read. Acceptance (docs/44-roadmap.md): 10^6 random inputs, zero crashes and
// hangs, only `ProtocolError`.
//
// Doc 43 says only "a JS fuzzer" and names no package, so this is a seeded
// generator with no dependency. A crasher is written to the corpus directory
// and becomes a regression test.
import { Reader, ProtocolError } from '@myjs/bytes'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RUNS = Number(process.env.FUZZ_RUNS ?? 1_000_000)
const SEED = Number(process.env.FUZZ_SEED ?? (Date.now() & 0x7fffffff))
// A single input must never take long enough to look like a hang.
const PER_INPUT_BUDGET_MS = Number(process.env.FUZZ_INPUT_BUDGET_MS ?? 250)
const CORPUS = new URL('../test/format/fuzz-corpus/', import.meta.url).pathname

// xorshift32 — reproducible from a seed, so a crasher can be replayed.
let state = SEED || 1
function rnd() {
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return (state >>> 0) / 0x100000000
}
const randInt = (n) => Math.floor(rnd() * n)

const OPS = [
  (r) => r.u8(),
  (r) => r.u16(),
  (r) => r.u24(),
  (r) => r.u32(),
  (r) => r.u48(),
  (r) => r.u64(),
  (r) => r.i8(),
  (r) => r.i16(),
  (r) => r.i32(),
  (r) => r.i64(),
  (r) => r.f32(),
  (r) => r.f64(),
  (r) => r.lenEncInt(),
  (r) => r.lenEncBytes(),
  (r) => r.nulString(),
  (r) => r.restBytes(),
  (r) => r.bytes(randInt(300)),
  (r) => r.skip(randInt(300)),
]

function makeInput() {
  const len = randInt(64)
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    // Bias towards the bytes that mean something: the lenenc prefixes, the
    // packet-type discriminators and NUL.
    const roll = rnd()
    bytes[i] =
      roll < 0.25 ? [0x00, 0xfb, 0xfc, 0xfd, 0xfe, 0xff][randInt(6)] : randInt(256)
  }
  return bytes
}

function recordCrasher(input, ops, err) {
  mkdirSync(CORPUS, { recursive: true })
  const name = `crash-${SEED}-${Date.now()}.json`
  writeFileSync(
    join(CORPUS, name),
    JSON.stringify(
      { seed: SEED, bytes: [...input], ops, error: { name: err?.name, message: err?.message } },
      null,
      2,
    ),
  )
  return join(CORPUS, name)
}

let observedProtocolErrors = 0
const started = Date.now()

for (let iter = 0; iter < RUNS; iter++) {
  const input = makeInput()
  const opCount = 1 + randInt(8)
  const chosen = []
  const t0 = Date.now()
  try {
    // A Reader over a random sub-slice, so start/end handling is fuzzed too.
    const start = randInt(input.length + 1)
    const end = start + randInt(input.length - start + 1)
    const r = new Reader(input, start, end)
    for (let k = 0; k < opCount; k++) {
      const op = randInt(OPS.length)
      chosen.push(op)
      OPS[op](r)
    }
  } catch (err) {
    if (err instanceof ProtocolError) {
      observedProtocolErrors++
    } else {
      const file = recordCrasher(input, chosen, err)
      console.error(`fuzz: non-ProtocolError escaped on iteration ${iter} (seed ${SEED})`)
      console.error(`  ${err?.name}: ${err?.message}`)
      console.error(`  corpus entry: ${file}`)
      process.exit(1)
    }
  }
  const elapsed = Date.now() - t0
  if (elapsed > PER_INPUT_BUDGET_MS) {
    const file = recordCrasher(input, chosen, new Error(`input took ${elapsed}ms`))
    console.error(`fuzz: possible hang on iteration ${iter} — ${elapsed}ms (seed ${SEED})`)
    console.error(`  corpus entry: ${file}`)
    process.exit(1)
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  `fuzz: ${RUNS.toLocaleString()} inputs in ${secs}s, seed ${SEED}; ` +
    `${observedProtocolErrors.toLocaleString()} ProtocolErrors, 0 crashes, 0 hangs`,
)
