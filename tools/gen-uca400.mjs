#!/usr/bin/env node
// The UCA 4.0.0 weight tables, for `utf8mb4_unicode_ci` and `utf8mb3_unicode_ci`.
//
// `utf8mb4_unicode_ci` is the collation Prisma gives every table it creates
// (`DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`), so a string
// key on a Prisma table cannot be built without it. Its weights are MySQL's
// pre-9.0.0 tables, `strings/uca_data.h`: 256 pages of the Basic
// Multilingual Plane, each a run of `uca_length[page]` primary weights per
// code point. Those tables hold level 1 only; nothing else is reachable for
// a `_ci` collation of this generation.
//
// What the scanner (`uca_scanner_any::next`) does with them, and so what
// `uca400.ts` does:
//
//   - A code point's weights are read from its slot until a zero, and a zero
//     first weight makes it ignorable. A code point that fills its slot runs
//     on into the next one's, as the pointer walk does; the counts below
//     say how often that happens (it is resolved here, at generation).
//   - A page with no table is weighed implicitly: `0xFB40`, `0xFB80` or
//     `0xFBC0` plus the plane, then the low 15 bits with the top bit set.
//   - Everything above U+FFFF weighs `0xFFFD`, one weight, all alike.
//
// The output format is `gen-uca.mjs`'s, so `uca.ts` parses both with one
// function.
import { writeFileSync } from 'node:fs'
import { REPO, REF, banner, check, combinedSha256, fetchAllPinned } from './lib/gen-common.mjs'

const OUT = new URL('../packages/charsets/src/collations/uca400.ts', import.meta.url).pathname
const SOURCES = ['strings/uca_data.h']

const sources = await fetchAllPinned(SOURCES)
const sha256 = combinedSha256(sources)
const text = sources[0].text

// --- the page bodies ---------------------------------------------------------
const pages = new Map()
const pageRe = /uint16_t page([0-9A-F]{3})data\[\]\s*=\s*\{\s*\/\*\s*[0-9A-F]+ \((\d+) weights per char\)\s*\*\/([\s\S]*?)\};/g
for (let m; (m = pageRe.exec(text)) !== null; ) {
  const page = Number.parseInt(m[1], 16)
  const perChar = Number(m[2])
  const values = m[3]
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
  check(!pages.has(page), `gen-uca400: page ${m[1]} declared twice`)
  check(values.length === 256 * perChar, `gen-uca400: page ${m[1]} has ${values.length} weights, not 256 x ${perChar}`)
  check(
    values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff),
    `gen-uca400: page ${m[1]} holds a value outside uint16`,
  )
  pages.set(page, { perChar, values })
}
check(pages.size > 0, 'gen-uca400: no weight pages found — has the file moved?')

// --- uca_length and uca_weight -------------------------------------------------
const lengthMatch = /uint8_t uca_length\[256\]\s*=\s*\{([\s\S]*?)\};/.exec(text)
check(lengthMatch !== null, 'gen-uca400: uca_length[] not found')
const lengths = lengthMatch[1]
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(Number)
check(lengths.length === 256, `gen-uca400: uca_length has ${lengths.length} entries`)
const slotMatch = /uint16_t \*uca_weight\[256\]\s*=\s*\{([\s\S]*?)\};/.exec(text)
check(slotMatch !== null, 'gen-uca400: uca_weight[] not found')
const slots = slotMatch[1]
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
check(slots.length === 256, `gen-uca400: uca_weight lists ${slots.length} slots`)
const present = []
slots.forEach((name, slot) => {
  if (name === 'nullptr') {
    check(lengths[slot] === 0, `gen-uca400: page ${slot} has no table but a length of ${lengths[slot]}`)
    return
  }
  const m = /^page([0-9A-F]{3})data$/.exec(name)
  check(m !== null && Number.parseInt(m[1], 16) === slot, `gen-uca400: slot ${slot} holds ${name}`)
  check(pages.get(slot)?.perChar === lengths[slot], `gen-uca400: page ${slot}'s length disagrees with uca_length`)
  present.push(slot)
})
check(present.length === pages.size, `gen-uca400: ${pages.size} pages declared, ${present.length} referenced`)

