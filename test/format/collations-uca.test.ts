// M2.7, M2.20 — `utf8mb4_0900_ai_ci`, the MySQL 8.0 default collation.
//
// Three things this file has to pin, because all three are new to the project
// and each is a way a collation can be silently wrong:
//
//   NO PAD. `'a' = 'a '` is FALSE here, and true under every collation
//   implemented before it. Doc 29 calls this one of the most common
//   real-world surprises when upgrading MySQL.
//
//   Expansion. sharp s equals 'ss' here — the exact inverse of
//   `utf8mb4_general_ci`, where doc 29 records that it folds to a *single*
//   's' and so can never equal 'ss'. Both are asserted side by side below,
//   since "the collations disagree" is the whole point of having two.
//
//   Implicit weights. 4,203 of 4,352 page slots are absent from the table and
//   computed instead, which is the only reason the CJK ideographs sort at all.
//
// And the ordering property, which doc 43 §4 calls the single most valuable
// property test we have — stated against `Collation.compare`, never against
// `sortKey`, because comparing a key against the function that built it is a
// tautology that passes whatever the encoder does (D-35).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { relative } from 'node:path'
import { build } from 'esbuild'
import fc from 'fast-check'
import {
  CharsetError,
  collation,
  collationAvailability,
  encodeCharset,
  hasCollation,
  isUcaCollation,
  loadCollation,
  loadUcaTables,
  memcmp,
  ucaTablesLoaded,
} from '@myjs/charsets'

const AI_CI = 255
const GENERAL_CI = 45
const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)
// `assert.strictEqual` is `Object.is`, and `Object.is(0, -0)` is false — so
// antisymmetry is asserted as a sum rather than as `x === -y`, exactly as
// `collations-memcmp.test.ts` does.
const antisymmetric = (x: number, y: number) => assert.equal(sign(x) + sign(y), 0)
const u8 = (s: string) => encodeCharset(s, 'utf8mb4')
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

// Written as escapes rather than as literal characters. Several of these are
// combining marks, and two pairs — the precomposed and decomposed forms of
// e-acute — are indistinguishable on screen while being the entire point of
// the test that uses them. A test whose meaning depends on invisible bytes is
// a test nobody can review.
const SHARP_S = 'ß'
const A_UMLAUT = 'ä'
const A_UMLAUT_UPPER = 'Ä'
const A_ACUTE = 'á'
const O_UMLAUT = 'ö'
const N_TILDE = 'ñ'
const AE = 'æ'
const E_ACUTE = 'é'
const COMBINING_ACUTE = '́'
const E_DECOMPOSED = 'e' + COMBINING_ACUTE
const CJK_ONE = '一'
const CJK_DING = '丁'
const CJK_LAST = '龥'
const HANGUL_GA = '가'
const HANGUL_GAK = '각'
const JAMO_G = 'ᄀ'
const JAMO_A = 'ᅡ'
const PLANE2_A = '\u{20000}'
const PLANE2_B = '\u{20001}'
const EMOJI_A = '\u{1f600}'
const EMOJI_B = '\u{1f601}'

test('D-36: the tables are not resident until something loads them', async () => {
  // The state machine, in order. This must be the first test in the file: it
  // is the only one that can observe the unloaded state, since loading is
  // process-wide and permanent.
  assert.equal(isUcaCollation(AI_CI), true)
  assert.equal(ucaTablesLoaded(), false)
  assert.equal(collationAvailability(AI_CI), 'loadable')
  assert.equal(hasCollation(AI_CI), false)
  // Not "unsupported" — "not loaded". The distinction is the point of D-36:
  // one sends a caller looking for a missing feature, the other for a missing
  // await.
  assert.throws(
    () => collation(AI_CI),
    (err: unknown) => {
      assert.ok(err instanceof CharsetError)
      assert.equal((err as CharsetError).code, 'ER_COLLATION_NOT_LOADED')
      return true
    },
  )

  const c = await loadCollation(AI_CI)
  assert.equal(c.id, AI_CI)
  assert.equal(ucaTablesLoaded(), true)
  assert.equal(collationAvailability(AI_CI), 'resident')
  assert.equal(hasCollation(AI_CI), true)
  // Loading twice is a no-op, and `collation()` is synchronous from here on —
  // which is the property `encodeKeyPart` depends on (ground rule 3).
  await loadUcaTables()
  assert.equal(collation(AI_CI), c)
})

