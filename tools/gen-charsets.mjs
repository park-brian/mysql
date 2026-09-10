#!/usr/bin/env node
// M2.17 — the collation registry is generated from MySQL's own `CHARSET_INFO`
// definitions, not transcribed by hand.
//
// D-14's argument applies unchanged: there are ~290 collations, each with an
// id, a charset, `mbminlen`/`mbmaxlen` and a pad attribute, and transcription
// is how you get one of them wrong. It already happened here — the
// hand-written `PROHIBITED_CONNECTION_CHARSETS` list in `handshake.ts` missed
// id 159, `ucs2_general_mysql500_ci`, which is a two-byte charset and so must
// be refused as a connection charset. The generated rule catches it.
//
// Ground rule 7: the source is fetched, hashed and discarded. Nothing from
// MySQL's tree lands in this MIT repository — and note that we take *facts*
// only (ids, names, byte widths, pad attributes), never MySQL's comments or
// its weight tables, which are expression. That is D-29 applied to charsets.
//
// One parse, three outputs (D-33, and M2.5 since):
//
//   `@myjs/charsets`  the full registry — names, charsets, widths, pad.
//   `@myjs/charsets`  the weight tables (M2.5, M2.19), which are the same
//                     parse again: a collation's `CHARSET_INFO` body names
//                     the `sort_order_*` array it sorts by, so the id ->
//                     table mapping is read out of MySQL's own struct rather
//                     than guessed from collation names.
//   `@myjs/protocol`  the byte widths alone, because two decisions the
//                     protocol must make have no session to consult: the
//                     pre-authentication connection-charset check, and
//                     `columnLengthForChars`. Generating them keeps
//                     `@myjs/protocol` free of a dependency on
//                     `@myjs/charsets`, which the release plan requires.
//
// Weights are facts too — a number per code point — which is what keeps this
// inside ground rule 7. What we never take is MySQL's prose.
import { writeFileSync } from 'node:fs'
import { REF, REPO, banner, check, combinedSha256, fetchAllPinned, packed } from './lib/gen-common.mjs'

// Every `strings/` file that defines a `CHARSET_INFO`. Enumerated rather than
// globbed: the set is part of the pinned input, so a file appearing upstream
// should be a deliberate change here, not a silent one.
const SOURCES = [
  'strings/ctype-big5.cc',
  'strings/ctype-bin.cc',
  'strings/ctype-cp932.cc',
  'strings/ctype-czech.cc',
  'strings/ctype-eucjpms.cc',
  'strings/ctype-euc_kr.cc',
  'strings/ctype-extra.cc',
  'strings/ctype-gb18030.cc',
  'strings/ctype-gbk.cc',
  'strings/ctype-latin1.cc',
  'strings/ctype-sjis.cc',
  'strings/ctype-tis620.cc',
  'strings/ctype-uca.cc',
  'strings/ctype-ucs2.cc',
  'strings/ctype-ujis.cc',
  'strings/ctype-utf8.cc',
  'strings/ctype-win1250ch.cc',
]

const REGISTRY_OUT = new URL('../packages/charsets/src/registry.ts', import.meta.url).pathname
const WEIGHTS_OUT = new URL('../packages/charsets/src/collations/weights.ts', import.meta.url).pathname
const METRICS_OUT = new URL('../packages/protocol/src/constants/charset-metrics.ts', import.meta.url).pathname
const ENCODINGS_OUT = new URL('../packages/charsets/src/encodings.ts', import.meta.url).pathname

