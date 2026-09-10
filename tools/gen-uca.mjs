#!/usr/bin/env node
// M2.20 — the UCA 9.0.0 weight tables, level 1 only.
//
// `utf8mb4_0900_ai_ci` is the MySQL 8.0 default collation (D-10), and until
// this file existed it was the one collation the engine refused outright:
// `collations/resolve.ts` threw rather than silently ordering it by bytes.
// This generator is what stops it refusing.
//
// Level 1 only, deliberately. `_ai_ci` is accent- and case-insensitive, which
// in UCA terms means it compares *primary* weights and nothing else — the
// secondary weights that distinguish 'e' from 'é' and the tertiary weights
// that distinguish 'a' from 'A' are, for this collation, unreachable. Storing
// them would triple the table to serve a collation we do not implement
// (`utf8mb4_0900_as_cs` is doc 29's Layer 3, and would need them).
//
// The packing is M2.19's, because the source structure is again MySQL's own:
// `uca900_weight` is 4352 page slots (17 planes x 256) of which only 149 are
// non-null. An absent page is not a hole to fill but a rule to apply — the
// implicit weights of UCA, computed from the code point — so 4,203 of 4,352
// pages cost nothing at all. That is the same discovery Q-04 recorded for
// `my_unicase_default`, in a table 7.4 MB long.
import { writeFileSync } from 'node:fs'
import { REPO, REF, banner, check, combinedSha256, fetchAllPinned, packed } from './lib/gen-common.mjs'

const OUT = new URL('../packages/charsets/src/collations/uca900.ts', import.meta.url).pathname

// One file. `strings/ctype-uca.cc` is already parsed by `gen-charsets.mjs` for
// the `MY_CS_UTF8MB4_UCA_FLAGS` macro that identifies a UCA collation in the
// first place; the weights themselves live only here.
const SOURCES = ['strings/uca900_data.h']

// `#define MY_UCA_900_CE_SIZE 3` — primary, secondary, tertiary.
const CE_SIZE = 3
// `#define UCA900_DISTANCE_BETWEEN_LEVELS 256`
const LEVEL_STRIDE = 256
// `#define UCA900_DISTANCE_BETWEEN_WEIGHTS (MY_UCA_900_CE_SIZE * 256)`
const CE_STRIDE = CE_SIZE * LEVEL_STRIDE
// 17 planes of 256 pages: `uint16_t *uca900_weight[4352]`.
const PAGE_SLOTS = 4352

const sources = await fetchAllPinned(SOURCES)
const sha256 = combinedSha256(sources)
const text = sources[0].text

// --- the page bodies -------------------------------------------------------
//
// `uint16_t uca900_pNNN[]= { <256 CE counts> <256 weights per level per CE> }`.
// The header's own comment explains the shape: a page is padded to its widest
// character's collation-element count, and the leading 256 entries record how
// many of those elements are real.
const pages = new Map()
const pageRe = /uint16_t uca900_p([0-9A-F]+)\[\]=\s*\{([\s\S]*?)\n\};/g
for (let m; (m = pageRe.exec(text)) !== null; ) {
  const body = m[2].replace(/\/\*[\s\S]*?\*\//g, ' ')
  const values = body
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
  const page = Number.parseInt(m[1], 16)
  check(!pages.has(page), `gen-uca: page ${m[1]} declared twice`)
  const perCe = (values.length - 256) / CE_STRIDE
  check(
    Number.isInteger(perCe) && perCe >= 1,
    `gen-uca: page ${m[1]} has ${values.length} entries, which is not 256 + n*${CE_STRIDE}`,
  )
  check(
    values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff),
    `gen-uca: page ${m[1]} holds a value outside uint16`,
  )
  pages.set(page, values)
}
check(pages.size > 0, 'gen-uca: no weight pages found — has the file moved?')

