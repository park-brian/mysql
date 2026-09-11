// Shared machinery for the generators (M2.17).
//
// Every generator in this repository obeys the same contract, set by M1.6's
// `gen-errors.mjs` and required by D-14 and ground rule 7:
//
//   1. The upstream source is pinned to an exact ref — the tree docs 10–30
//      were written against — so re-running reproduces the committed output
//      byte for byte. That property is what CI checks with
//      `git diff --exit-code`.
//   2. The source is fetched, hashed, and discarded. It never touches disk and
//      is never vendored: MySQL is GPLv2 and this repository is MIT.
//   3. The emitted file carries its provenance as exported code, so a test can
//      assert on it rather than on a comment.
//   4. Bulk data is packed into a single template literal expanded lazily on
//      first use. A minified object literal of a few thousand entries costs
//      several times as much in the bundle as the string it was built from.
//
// These are `.mjs` in `tools/`, which the isomorphic lint gate does not walk —
// so `node:` imports here are fine, while everything they *emit* into
// `packages/` must stay `Uint8Array`-only.
import { createHash } from 'node:crypto'

/** doc 90: the tree every constant in docs 10–30 cites. */
export const REPO = 'mysql/mysql-server'
export const REF = 'e174239c'

/**
 * Fetch one pinned upstream file, hash it, and hand back both. The text is
 * returned to the caller and never written anywhere.
 */
export async function fetchPinned(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${path}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`fetch ${url} failed with ${response.status}`)
    process.exit(1)
  }
  const text = await response.text()
  return { path, text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') }
}

/**
 * Fetch one pinned upstream file as **bytes**, hashed as bytes.
 *
 * `fetchPinned` decodes with `Response.text()`, which is UTF-8 with
 * replacement — fine for MySQL's C sources, which are ASCII, and wrong for
 * anything that is not. `mysql-test/t/ctype_latin1.test` is latin1 and
 * `ctype_sjis.test` is Shift-JIS, on purpose, so decoding either as UTF-8
 * destroys exactly the bytes those files exist to test (M3.12). The hash is
 * over the bytes for the same reason: hashing a mangled decode identifies the
 * mangling rather than the file.
 */
export async function fetchPinnedBytes(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${path}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`fetch ${url} failed with ${response.status}`)
    process.exit(1)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/** Fetch several, in parallel, preserving order. */
export async function fetchAllPinned(paths) {
  return Promise.all(paths.map(fetchPinned))
}

/**
 * One hash over several sources, so a set of files has a single identity.
 * Order-independent by construction: the per-file hashes are sorted.
 */
export function combinedSha256(sources) {
  const h = createHash('sha256')
  for (const s of [...sources].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    h.update(`${s.path} ${s.sha256}\n`, 'utf8')
  }
  return h.digest('hex')
}

/** Fail loudly rather than emitting something subtly wrong. */
export function check(ok, message) {
  if (!ok) {
    console.error(message)
    process.exit(1)
  }
}

/**
 * A generated-file banner. `script` is the npm script that reproduces it.
 */
export function banner({ script, why, sources, counts = {} }) {
  const lines = [
    `// GENERATED FILE — do not edit by hand. Run \`${script}\`.`,
    '//',
    ...why.split('\n').map((l) => (l === '' ? '//' : `// ${l}`)),
    '//',
    ...sources.map((s) => `// Source:  ${REPO}@${REF} ${s.path}`),
  ]
  for (const [k, v] of Object.entries(counts)) lines.push(`// ${k}: ${v}`)
  return lines.join('\n')
}

/**
 * A template literal is only safe for data that contains no backtick, no `\`
 * and no `${`. Every table we generate is ASCII identifiers and digits, so
 * assert it rather than escaping and hoping.
 */
export function packed(text) {
  check(!/[`\\]|\$\{/.test(text), 'packed data contains a character that would break a template literal')
  return `\`${text}\``
}