// The UCA collations share their state flags through a macro, so expand those
// before reading the flags. Definitions are in `ctype-uca.cc`.
const FLAG_MACROS = {
  MY_CS_UTF8MB3_UCA_FLAGS: ['MY_CS_COMPILED', 'MY_CS_STRNXFRM', 'MY_CS_UNICODE'],
  MY_CS_UTF8MB4_UCA_FLAGS: ['MY_CS_COMPILED', 'MY_CS_STRNXFRM', 'MY_CS_UNICODE', 'MY_CS_UNICODE_SUPPLEMENT'],
  MY_CS_UTF16_UCA_FLAGS: ['MY_CS_COMPILED', 'MY_CS_STRNXFRM', 'MY_CS_UNICODE', 'MY_CS_NONASCII'],
  MY_CS_UTF32_UCA_FLAGS: [
    'MY_CS_COMPILED', 'MY_CS_STRNXFRM', 'MY_CS_UNICODE', 'MY_CS_UNICODE_SUPPLEMENT', 'MY_CS_NONASCII',
  ],
  MY_CS_UCS2_UCA_FLAGS: ['MY_CS_COMPILED', 'MY_CS_STRNXFRM', 'MY_CS_UNICODE', 'MY_CS_NONASCII'],
}

/**
 * Walk one `.cc` file and pull out every `CHARSET_INFO` initializer.
 *
 * The layout is positional but every field we want is either the first token,
 * one of the first two string literals, or labelled by a `/* mbminlen *\/`
 * style comment — and it is identical whether the struct is a standalone
 * `CHARSET_INFO my_charset_x = {...}` or an element of `compiled_charsets[]`.
 */
function parseCharsetInfo(source) {
  const found = []
  const head = /\{\s*(\d+)\s*,\s*\d+\s*,\s*(?:\/\*[^*]*\*\/\s*)?\d+\s*,\s*(?:\/\*[^*]*\*\/\s*)?((?:MY_CS_\w+\s*\|?\s*)+)/g
  let m
  while ((m = head.exec(source)) !== null) {
    const id = Number(m[1])
    // id 0 is the null terminator of `compiled_charsets[]`, not a collation.
    if (id === 0) continue

    const flags = new Set()
    // Every macro in `FLAG_MACROS` is a UCA one, so expanding them is also how
    // we learn that a collation sorts by UCA rather than by a weight table:
    // `utf8mb4_unicode_ci` leaves both `sort_order` and `uca` null and is
    // distinguishable only by its state macro.
    let usesUca = false
    for (const raw of m[2].replace(/\s+/g, '').split('|').filter(Boolean)) {
      if (FLAG_MACROS[raw] !== undefined) usesUca = true
      for (const f of FLAG_MACROS[raw] ?? [raw]) flags.add(f)
    }

    // Brace-match, skipping string and character literals and comments, so a
    // `{` inside any of them cannot unbalance the scan.
    let depth = 0
    let end = -1
    for (let i = m.index; i < source.length; i++) {
      const c = source[i]
      if (c === '"' || c === "'") {
        const quote = c
        i++
        while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1
        continue
      }
      if (c === '/' && source[i + 1] === '*') {
        i = source.indexOf('*/', i) + 1
        continue
      }
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        end = i
        break
      }
    }
    check(end !== -1, `gen-charsets: unterminated CHARSET_INFO for id ${id}`)
    const body = source.slice(m.index, end + 1)

    const strings = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1])
    const mbminlen = /(\d+)\s*,\s*\/\*\s*mbminlen/.exec(body)
    const mbmaxlen = /(\d+)\s*,\s*\/\*\s*mbmaxlen/.exec(body)
    const pad = /\bNO_PAD\b/.test(body) ? 'NO PAD' : /\bPAD_SPACE\b/.test(body) ? 'PAD SPACE' : null
    // The two weight sources a collation can name. An 8-bit collation points
    // at a 256-entry `sort_order_*`; a Unicode one points at a
    // `MY_UNICASE_INFO` whose pages carry a weight per code point.
    const sortOrder = /\bsort_order_\w+\b/.exec(body)?.[0] ?? null
    const caseinfo = /&(my_unicase_\w+)/.exec(body)?.[1] ?? null
    // B0 / M2.3: the byte -> code point table, read out of the struct's own
    // `tab_to_uni` field rather than guessed from the charset name. The field
    // is commented `/* tab_to_uni */` in the hand-written files and
    // `/* to_uni */` in the generated one, so both spellings are accepted.
    const toUni = /\b(\w*to_uni\w*)\s*,\s*\/\*\s*(?:tab_)?to_uni/.exec(body)?.[1] ?? null

    check(strings.length >= 2, `gen-charsets: id ${id} has no charset/collation name`)
    check(mbminlen !== null && mbmaxlen !== null, `gen-charsets: id ${id} (${strings[1]}) has no mbminlen/mbmaxlen`)
    check(pad !== null, `gen-charsets: id ${id} (${strings[1]}) has no pad attribute`)

    found.push({
      id,
      charset: strings[0],
      collation: strings[1],
      mbminlen: Number(mbminlen[1]),
      mbmaxlen: Number(mbmaxlen[1]),
      pad,
      isDefault: flags.has('MY_CS_PRIMARY'),
      isBinary: flags.has('MY_CS_BINSORT'),
      sortOrder,
      caseinfo,
      toUni: toUni === 'nullptr' ? null : toUni,
      usesUca,
      lowerSort: flags.has('MY_CS_LOWER_SORT'),
      hidden: flags.has('MY_CS_HIDDEN'),
    })
  }
  return found
}

