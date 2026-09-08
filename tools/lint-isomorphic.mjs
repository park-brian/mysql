#!/usr/bin/env node
// Ground rule 1 (docs/44-roadmap.md): `Uint8Array` and `DataView` only above
// the VFS. No `Buffer`, no `node:*`. Enforced by a lint rule, not by good
// intentions.
//
// Exemptions (D-27): `packages/vfs` is the platform-dependent storage layer;
// `packages/server` opens TCP sockets and hosts workers; and
// `packages/core/src/host/*` holds the conditional-export files that adapt to
// a host runtime — notably the mysql2-facing duplex, which must emit Node
// `Buffer`s because mysql2's PacketParser calls `chunk.copy()`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// `--root <dir>` lets the negative-fixture test point the linter at a throwaway
// tree, so the repository never has to carry a permanently-failing file.
const rootFlag = process.argv.indexOf('--root')
const ROOT = rootFlag === -1
  ? new URL('..', import.meta.url).pathname
  : process.argv[rootFlag + 1]
const EXEMPT = [
  join('packages', 'vfs') + sep,
  join('packages', 'server') + sep,
  join('packages', 'core', 'src', 'host') + sep,
]

/** Blank out comments and string/template literals so we match real code only. */
function stripLiterals(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && c2 === '*') {
      out += '  '; i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '; i += 2
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '; i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += ' '; i++ }
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += ' '; i++
    } else {
      out += c; i++
    }
  }
  return out
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts')) yield p
  }
}

// Import/export specifiers are erased along with the surrounding string, so we
// match them on the raw source and everything else on the stripped source.
const NODE_SPECIFIER = /(?:^|[\s;])(?:import|export)[\s\S]{0,200}?from\s*['"](node:[^'"]+)['"]/g
const BARE_NODE_IMPORT = /(?:^|[\s;])import\s*['"](node:[^'"]+)['"]/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"](node:[^'"]+)['"]\s*\)/g
const REQUIRE = /\brequire\s*\(\s*['"](node:[^'"]+)['"]\s*\)/g
const BUFFER = /\bBuffer\b/g

const problems = []
for (const pkg of readdirSync(join(ROOT, 'packages'))) {
  const srcDir = join(ROOT, 'packages', pkg, 'src')
  let isDir = false
  try { isDir = statSync(srcDir).isDirectory() } catch { /* no src yet */ }
  if (!isDir) continue

  for (const file of walk(srcDir)) {
    const rel = relative(ROOT, file)
    if (EXEMPT.some((e) => rel.startsWith(e))) continue
    // A file may opt out only by living in an exempt path — never by comment.
    const raw = readFileSync(file, 'utf8')
    const code = stripLiterals(raw)

    const lineOf = (index) => raw.slice(0, index).split('\n').length

    for (const re of [NODE_SPECIFIER, BARE_NODE_IMPORT, DYNAMIC_IMPORT, REQUIRE]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(raw)) !== null) {
        problems.push(`${rel}:${lineOf(m.index)}  imports '${m[1]}' outside the exempt paths`)
      }
    }
    BUFFER.lastIndex = 0
    let m
    while ((m = BUFFER.exec(code)) !== null) {
      problems.push(`${rel}:${lineOf(m.index)}  uses \`Buffer\`; use Uint8Array/DataView`)
    }
  }
}

if (problems.length > 0) {
  console.error('isomorphic lint failed — ground rule 1 (no Buffer, no node:* above the VFS):\n')
  for (const p of problems) console.error('  ' + p)
  console.error(`\n${problems.length} problem(s). Exempt paths: ${EXEMPT.join(', ')}`)
  process.exit(1)
}
console.log('isomorphic lint: clean')
