// B0 / E-11 — the regression test for a bug a full-ICU machine cannot see.
//
// `packages/charsets/src/encoding.ts` used to route MySQL's `latin1` through
// `new TextDecoder('windows-1252')`, guarded by a try/catch that was supposed
// to catch a runtime without the encoding. The guard never fired: a Node built
// without full ICU has exactly one single-byte decoder, and every label in the
// Latin-1 family resolves to it *successfully*. So `0x80` decoded to `U+0080`
// instead of the euro sign, no error was raised, and the wrong character
// reached the application as data — while every test passed locally, because
// the developer machine had full ICU.
//
// CI found it. This file is what stops CI having to find it again: it runs the
// charset layer in a child process whose `TextDecoder` behaves exactly like a
// small-ICU build's, and asserts latin1 is still right. It fails on the old
// code and passes on the new, on any machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHARSETS = new URL('../../packages/charsets/src/index.ts', import.meta.url).pathname

/**
 * Run a script with `TextDecoder` replaced by a small-ICU-shaped one.
 *
 * The substitution is the real behaviour, not an invention: such a build
 * supports UTF-8 and UTF-16LE, maps the whole Latin-1 label family
 * (`latin1`, `iso-8859-1`, `windows-1252`, `ascii`) onto the single Latin-1
 * decoder, and throws `RangeError` for everything else.
 */
function underSmallIcu(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'myjs-icu-'))
  const file = join(dir, 'probe.mjs')
  writeFileSync(
    file,
    `const Real = globalThis.TextDecoder
const LATIN1_FAMILY = new Set(['latin1', 'iso-8859-1', 'windows-1252', 'ascii', 'us-ascii'])
// True ISO-8859-1: byte value === code point. Written out rather than
// delegated to \`new Real('iso-8859-1')\`, because WHATWG maps that label to
// *windows-1252* — so delegating would simulate a working runtime, not a
// broken one.
class Latin1Decoder {
  constructor(encoding) { this.encoding = encoding }
  decode(bytes) {
    if (bytes === undefined) return ''
    let out = ''
    for (const b of bytes) out += String.fromCharCode(b)
    return out
  }
}
globalThis.TextDecoder = class {
  constructor(label = 'utf-8', opts) {
    const l = String(label).toLowerCase()
    if (l.startsWith('utf-8') || l === 'utf8') return new Real('utf-8', opts)
    if (l === 'utf-16le' || l === 'utf-16') return new Real('utf-16le', opts)
    if (LATIN1_FAMILY.has(l)) return new Latin1Decoder(l)
    throw new RangeError('unsupported encoding ' + label)
  }
}
const charsets = await import(${JSON.stringify(CHARSETS)})
${body}
`,
  )
  try {
    return execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('B0: the simulation is faithful — TextDecoder really does substitute silently', () => {
  // The premise, checked rather than assumed. If `new TextDecoder('windows-1252')`
  // threw on such a runtime, the original try/catch would have been enough and
  // there would have been no bug to fix.
  const out = underSmallIcu(
    `const d = new TextDecoder('windows-1252')
console.log(JSON.stringify({ constructed: true, byte80: d.decode(Uint8Array.of(0x80)) }))`,
  )
  const { constructed, byte80 } = JSON.parse(out) as { constructed: boolean; byte80: string }
  assert.equal(constructed, true, 'the constructor must succeed — that is what made the bug silent')
  assert.equal(
    byte80,
    String.fromCharCode(0x80),
    'and it must return the wrong character — a C1 control — without complaint',
  )
})

test('B0: latin1 is still cp1252 on a runtime with no cp1252 decoder', () => {
  const out = underSmallIcu(
    `console.log(JSON.stringify({
  decoded: charsets.decodeCharset(Uint8Array.of(0x80), 'latin1'),
  encoded: [...charsets.encodeCharset('\\u20ac', 'latin1')],
  roundTrip: charsets.decodeCharset(charsets.encodeCharset('caf\\u00e9 \\u20ac', 'latin1'), 'latin1'),
}))`,
  )
  const { decoded, encoded, roundTrip } = JSON.parse(out) as {
    decoded: string
    encoded: number[]
    roundTrip: string
  }
  assert.equal(decoded, '€', 'the generated table says 0x80 is the euro sign, and nothing else is consulted')
  assert.deepEqual(encoded, [0x80], 'and the inverse comes from the same table, so the euro is encodable')
  assert.equal(roundTrip, 'café €')
})

test('B0: a charset with no generated table is refused, not silently substituted', () => {
  // The other half. `gbk` is multi-byte and stays on `TextDecoder`, so on this
  // runtime it must report itself unavailable rather than returning Latin-1 —
  // which is what the probe added alongside the tables is for.
  const out = underSmallIcu(
    `console.log(JSON.stringify({
  latin1: charsets.canDecode('latin1'),
  cp1251: charsets.canDecode('cp1251'),
  gbk: charsets.canDecode('gbk'),
  utf8mb4: charsets.canDecode('utf8mb4'),
}))`,
  )
  const can = JSON.parse(out) as Record<string, boolean>
  assert.equal(can['latin1'], true, 'generated')
  assert.equal(can['cp1251'], true, 'generated')
  assert.equal(can['utf8mb4'], true, 'UTF-8 needs no table and no ICU')
  assert.equal(can['gbk'], false, 'multi-byte, no table, and the runtime cannot do it — so: refused')
})