const sources = await fetchAllPinned(SOURCES)
const byId = new Map()
for (const s of sources) {
  for (const c of parseCharsetInfo(s.text).map((c) => ({ ...c, source: s.path }))) {
    const seen = byId.get(c.id)
    check(
      seen === undefined || seen.collation === c.collation,
      `gen-charsets: id ${c.id} is both ${seen?.collation} and ${c.collation}`,
    )
    byId.set(c.id, c)
  }
}
const collations = [...byId.values()].sort((a, b) => a.id - b.id)

// Self-checks before emitting. These are M2.1's acceptance list, plus the two
// facts the rest of the codebase already asserts and the one the hand-written
// list got wrong.
const by = (id) => collations.find((c) => c.id === id)
const expect = (id, collation, charset, mbmaxlen, pad) => {
  const c = by(id)
  check(
    c !== undefined && c.collation === collation && c.charset === charset && c.mbmaxlen === mbmaxlen && c.pad === pad,
    `gen-charsets: expected ${id} = ${collation}/${charset}/mb${mbmaxlen}/${pad}, got ${JSON.stringify(c)}`,
  )
}
expect(8, 'latin1_swedish_ci', 'latin1', 1, 'PAD SPACE')
expect(33, 'utf8mb3_general_ci', 'utf8mb3', 3, 'PAD SPACE')
expect(45, 'utf8mb4_general_ci', 'utf8mb4', 4, 'PAD SPACE')
expect(46, 'utf8mb4_bin', 'utf8mb4', 4, 'PAD SPACE')
expect(63, 'binary', 'binary', 1, 'NO PAD')
expect(224, 'utf8mb4_unicode_ci', 'utf8mb4', 4, 'PAD SPACE')
expect(246, 'utf8mb4_unicode_520_ci', 'utf8mb4', 4, 'PAD SPACE')
// D-10's default, and doc 29's headline: the 8.0 family is NO PAD, so
// `'a' = 'a '` is false where it was true in 5.7.
expect(255, 'utf8mb4_0900_ai_ci', 'utf8mb4', 4, 'NO PAD')
expect(278, 'utf8mb4_0900_as_cs', 'utf8mb4', 4, 'NO PAD')
check(by(63).isBinary, 'gen-charsets: id 63 must be a binary collation')
check(by(255).isDefault, 'gen-charsets: id 255 must be utf8mb4 default')
check(by(159)?.mbminlen === 2, 'gen-charsets: id 159 (ucs2_general_mysql500_ci) must be multibyte')

const sha256 = combinedSha256(sources)