// --- the page-pointer array ------------------------------------------------
//
// Terminated on the first `};` rather than on `\n};`: this array's last entry
// and its brace share a line, and a greedier match runs on into the next
// declaration.
const slotMatch = /uint16_t \*uca900_weight\[(\d+)\]\s*=\s*\{([\s\S]*?)\};/.exec(text)
check(slotMatch !== null, 'gen-uca: uca900_weight[] not found')
check(
  Number(slotMatch[1]) === PAGE_SLOTS,
  `gen-uca: uca900_weight is ${slotMatch[1]} slots, expected ${PAGE_SLOTS}`,
)
const slots = slotMatch[2]
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
check(slots.length === PAGE_SLOTS, `gen-uca: uca900_weight lists ${slots.length} slots, not ${PAGE_SLOTS}`)

const present = []
slots.forEach((name, slot) => {
  if (name === 'nullptr') return
  const m = /^uca900_p([0-9A-F]+)$/.exec(name)
  check(m !== null, `gen-uca: slot ${slot} names ${name}, which is not a weight page`)
  // The slot index *is* the page number. Reading it out of the array rather
  // than out of the identifier is what makes a renamed page a build failure
  // instead of a silent mis-mapping.
  check(
    Number.parseInt(m[1], 16) === slot,
    `gen-uca: slot ${slot} holds ${name}, whose name says page ${m[1]}`,
  )
  check(pages.has(slot), `gen-uca: slot ${slot} names ${name}, which is not declared`)
  present.push(slot)
})
check(
  present.length === pages.size,
  `gen-uca: ${pages.size} pages declared but ${present.length} referenced`,
)

// --- level 1, with the ignorable weights dropped ---------------------------
//
// A primary weight of zero is *ignorable*: it contributes nothing to a level-1
// key. Every combining mark is one, which is precisely why this collation is
// accent-insensitive — the accent's information lives at level 2 and level 2
// is not compared. Dropping them here rather than at run time makes the stored
// sequence the sequence the comparator actually walks.
function level1(page, offset) {
  const values = pages.get(page)
  const count = values[offset]
  const out = []
  for (let ce = 0; ce < count; ce++) {
    const w = values[256 + offset + ce * CE_STRIDE]
    if (w !== 0) out.push(w)
  }
  return out
}