// --- one code point's weights, as the scanner walks them ---------------------------
let runsOn = 0
function weightsOf(codePoint) {
  const page = pages.get(codePoint >> 8)
  if (page === undefined) return null
  const out = []
  let at = (codePoint & 0xff) * page.perChar
  if (page.values[at] === 0) return out
  for (; at < page.values.length && page.values[at] !== 0; at++) out.push(page.values[at])
  return out
}
for (const page of present) {
  for (let offset = 0; offset < 256; offset++) {
    const w = weightsOf((page << 8) | offset)
    if (w.length > pages.get(page).perChar) runsOn++
  }
}

// --- checks, against the parsed tables ----------------------------------------
const same = (a, b) => JSON.stringify(weightsOf(a)) === JSON.stringify(weightsOf(b))
check(same(0x61, 0x41), "gen-uca400: 'a' and 'A' must weigh alike — this collation is _ci")
check(same(0x61, 0xe4), "gen-uca400: 'a' and 'ä' must weigh alike at level 1")
check(weightsOf(0x301).length === 0, 'gen-uca400: a combining acute must be ignorable')
const sharpS = weightsOf(0xdf)
check(sharpS.length === 2 && sharpS[0] === weightsOf(0x73)[0] && sharpS[1] === weightsOf(0x73)[0], "gen-uca400: 'ß' must weigh as 'ss'")
check(weightsOf(0x20).length === 1, 'gen-uca400: a space must have one weight, the pad weight')

// --- packing, as gen-uca.mjs packs ------------------------------------------------
function deltaRuns(values) {
  const out = []
  let previous = 0
  const deltas = values.map((v) => {
    const d = v - previous
    previous = v
    return d
  })
  for (let i = 0; i < deltas.length; ) {
    let j = i
    while (j < deltas.length && deltas[j] === deltas[i]) j++
    const run = j - i
    const d = deltas[i]
    const hex = d < 0 ? '-' + (-d).toString(16) : d.toString(16)
    out.push(run === 1 ? hex : `${run}*${hex}`)
    i = j
  }
  return out.join(',')
}

const lines = []
let weightCount = 0
let expanding = 0
for (const page of present) {
  const first = []
  const extras = []
  for (let offset = 0; offset < 256; offset++) {
    const w = weightsOf((page << 8) | offset)
    weightCount += w.length
    first.push(w.length === 0 ? 0 : w[0])
    if (w.length > 1) {
      expanding++
      extras.push(
        `${offset.toString(16)}:${w
          .slice(1)
          .map((x) => x.toString(16))
          .join(',')}`,
      )
    }
  }
  const row = `${page.toString(16)} ${deltaRuns(first)}`
  lines.push(extras.length === 0 ? row : `${row} ${extras.join(';')}`)
}

const source = `${banner({
  script: 'npm run gen:uca',
  why: `UCA 4.0.0 primary weights, for \`utf8mb4_unicode_ci\` and \`utf8mb3_unicode_ci\`.

The Basic Multilingual Plane only: above U+FFFF every character weighs
0xFFFD, as \`uca_scanner_any::next\` has it. The format is \`uca900.ts\`'s — one
line per page with a table, \`<page> <first weight of each of 256 code
points> [<expansions>]\` — and a page not listed is weighed implicitly.`,
  sources,
  counts: {
    'Pages with weights': present.length,
    'Pages computed implicitly': 256 - present.length,
    'Level-1 weights': weightCount,
    'Code points that expand': expanding,
    'Code points whose weights run past their slot': runsOn,
  },
})}

/** The pinned source these weights were read out of (ground rule 7). */
export const UCA400_SOURCE = '${REPO}@${REF} ${SOURCES.join(' ')}'

/** sha256 over the pinned source, so drift is a test failure, not a surprise. */
export const UCA400_SOURCE_SHA256 = '${sha256}'

/** One line per page: \`<page> <delta-runs of first weights> [<offset:extra,weights;…>]\`. */
export const PACKED_UCA400_LEVEL1 = ${JSON.stringify(lines.join('\n'))}
`
writeFileSync(OUT, source)
console.log(`gen-uca400: ${present.length} pages, ${weightCount} weights, ${expanding} expanding, ${runsOn} running past their slot -> ${OUT}`)