// --- @myjs/charsets: the full registry --------------------------------------
//
// One collation per line: `id collation charset mbminlen mbmaxlen flags`,
// where flags is a subset of `n` (NO PAD), `d` (default for its charset) and
// `b` (binary). Absent flags are the common case, so the field is usually one
// character or none.
const registryLines = collations
  .map((c) => {
    const flags = `${c.pad === 'NO PAD' ? 'n' : ''}${c.isDefault ? 'd' : ''}${c.isBinary ? 'b' : ''}`
    return `${c.id} ${c.collation} ${c.charset} ${c.mbminlen} ${c.mbmaxlen}${flags === '' ? '' : ` ${flags}`}`
  })
  .join('\n')

writeFileSync(
  REGISTRY_OUT,
  `${banner({
    script: 'npm run gen:charsets',
    why: `M2.1 / M2.17: the collation registry, from MySQL's own \`CHARSET_INFO\`\ndefinitions. Facts only — ids, names, byte widths and pad attributes.\nWeight tables are a separate generator (M2.5, M2.20).`,
    sources,
    counts: { Collations: collations.length },
  })}

/** The upstream files this registry was generated from, for re-verification. */
export const COLLATION_TABLE_SOURCE = '${REPO}@${REF} strings/ctype-*.cc'

/** SHA-256 over every source file's own hash. CI regenerates and diffs. */
export const COLLATION_TABLE_SOURCE_SHA256 =
  '${sha256}'

/** Number of collations MySQL ${REF} compiles in. */
export const COLLATION_TABLE_SIZE = ${collations.length}

/**
 * One collation per line: \`id collation charset mbminlen mbmaxlen [flags]\`.
 *
 * Flags are a subset of \`n\` (NO PAD), \`d\` (the charset's default collation)
 * and \`b\` (binary). Expanded lazily by \`registry\` — a minified object
 * literal of ${collations.length} entries costs several times this in the bundle.
 */