// --- the checks that make this a parse rather than a guess ----------------
//
// Asserted against the parsed tables, not against the source text, so a change
// in either the layout or the weights fails the build. Every one of these is a
// property doc 29 names or contrasts.
function weightsOf(codePoint) {
  return level1(codePoint >> 8, codePoint & 0xff)
}
function sameWeights(a, b) {
  const x = weightsOf(a)
  const y = weightsOf(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}
check(sameWeights(0x61, 0x41), "gen-uca: 'a' and 'A' must share a primary weight — this collation is _ci")
check(sameWeights(0x61, 0xe4), "gen-uca: 'a' and 'ä' must share a primary weight — this collation is _ai")
check(weightsOf(0x301).length === 0, 'gen-uca: a combining acute must be ignorable at level 1')
// The contrast with `utf8mb4_general_ci`, which folds ß to a single 's' weight
// so that 'ß' can never equal 'ss'. UCA expands it, so here it can and does.
const sharpS = weightsOf(0xdf)
const s = weightsOf(0x73)
check(
  sharpS.length === 2 && s.length === 1 && sharpS[0] === s[0] && sharpS[1] === s[0],
  "gen-uca: 'ß' must expand to two 's' weights",
)
// A real expansion onto two *different* letters, which a simple weight table
// cannot express at all.
const ae = weightsOf(0xe6)
check(
  ae.length === 2 && ae[0] === weightsOf(0x61)[0] && ae[1] === weightsOf(0x65)[0],
  "gen-uca: 'æ' must expand to 'a' then 'e'",
)
// `utf8mb4_0900_ai_ci` is the DUCET root: no tailoring, and so no contractions
// to carry. `ctype-uca.cc` builds contractions from a collation's tailoring
// rules, and this one has none — asserted rather than assumed, because a
// contraction we silently dropped would be a wrong sort order.
check(
  !/utf8mb4_0900_ai_ci[\s\S]{0,400}?contractions/.test(text),
  'gen-uca: the root collation appears to declare contractions',
)

// --- packing ---------------------------------------------------------------
//
// Per page: the first weight of every code point as a dense 256-entry
// delta-plus-run array, then the code points that expand, listed. 25,731 code
// points have exactly one weight and 11,046 have more, so a dense array plus a
// sparse exception list beats a flat variable-length stream by a fifth. Deltas
// are against the *previous* value, not against the index as M2.19's are: the
// long stretches here are unassigned runs of zero, which previous-value deltas
// collapse to one run and index-relative deltas do not.
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
let expandingCodePoints = 0
for (const page of present) {
  const first = []
  const extras = []
  for (let offset = 0; offset < 256; offset++) {
    const w = level1(page, offset)
    weightCount += w.length
    first.push(w.length === 0 ? 0 : w[0])
    if (w.length > 1) {
      expandingCodePoints++
      extras.push(`${offset.toString(16)}:${w.slice(1).map((x) => x.toString(16)).join(',')}`)
    }
  }
  // A weight of 0 in the dense array means "no level-1 weight at all", which
  // is unambiguous: UCA never assigns primary weight zero to a real element.
  const row = `${page.toString(16)} ${deltaRuns(first)}`
  lines.push(extras.length === 0 ? row : `${row} ${extras.join(';')}`)
}

const table = lines.join('\n')

const source = `${banner({
  script: 'npm run gen:uca',
  why: `M2.20: UCA 9.0.0 (DUCET) primary weights, for \`utf8mb4_0900_ai_ci\`.

Level 1 only. \`_ai_ci\` compares primary weights and nothing else, so the
secondary weights that separate 'e' from 'é' and the tertiary weights that
separate 'a' from 'A' are unreachable for it — carrying them would triple this
table to serve a collation that does not exist yet (doc 29's Layer 3).

Format, one line per non-null page:

  <page> <first weight of each of 256 code points> [<expansions>]

The middle field is delta-plus-run — \`[count*]delta\`, signed hex, each delta
against the *previous* value — over exactly 256 entries, and 0 means the code
point has no level-1 weight at all (every combining mark, which is what makes
this collation accent-insensitive). The third field is present only when some
code point in the page expands to more than one weight, and lists those extra
weights as \`offset:w,w\` pairs separated by \`;\`.

A page not listed here is not missing. UCA computes an *implicit* weight for
it from the code point, and \`uca.ts\` does the same — which is why 4,203 of
4,352 page slots cost nothing, and why the CJK ideographs are absent from a
table that orders them correctly.`,
  sources,
  counts: {
    'Page slots': PAGE_SLOTS,
    'Pages with weights': present.length,
    'Pages computed implicitly': PAGE_SLOTS - present.length,
    'Level-1 weights': weightCount,
    'Code points that expand': expandingCodePoints,
  },
})}

/** The pinned source these weights were read out of (ground rule 7). */
export const UCA900_SOURCE = '${REPO}@${REF} ${SOURCES.join(' ')}'

/** sha256 over the pinned source, so drift is a test failure, not a surprise. */
export const UCA900_SOURCE_SHA256 = '${sha256}'

/** Page slots in \`uca900_weight\` — 17 Unicode planes of 256 pages. */
export const UCA900_PAGE_SLOTS = ${PAGE_SLOTS}

/** Pages carrying explicit weights; every other slot is implicit. */
export const UCA900_PAGE_COUNT = ${present.length}

/** Level-1 weights across every explicit page. */
export const UCA900_WEIGHT_COUNT = ${weightCount}

/** The packed level-1 table. See the format note above. */
export const PACKED_UCA900_LEVEL1 = ${packed(table)}
`

writeFileSync(OUT, source)
console.log(
  `gen-uca: wrote ${OUT}\n` +
    `  ${present.length} pages, ${PAGE_SLOTS - present.length} implicit, ` +
    `${weightCount} level-1 weights, ${expandingCodePoints} expanding code points\n` +
    `  packed ${table.length} B raw\n` +
    `  source ${REPO}@${REF} ${SOURCES.length} file\n  sha256 ${sha256}`,
)