test('M2.7: NO PAD — a trailing space is a difference, not padding', async () => {
  // The item's own acceptance assertion. Under `utf8mb4_general_ci` (PAD
  // SPACE) the same comparison is 0; the two are asserted together so the
  // divergence is the test rather than a comment about it.
  const uca = await loadCollation(AI_CI)
  const general = collation(GENERAL_CI)
  assert.notEqual(uca.compare(u8('a'), u8('a ')), 0)
  assert.ok(uca.compare(u8('a'), u8('a ')) < 0, 'the shorter value sorts first under NO PAD')
  assert.equal(general.compare(u8('a'), u8('a ')), 0)
  assert.equal(uca.padAttribute, 'NO PAD')
  assert.equal(general.padAttribute, 'PAD SPACE')
})

test('M2.7: accent- and case-insensitive at level 1', async () => {
  const c = await loadCollation(AI_CI)
  const equal: ReadonlyArray<readonly [string, string]> = [
    ['a', 'A'],
    ['a', A_UMLAUT],
    ['a', A_UMLAUT_UPPER],
    ['a', A_ACUTE],
    ['e', E_ACUTE],
    ['o', O_UMLAUT],
    ['n', N_TILDE],
  ]
  for (const [a, b] of equal) {
    assert.equal(c.compare(u8(a), u8(b)), 0, `${a} should equal ${b}`)
  }
  // Different letters still differ, which is what stops "insensitive" from
  // quietly becoming "equal to everything".
  assert.ok(c.compare(u8('a'), u8('b')) < 0)
  assert.ok(c.compare(u8('z'), u8('a')) > 0)
})

test('M2.7: UCA expands where general_ci folds — and only here does sharp s equal ss', async () => {
  const uca = await loadCollation(AI_CI)
  const general = collation(GENERAL_CI)
  // The headline contrast. Doc 29 states the general_ci half; this is the
  // other half, and it is the behaviour a schema on the 8.0 default actually
  // gets.
  assert.equal(uca.compare(u8(SHARP_S), u8('ss')), 0, 'sharp s equals ss under UCA')
  assert.notEqual(general.compare(u8(SHARP_S), u8('ss')), 0, 'sharp s differs from ss under general_ci')
  // The sort key shows why: two weights out of one character.
  assert.equal(hex(uca.sortKey(u8(SHARP_S))), hex(uca.sortKey(u8('ss'))))
  assert.equal(uca.sortKey(u8(SHARP_S)).length, 4)
  assert.equal(general.sortKey(u8(SHARP_S)).length, 2)
  // An expansion onto two *different* letters, which a one-weight-per-
  // character table cannot express at all.
  assert.equal(uca.compare(u8(AE), u8('ae')), 0, 'ae ligature equals ae')
  assert.notEqual(general.compare(u8(AE), u8('ae')), 0)
})

test('M2.7: a combining mark is ignorable, so composed and decomposed agree', async () => {
  const c = await loadCollation(AI_CI)
  // U+0301 has no level-1 weight at all, so 'e' + combining acute weighs
  // exactly as 'e' — and as the precomposed form. This is *why* the collation
  // is accent-insensitive: the accent's information lives at level 2, and
  // level 2 is not compared.
  assert.equal(c.sortKey(u8(COMBINING_ACUTE)).length, 0)
  assert.equal(c.compare(u8(E_ACUTE), u8('e')), 0)
  assert.equal(c.compare(u8(E_ACUTE), u8(E_DECOMPOSED)), 0)
})

test('M2.20: an absent page is a rule, not a hole — CJK and Hangul still order', async () => {
  const c = await loadCollation(AI_CI)
  // Pages 0x4E..0x9F are entirely absent from the table; these weights are
  // computed. Two ideographs must still order by code point within the block.
  assert.equal(c.sortKey(u8(CJK_ONE)).length, 4, 'two implicit weights')
  assert.ok(c.compare(u8(CJK_ONE), u8(CJK_DING)) < 0)
  assert.ok(c.compare(u8(CJK_LAST), u8(CJK_ONE)) > 0)
  // A Hangul syllable is decomposed into jamo whose weights *are* in the
  // table, which is why the syllable pages can be absent. U+AC00 decomposes to
  // U+1100 + U+1161, so it must weigh exactly as those two written out — the
  // decomposition being real rather than decorative.
  assert.equal(hex(c.sortKey(u8(HANGUL_GA))), hex(c.sortKey(u8(JAMO_G + JAMO_A))))
  assert.ok(c.compare(u8(HANGUL_GA), u8(HANGUL_GAK)) < 0)
  // Beyond the BMP, where `general_ci` gives up and weighs everything 0xFFFD.
  assert.notEqual(c.compare(u8(PLANE2_A), u8(PLANE2_B)), 0)
  assert.notEqual(c.compare(u8(EMOJI_A), u8(EMOJI_B)), 0)
  assert.equal(collation(GENERAL_CI).compare(u8(EMOJI_A), u8(EMOJI_B)), 0, 'general_ci cannot')
})