export const PACKED_COLLATIONS = ${packed(registryLines)}
`,
)

// --- @myjs/charsets: the weight tables (M2.5, M2.19) -------------------------
//
// Two shapes, because MySQL has two.
//
//   An 8-bit collation sorts by a flat 256-entry `sort_order_*` table:
//   weight = table[byte], one byte per byte.
//
//   `utf8mb3_general_ci` and `utf8mb4_general_ci` sort by `my_unicase_default`,
//   a two-level page table: `page[cp >> 8][cp & 0xFF].sort`, two bytes per
//   character. Only 11 of its 256 pages are non-null, a null page means the
//   weight *is* the code point, and anything above `maxchar` 0xFFFF weighs the
//   constant 0xFFFD (`my_tosort_unicode`).
//
// That is Q-04's answer, and it is MySQL's own structure rather than an
// invention of ours: two-level pages, identity-page elision, a constant
// supplementary plane. Delta-plus-run on top of it is what gets the general_ci
// table to a few KB — see the sizes this script prints.
const allSource = sources.map((s) => s.text).join('\n')

/** Every `static const uint8_t sort_order_*[]` in the pinned sources. */
const byteTables = new Map()
{
  const decl = /static const uint8_t (sort_order_\w+)\[\]\s*=\s*\{/g
  let d
  while ((d = decl.exec(allSource)) !== null) {
    const open = allSource.indexOf('{', d.index)
    const close = allSource.indexOf('};', open)
    check(close !== -1, `gen-charsets: unterminated ${d[1]}`)
    const values = [...allSource.slice(open + 1, close).matchAll(/0x([0-9A-Fa-f]{2})|\b(\d+)\b/g)].map((v) =>
      v[1] !== undefined ? parseInt(v[1], 16) : Number(v[2]),
    )
    byteTables.set(d[1], values)
  }
}

/** `my_unicase_pages_default`, as page index -> 256 weights. */
const unicasePages = new Map()
{
  const utf8 = sources.find((s) => s.path.endsWith('ctype-utf8.cc'))
  check(utf8 !== undefined, 'gen-charsets: ctype-utf8.cc is not in SOURCES')
  const at = utf8.text.indexOf('static const MY_UNICASE_CHARACTER *my_unicase_pages_default[256]')
  check(at !== -1, 'gen-charsets: my_unicase_pages_default not found')
  const names = utf8.text
    .slice(utf8.text.indexOf('{', at) + 1, utf8.text.indexOf('};', at))
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
  check(names.length === 256, `gen-charsets: my_unicase_pages_default has ${names.length} pages, not 256`)
  names.forEach((name, page) => {
    if (name === 'nullptr') return
    const at2 = utf8.text.indexOf(`static const MY_UNICASE_CHARACTER ${name}[] = {`)
    check(at2 !== -1, `gen-charsets: page array ${name} not found`)
    const body = utf8.text.slice(at2, utf8.text.indexOf('}};', at2) + 3)
    // Each entry is `{ toupper, tolower, sort }`; only the third is a weight.
    const rows = [...body.matchAll(/\{\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*\}/g)]
    check(rows.length === 256, `gen-charsets: page ${name} has ${rows.length} entries, not 256`)
    unicasePages.set(
      page,
      rows.map((r) => parseInt(r[3], 16)),
    )
  })
}

// Which collations each table serves. Derived, never listed: an 8-bit
// collation is one that names a 256-entry `sort_order_*` and is single-byte; a
// general_ci one is a UTF-8 charset (mbminlen 1 — ucs2, utf16 and utf32 also
// fold through this table, but nothing here can transcode them) that folds
// through `my_unicase_default` without UCA, without
// `MY_CS_BINSORT` (that is `*_bin`, already memcmp), without `MY_CS_LOWER_SORT`
// (that reads `tolower`, not `sort`) and without `MY_CS_HIDDEN` (`filename`,
// which is not a user collation).
const byteWeighted = collations.filter(
  (c) => c.mbmaxlen === 1 && c.sortOrder !== null && byteTables.get(c.sortOrder)?.length === 256,
)
const unicaseWeighted = collations.filter(
  (c) =>
    c.mbminlen === 1 &&
    c.mbmaxlen > 1 &&
    c.caseinfo === 'my_unicase_default' &&
    !c.usesUca &&
    !c.isBinary &&
    !c.lowerSort &&
    !c.hidden,
)

const weightOf = (cp) => {
  const page = unicasePages.get(cp >> 8)
  return page === undefined ? cp : page[cp & 0xff]
}
const byteWeightsOf = (id) => byteTables.get(collations.find((c) => c.id === id).sortOrder)

// Self-checks: doc 29's two named quirks, as data rather than as folklore.
check(byteWeighted.some((c) => c.id === 8), 'gen-charsets: latin1_swedish_ci has no weight table')
check(
  unicaseWeighted.map((c) => c.id).join(',') === '33,45',
  `gen-charsets: expected unicase collations 33,45, got ${unicaseWeighted.map((c) => c.id).join(',')}`,
)
check(unicasePages.size === 11, `gen-charsets: expected 11 non-null unicase pages, got ${unicasePages.size}`)
check(weightOf(0x00e4) === weightOf(0x0061), 'gen-charsets: general_ci must fold a-umlaut onto a')
// Sharp s folds to a *single* S — one weight, not two, which is doc 29's
// "no expansions" and the reason 'sharp s' != 'ss' under general_ci.
check(weightOf(0x00df) === weightOf(0x0073), 'gen-charsets: general_ci must fold sharp s onto s')
// latin1_swedish_ci is Swedish: the umlauts sort *after* z, which is the point.
check(byteWeightsOf(8)[0xe4] > byteWeightsOf(8)[0x7a], 'gen-charsets: latin1_swedish_ci must sort a-umlaut after z')

// Delta-plus-run. A run is `[count*]delta`, the delta signed hex and relative
// to the identity weight, so an unfolded stretch of Unicode is one run of zeros
// and a 26-letter case fold is one run of -20.
const runs = (values, base) => {
  const out = []
  let i = 0
  while (i < values.length) {
    const d = values[i] - (base + i)
    let n = 1
    while (i + n < values.length && values[i + n] - (base + i + n) === d) n++
    const hex = (d < 0 ? '-' : '') + Math.abs(d).toString(16)
    out.push(n === 1 ? hex : `${n}*${hex}`)
    i += n
  }
  return out.join(',')
}

const usedByteTables = [...new Set(byteWeighted.map((c) => c.sortOrder))].sort()
const byteLines = usedByteTables
  .map((name) => `${name.replace('sort_order_', '')} ${runs(byteTables.get(name), 0)}`)
  .join('\n')
const unicaseLines = [...unicasePages.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([page, weights]) => `${page.toString(16)} ${runs(weights, page << 8)}`)
  .join('\n')
const weightedLines = [...byteWeighted, ...unicaseWeighted]
  .sort((a, b) => a.id - b.id)
  .map((c) => `${c.id} ${c.sortOrder === null ? '-' : c.sortOrder.replace('sort_order_', '')}`)
  .join('\n')

writeFileSync(
  WEIGHTS_OUT,
  `${banner({
    script: 'npm run gen:charsets',
    why: `M2.5 / M2.19: the weight tables for the *simple* collations — one weight\nper byte for the 8-bit charsets, one per code point for general_ci. UCA is\nM2.20 and is deliberately not here: its source is 7.4 MB.\n\nQ-04 asked how ~1.1 MB of source weights becomes a few tens of KB. The\nanswer is that MySQL already stores general_ci as two-level pages of which\n11 of 256 are non-null, the rest identity, with everything above 0xFFFF a\nconstant — so the elision is not a compression trick we invented, it is the\nsource structure. Delta-plus-run does the rest.`,
    sources,
    counts: {
      'Byte weight tables': usedByteTables.length,
      'Unicase pages': unicasePages.size,
      'Collations served': byteWeighted.length + unicaseWeighted.length,
    },
  })}

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const WEIGHT_TABLE_SOURCE_SHA256 =
  '${sha256}'

/**
 * The 8-bit weight tables: \`name runs\`, one per line.
 *
 * A run is \`[count*]delta\` with a signed hex delta from the identity weight,
 * so the ASCII stretch of most tables is a single run.
 */
export const PACKED_BYTE_WEIGHTS = ${packed(byteLines)}

/**
 * \`my_unicase_default\`'s non-null pages: \`page runs\`, one per line, the page
 * index in hex and the runs relative to the code point. An absent page is
 * identity; a code point above 0xFFFF weighs 0xFFFD.
 */
export const PACKED_UNICASE_WEIGHTS = ${packed(unicaseLines)}

/**
 * \`id table\`, one per line, where \`-\` means the unicase page table. Read out
 * of each collation's own \`CHARSET_INFO\`, not guessed from its name.
 */
export const PACKED_WEIGHTED_COLLATIONS = ${packed(weightedLines)}
`,
)

// --- @myjs/protocol: the byte widths alone ----------------------------------
//
// Grouped by `(mbminlen, mbmaxlen)` and run-length encoded, because there are
// only a handful of distinct widths across ~290 ids and the ids within each
// class are mostly contiguous. This is ~10x smaller than one line per id, and
// it is the whole reason the protocol can answer these two questions without
// depending on `@myjs/charsets`.
const classes = new Map()
for (const c of collations) {
  const key = `${c.mbminlen} ${c.mbmaxlen}`
  if (!classes.has(key)) classes.set(key, [])
  classes.get(key).push(c.id)
}
const ranges = (ids) => {
  const out = []
  let lo = ids[0]
  let prev = ids[0]
  for (const id of ids.slice(1)) {
    if (id !== prev + 1) {
      out.push(lo === prev ? `${lo}` : `${lo}-${prev}`)
      lo = id
    }
    prev = id
  }
  out.push(lo === prev ? `${lo}` : `${lo}-${prev}`)
  return out.join(',')
}
const metricLines = [...classes.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([widths, ids]) => `${widths} ${ranges(ids)}`)
  .join('\n')

writeFileSync(
  METRICS_OUT,
  `${banner({
    script: 'npm run gen:charsets',
    why: `D-33: \`@myjs/protocol\` must not depend on \`@myjs/charsets\` — the\nrelease plan ships the protocol at 0.1 and the charset registry at 0.2.\n\nTwo decisions the protocol makes with no session to consult need nothing\nbut a collation's byte widths: the pre-authentication connection-charset\ncheck (doc 12 — a multibyte charset makes the NUL-terminated fields\nambiguous) and \`columnLengthForChars\` (doc 15 — \`VARCHAR(255)\` utf8mb4\nreports 1020). Those widths are generated here from the same parse that\nbuilds the full registry, so there is no hand-maintained second copy.`,
    sources,
    counts: { Collations: collations.length, Classes: classes.size },
  })}

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const CHARSET_METRICS_SOURCE_SHA256 =
  '${sha256}'

/**
 * \`mbminlen mbmaxlen id-ranges\`, one width class per line.
 *
 * Only a handful of distinct widths exist across ${collations.length} collations and the ids
 * within a class are mostly contiguous, so ranges beat one line per id by an
 * order of magnitude.
 */
export const PACKED_CHARSET_METRICS = ${packed(metricLines)}
`,
)

// ---------------------------------------------------------------------------
// B0 / M2.3 — the byte -> code point tables for the single-byte charsets.
//
// These exist because trusting the host's `TextDecoder` for them was a real
// bug, not a hypothetical one. On a Node built without full ICU,
// `new TextDecoder('windows-1252')` *succeeds* and quietly behaves as
// ISO-8859-1, so MySQL's `latin1` decoded 0x80 to U+0080 instead of the euro
// sign, and the reverse table built from that decoder encoded the euro as
// `?`. No error anywhere. CI caught it; a full-ICU laptop never would.
//
// Generating them removes the host from a code path whose output is *stored* —
// the same argument D-23 makes about `Intl.Collator`. Bytes that land in a
// database must not depend on which build of which engine wrote them.
//
// Parsed per file rather than over the concatenation, because the array name
// is not always unique: `cs_to_uni` is declared in both `ctype-latin1.cc` and
// `ctype-tis620.cc`, and joining the sources would silently pick whichever
// came first.

/** `file -> array name -> 256 code points`, for every single-byte to_uni table. */
const uniTablesByFile = new Map()
for (const src of sources) {
  const found = new Map()
  const decl = /static const (?:unsigned short|uint16_t) (\w*to_uni\w*)\[\d*\]\s*=\s*\{/g
  let d
  while ((d = decl.exec(src.text)) !== null) {
    const open = src.text.indexOf('{', d.index)
    const close = src.text.indexOf('};', open)
    check(close !== -1, `gen-charsets: unterminated ${d[1]} in ${src.path}`)
    const values = [...src.text.slice(open + 1, close).matchAll(/0x([0-9A-Fa-f]+)|\b(\d+)\b/g)].map((v) =>
      v[1] !== undefined ? parseInt(v[1], 16) : Number(v[2]),
    )
    // The multi-byte charsets have to_uni tables too, tens of thousands of
    // entries wide. Those stay on `TextDecoder`; only the flat 256-entry ones
    // are cheap enough to carry.
    if (values.length === 256) found.set(d[1], values)
  }
  uniTablesByFile.set(src.path, found)
}

/** `charset -> 256 code points`. Keyed by charset, since collations share one. */
const charsetToUni = new Map()
for (const c of collations) {
  if (c.mbmaxlen !== 1 || c.toUni === null) continue
  const table = uniTablesByFile.get(c.source)?.get(c.toUni)
  if (table === undefined) continue
  const existing = charsetToUni.get(c.charset)
  if (existing === undefined) {
    charsetToUni.set(c.charset, table)
    continue
  }
  // Every collation of a charset must agree about what its bytes mean. If two
  // ever disagreed, one of them would be decoding a different charset.
  check(
    existing.every((v, i) => v === table[i]),
    `gen-charsets: ${c.charset} has two different to_uni tables (${c.collation} names ${c.toUni})`,
  )
}

check(charsetToUni.size > 0, 'gen-charsets: no single-byte to_uni tables found')
check(
  charsetToUni.get('latin1')?.[0x80] === 0x20ac,
  "gen-charsets: MySQL's latin1 must map 0x80 to the euro sign — it is cp1252, not ISO-8859-1",
)
check(charsetToUni.get('ascii')?.[0x41] === 0x41, 'gen-charsets: ascii must map 0x41 to A')

// Which single-byte charsets did *not* get a table, and why. Exactly two, and
// both for a reason rather than by omission:
//
//   `binary` has no code points at all — it is bytes, uninterpreted, and doc 29
//   is explicit that id 63 "is not a text collation".
//
//   `tis620` has a table in its source file, but MySQL reads it through a
//   custom `mb_wc` handler and leaves the struct's `tab_to_uni` field null. We
//   read the struct rather than guessing from names (the discipline M2.5
//   established), so we do not pick it up — and inferring it would mean
//   choosing between two files that both declare `cs_to_uni`. It stays on
//   `TextDecoder`, covered by the behavioural probe in `encoding.ts`.
//
// Asserted as an exact list so an upstream change is a build failure rather
// than a silent gap.
const singleByteCharsets = [...new Set(collations.filter((c) => c.mbmaxlen === 1).map((c) => c.charset))]
const untabled = singleByteCharsets.filter((cs) => !charsetToUni.has(cs)).sort()
check(
  untabled.join(',') === 'binary,tis620',
  `gen-charsets: single-byte charsets with no to_uni table changed: ${untabled.join(', ')}`,
)

const encodingLines = [...charsetToUni]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([cs, table]) => `${cs} ${runs(table, 0)}`)
  .join('\n')

writeFileSync(
  ENCODINGS_OUT,
  `${banner({
    script: 'npm run gen:charsets',
    why: `B0 / M2.3: byte -> code point tables for the single-byte charsets, read
out of each \`CHARSET_INFO\`'s own \`tab_to_uni\` field.

These replace \`TextDecoder\` for every charset listed here, because trusting it
was a real bug: on a runtime without full ICU, \`new TextDecoder('windows-1252')\`
succeeds and silently behaves as ISO-8859-1, so MySQL's latin1 decoded 0x80 to
U+0080 rather than the euro sign and no error was raised anywhere.

Format: \`<charset> <256 code points>\`, delta-plus-run against the byte value
itself — the same codec and the same \`expandRuns\` decoder the weight tables
use. The ASCII half of every one of these tables is identity, so it collapses
to a single run.

\`tis620\` is deliberately absent: MySQL leaves its struct's \`tab_to_uni\` null
and reads the table through a custom handler, so it stays on \`TextDecoder\`.`,
    sources,
    counts: { 'Single-byte charsets': charsetToUni.size, 'Left on TextDecoder': untabled.join(' ') },
  })}

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const ENCODING_TABLE_SOURCE_SHA256 =
  '${sha256}'

/**
 * \`charset code-points\`, one single-byte charset per line.
 *
 * Delta-plus-run, the same codec \`collations/weights.ts\` uses.
 */
export const PACKED_CHARSET_TO_UNI = ${packed(encodingLines)}
`,
)

console.log(
  `gen-charsets: ${collations.length} collations, ${classes.size} width classes\n` +
    `  ${usedByteTables.length} byte weight tables, ${unicasePages.size} unicase pages, ` +
    `${byteWeighted.length + unicaseWeighted.length} weighted collations\n` +
    `  ${charsetToUni.size} single-byte encoding tables\n` +
    `  -> ${REGISTRY_OUT}\n  -> ${WEIGHTS_OUT}\n  -> ${METRICS_OUT}\n  -> ${ENCODINGS_OUT}\n` +
    `  source ${REPO}@${REF} ${SOURCES.length} files\n  sha256 ${sha256}`,
)
