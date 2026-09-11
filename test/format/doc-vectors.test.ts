// M2.15 — the M2 exit criterion: "every byte dump quoted anywhere in docs 15,
// 24 and 28 is a test case".
//
// That claim was true when this was written, and the point of this file is
// that it stays true without anyone checking by hand. The docs are parsed, the
// dumps are extracted, and each one is looked for in `test/format/`'s sources.
// A dump added to a doc with no test fails here; so does a test deleted out
// from under a dump.
//
// This is the same discipline as the size gate (M2.22) and the generated-table
// diff (D-14): a compatibility claim a human maintains by hand is marketing,
// and one CI maintains is an engineering artefact.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const DOCS = ['15-wire-types', '24-column-encodings', '28-json-binary'] as const

interface Dump {
  readonly doc: string
  readonly line: number
  readonly hex: string
}

/**
 * Every hex dump in a doc's fenced code blocks.
 *
 * Fenced blocks only, and three bytes minimum. Both bounds are there because
 * prose is full of things that look like hex and are not: doc 15 says
 * "34 days and 22 hours", and `→ 0d 00:00:00` reads as `0d 00` to a naive
 * scanner. A run of three or more inside a code fence is a dump.
 */
function dumpsIn(doc: string): Dump[] {
  const text = readFileSync(new URL(`../../docs/${doc}.md`, import.meta.url).pathname, 'utf8')
  const out: Dump[] = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) {
      fenced = !fenced
      return
    }
    if (!fenced) return
    for (const m of line.matchAll(/(?<![0-9A-Fa-fx])((?:[0-9A-Fa-f]{2} ){2,}[0-9A-Fa-f]{2})(?![0-9A-Fa-f])/g)) {
      out.push({ doc, line: i + 1, hex: (m[1] as string).trim().toUpperCase().replace(/\s+/g, ' ') })
    }
  })
  return out
}

function testSources(): string {
  const dir = new URL('./', import.meta.url).pathname
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => readFileSync(dir + f, 'utf8'))
    .join('\n')
}

test('M2.15: every byte dump in docs 15, 24 and 28 is a test case', () => {
  const dumps = DOCS.flatMap(dumpsIn)
  const distinct = new Map<string, Dump>()
  for (const d of dumps) if (!distinct.has(d.hex)) distinct.set(d.hex, d)

  assert.ok(distinct.size > 0, 'the docs must contain dumps, or this gate is measuring nothing')

  const sources = testSources()
  const missing: string[] = []
  for (const [hex, where] of distinct) {
    // Spacing and `0x` prefixes vary between a doc and a test, so the bytes
    // are matched rather than the formatting.
    const pattern = new RegExp(hex.split(' ').join('[ ,]*(?:0[xX])?'), 'i')
    if (!pattern.test(sources)) missing.push(`${where.doc}.md:${where.line}  ${hex}`)
  }
  assert.deepEqual(
    missing,
    [],
    `byte dumps quoted in the docs with no test case:\n  ${missing.join('\n  ')}\n` +
      'Add a test in test/format/, or remove the dump from the doc.',
  )
})

test('M2.15: the corpus is what the docs actually contain', () => {
  // Pinned counts, so a doc losing a dump is as visible as a test losing one.
  // The interesting number is the third.
  const counts = Object.fromEntries(DOCS.map((d) => [d, dumpsIn(d).length]))
  // Occurrences, not lines: doc 24's worked `INT` lines carry two or three
  // runs each, since they show the value before and after the sign flip — and
  // doc 24's whole point is that both steps matter, so both are dumps.
  assert.equal(counts['15-wire-types'], 4, 'doc 15 quotes four multi-byte dumps')
  assert.equal(counts['24-column-encodings'], 10, 'doc 24 quotes ten')

  // **Doc 28 quotes none at all.** Its four fenced blocks are grammar and
  // pseudocode, so "every byte dump in doc 28 is a test case" is vacuously
  // true — which is exactly the shape of claim M2.22 was written about. Said
  // out loud here rather than left as a silent pass.
  //
  // The JSON vectors therefore have to be *sourced*, not transcribed, and they
  // come from two places: the spec-derived ones in `types-json.test.ts`, which
  // follow from doc 28's grammar alone, and the captured ones from M2.21's
  // `type-vectors` job, which are still outstanding because they need a real
  // 8.4.
  assert.equal(counts['28-json-binary'], 0, 'doc 28 is grammar, not dumps — see types-json.test.ts')
})

test('M2.15: doc 15 E-07 — the one-byte dump the errata contest', () => {
  // Doc 15's fifth dump is a single byte and so is below the scanner's
  // threshold, but it is the most interesting one in the file: it prints `01`
  // for the all-zero TIME, contradicting the layout three lines above it.
  // E-07 records that as a transcription slip and MySQL 8.0.46 confirmed it —
  // so the test that covers it asserts `00`, and this makes sure that test is
  // still there rather than letting the exception go quiet.
  const sources = testSources()
  assert.match(sources, /all-zero TIME/i, 'the E-07 case must remain covered in binary-values.test.ts')
})
