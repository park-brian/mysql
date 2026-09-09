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
// One parse, two outputs (D-33):
//
//   `@myjs/charsets`  the full registry — names, charsets, widths, pad.
//   `@myjs/protocol`  the byte widths alone, because two decisions the
//                     protocol must make have no session to consult: the
//                     pre-authentication connection-charset check, and
//                     `columnLengthForChars`. Generating them keeps
//                     `@myjs/protocol` free of a dependency on
//                     `@myjs/charsets`, which the release plan requires.
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
const METRICS_OUT = new URL('../packages/protocol/src/constants/charset-metrics.ts', import.meta.url).pathname

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
    for (const raw of m[2].replace(/\s+/g, '').split('|').filter(Boolean)) {
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
    })
  }
  return found
}

const sources = await fetchAllPinned(SOURCES)
const byId = new Map()
for (const s of sources) {
  for (const c of parseCharsetInfo(s.text)) {
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

console.log(
  `gen-charsets: ${collations.length} collations, ${classes.size} width classes\n` +
    `  -> ${REGISTRY_OUT}\n  -> ${METRICS_OUT}\n` +
    `  source ${REPO}@${REF} ${SOURCES.length} files\n  sha256 ${sha256}`,
)