test('M2.7: the memcmp-ordering property holds against the comparator', async () => {
  const c = await loadCollation(AI_CI)
  // Deliberately seeded with the values that break naive implementations:
  // trailing spaces (NO PAD), bytes below 0x20 (which sort *before* a space
  // under memcmp and would invert under a PAD SPACE rule), expanding
  // characters, ignorable marks, and supplementary planes.
  const interesting = [
    '',
    ' ',
    '  ',
    '',
    'a',
    'a',
    'a ',
    'A',
    A_UMLAUT,
    SHARP_S,
    'ss',
    AE,
    'ae',
    E_ACUTE,
    E_DECOMPOSED,
    CJK_ONE,
    HANGUL_GA,
    EMOJI_A,
    'z',
    'aa',
  ]
  const value = fc.oneof(
    fc.constantFrom(...interesting),
    fc.string({ maxLength: 6 }),
    fc
      .array(fc.constantFrom('a', SHARP_S, ' ', '', AE, E_ACUTE, 'A'), { maxLength: 5 })
      .map((a) => a.join('')),
  )
  fc.assert(
    fc.property(value, value, (a, b) => {
      const x = u8(a)
      const y = u8(b)
      assert.equal(
        sign(c.compare(x, y)),
        sign(memcmp(c.sortKey(x), c.sortKey(y))),
        `compare and sortKey disagree on ${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
      )
    }),
    { numRuns: 4000 },
  )
})

test('M2.7: compare is a total order — antisymmetric, reflexive, transitive', async () => {
  const c = await loadCollation(AI_CI)
  const value = fc.oneof(
    fc.constantFrom('', ' ', 'a', 'a ', 'a', 'A', A_UMLAUT, SHARP_S, 'ss', AE, CJK_ONE, 'z'),
    fc.string({ maxLength: 5 }),
  )
  fc.assert(
    fc.property(value, value, value, (a, b, d) => {
      const x = u8(a)
      const y = u8(b)
      const z = u8(d)
      antisymmetric(c.compare(x, y), c.compare(y, x))
      assert.equal(c.compare(x, x), 0)
      if (c.compare(x, y) <= 0 && c.compare(y, z) <= 0) assert.ok(c.compare(x, z) <= 0)
    }),
    { numRuns: 3000 },
  )
})

test('M2.20: the packed table has its own pinned source, and a known size', async () => {
  // Reached by `await import()` here for the same reason `uca.ts` reaches it
  // that way: naming it statically anywhere would put it back in the bundle.
  const { PACKED_UCA900_LEVEL1, UCA900_PAGE_COUNT, UCA900_PAGE_SLOTS, UCA900_WEIGHT_COUNT, UCA900_SOURCE_SHA256 } =
    await import('../../packages/charsets/src/collations/uca900.ts')
  assert.match(UCA900_SOURCE_SHA256, /^[0-9a-f]{64}$/)
  assert.equal(UCA900_PAGE_SLOTS, 4352)
  assert.equal(UCA900_PAGE_COUNT, 149)
  assert.equal(PACKED_UCA900_LEVEL1.split('\n').length, UCA900_PAGE_COUNT)
  // The elision, as a number: 4,203 of 4,352 page slots cost nothing.
  assert.equal(UCA900_PAGE_SLOTS - UCA900_PAGE_COUNT, 4203)
  assert.equal(UCA900_WEIGHT_COUNT, 48772)
  // Q-13's answer for the UCA half, stated as a budget rather than an
  // adjective. MySQL's source for these weights is 7.4 MB.
  const raw = Buffer.byteLength(PACKED_UCA900_LEVEL1, 'utf8')
  const gzip = gzipSync(Buffer.from(PACKED_UCA900_LEVEL1, 'utf8'), { level: 9 }).length
  assert.ok(raw < 160 * 1024, `packed UCA level-1 weights are ${raw} bytes raw, budget 163840`)
  assert.ok(gzip < 64 * 1024, `packed UCA level-1 weights are ${gzip} bytes gzipped, budget 65536`)
})

test('M2.20: the exit criterion — the charsets bundle carries no UCA weights', async () => {
  // The item's acceptance assertion, run rather than asserted about: bundle
  // `packages/charsets/src/index.ts` exactly as the size gate does and look
  // for the weights in the entry chunk. They must be in a chunk of their own,
  // reached by `await import()`, or the whole lazy boundary is decorative.
  //
  // A substring of the real table is the probe, not a marker we planted:
  // a marker could survive a refactor that inlined the data around it.
  const { PACKED_UCA900_LEVEL1 } = await import('../../packages/charsets/src/collations/uca900.ts')
  const probe = PACKED_UCA900_LEVEL1.slice(2000, 2120)
  assert.ok(probe.length === 120, 'the probe must come from the middle of the real table')

  const entry = new URL('../../packages/charsets/src/index.ts', import.meta.url).pathname
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    minify: true,
    write: false,
    splitting: true,
    outdir: new URL('../../packages/charsets/.uca-check', import.meta.url).pathname,
    metafile: true,
    logLevel: 'silent',
  })

  const wanted = relative(process.cwd(), entry)
  const entryOutput = Object.entries(result.metafile.outputs).find(([, info]) => info.entryPoint === wanted)
  assert.ok(entryOutput, 'esbuild produced no output for the charsets entry point')
  const tail = (entryOutput as [string, unknown])[0].slice((entryOutput as [string, unknown])[0].lastIndexOf('/'))

  let entryText = ''
  let deferredText = ''
  for (const file of result.outputFiles) {
    if (file.path.endsWith(tail)) entryText = file.text
    else deferredText += file.text
  }
  assert.ok(entryText.length > 0, 'the entry chunk is empty')

  assert.ok(!entryText.includes(probe), 'the UCA weights are in the entry chunk — the lazy boundary is not working')
  assert.ok(deferredText.includes(probe), 'the UCA weights are in no chunk at all — the probe is wrong')
  // And the sizes say the same thing in numbers: the entry chunk is a fraction
  // of the deferred one.
  assert.ok(
    entryText.length < PACKED_UCA900_LEVEL1.length,
    `the charsets entry chunk is ${entryText.length} B, larger than the table it is supposed to defer`,
  )
})

test('D-36: preloading must not drag the weight tables into @myjs/core', async () => {
  // A regression guard for a mistake already made once here. Wiring the
  // `SET NAMES` preload through `collationAvailability` — the obvious way —
  // put all 42 legacy 8-bit weight tables into `@myjs/core`'s entry chunk and
  // cost it 10 KB gzipped, because that function lives beside the synchronous
  // resolver and the resolver must statically contain every table it can
  // return. `preloadCollation` exists in a module of its own to avoid exactly
  // that, and this asserts it stayed avoided.
  const { PACKED_BYTE_WEIGHTS } = await import('../../packages/charsets/src/collations/weights.ts')
  const probe = PACKED_BYTE_WEIGHTS.slice(400, 500)
  assert.equal(probe.length, 100, 'the probe must come from the middle of the real table')

  const entry = new URL('../../packages/core/src/index.ts', import.meta.url).pathname
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    minify: true,
    write: false,
    splitting: true,
    outdir: new URL('../../packages/core/.uca-check', import.meta.url).pathname,
    metafile: true,
    logLevel: 'silent',
  })
  const wanted = relative(process.cwd(), entry)
  const found = Object.entries(result.metafile.outputs).find(([, info]) => info.entryPoint === wanted)
  assert.ok(found, 'esbuild produced no output for the core entry point')
  const tail = (found as [string, unknown])[0].slice((found as [string, unknown])[0].lastIndexOf('/'))
  const entryText = result.outputFiles.find((f) => f.path.endsWith(tail))?.text ?? ''
  assert.ok(entryText.length > 0, 'the entry chunk is empty')

  assert.ok(
    !entryText.includes(probe),
    'the legacy 8-bit weight tables are in @myjs/core — something imported the synchronous resolver',
  )
})
