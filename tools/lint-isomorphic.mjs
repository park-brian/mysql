#!/usr/bin/env node
// Ground rule 1 (docs/44-roadmap.md): `Uint8Array` and `DataView` only above
// the VFS. No `Buffer`, no `node:*`. Enforced by a lint rule, not by good
// intentions.
//
// It also holds the package graph to what CLAUDE.md draws: a package imports
// only the `@myjs/*` packages `ALLOWED` gives it, declares exactly the ones it
// imports, and declares nothing else. The edge that matters most is the one
// that is missing: `@myjs/protocol` never reaches `@myjs/charsets` or
// `@myjs/types` (D-33), because the release plan ships it first.
//
// Exemptions (D-27): `packages/vfs` is the platform-dependent storage layer;
// `packages/server` opens TCP sockets and hosts workers; and
// `packages/core/src/host/*` holds the conditional-export files that adapt to
// a host runtime — notably the mysql2-facing duplex, which must emit Node
// `Buffer`s because mysql2's PacketParser calls `chunk.copy()`.
import { fileURLToPath } from 'node:url'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { builtinModules } from 'node:module'
import { API } from 'typescript/unstable/sync'
import * as ts from 'typescript/unstable/ast'
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')))

// `--root <dir>` lets the negative-fixture test point the linter at a throwaway
// tree, so the repository never has to carry a permanently-failing file.
const rootFlag = process.argv.indexOf('--root')
const ROOT = rootFlag === -1
  ? fileURLToPath(new URL('..', import.meta.url))
  : process.argv[rootFlag + 1]
const EXEMPT = [
  join('packages', 'vfs') + sep,
  join('packages', 'server') + sep,
  join('packages', 'core', 'src', 'host') + sep,
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts')) yield p
  }
}

/** Which `@myjs/*` packages each package may depend on. */
const ALLOWED = {
  bytes: [],
  vfs: [],
  charsets: ['bytes'],
  protocol: ['bytes'],
  types: ['bytes', 'charsets'],
  parser: ['bytes', 'charsets'],
  engine: ['bytes', 'charsets', 'types', 'vfs'],
  core: ['bytes', 'charsets', 'engine', 'parser', 'protocol', 'types', 'vfs'],
  server: ['core', 'protocol'],
  myjs: ['core', 'server'],
}

const files = readdirSync(join(ROOT, 'packages')).flatMap((pkg) => {
  const src = join(ROOT, 'packages', pkg, 'src')
  try { return [...walk(src)] } catch (e) { if (e.code === 'ENOENT') return []; throw e }
})
const api = new API({ cwd: ROOT })
let snapshot
const problems = []
try {
  snapshot = api.updateSnapshot({ openFiles: files })
  for (const pkg of readdirSync(join(ROOT, 'packages'))) {
    const srcDir = join(ROOT, 'packages', pkg, 'src')
    let isDir = false
    try { isDir = statSync(srcDir).isDirectory() } catch { /* no src yet */ }
    if (!isDir) continue

    const imported = new Set()
    for (const file of walk(srcDir)) {
      const rel = relative(ROOT, file)
      const source = snapshot.getDefaultProjectForFile(file)?.program.getSourceFile(file)
      if (source === undefined) throw new Error('compiler did not load ' + file)
      const exempt = EXEMPT.some((path) => rel.startsWith(path))
      const report = (node, message) => {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        problems.push(`${rel}:${line}  ${message}`)
      }
      const specifier = (node) => {
        if (node === undefined || (node.kind !== ts.SyntaxKind.StringLiteral && node.kind !== ts.SyntaxKind.NoSubstitutionTemplateLiteral)) return
        const name = node.text
        const workspace = /^@myjs\/([a-z-]+)(?:\/|$)/.exec(name)
        if (workspace !== null && workspace[1] !== pkg) imported.add(workspace[1])
        if (!exempt && (name.startsWith('node:') || BUILTINS.has(name))) report(node, `imports '${name}' outside the exempt paths`)
      }
      const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier(node.moduleSpecifier)
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier(node.argument.literal)
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier(node.arguments[0])
        if (!exempt && ts.isIdentifier(node) && node.text === 'Buffer') report(node, 'uses `Buffer`; use Uint8Array/DataView')
        node.forEachChild(visit)
      }
      visit(source)
    }
    const allowed = ALLOWED[pkg]
    if (allowed === undefined) {
      problems.push(`packages/${pkg}  has no entry in the package graph (ALLOWED in tools/lint-isomorphic.mjs)`)
      continue
    }
    for (const dep of imported) if (!allowed.includes(dep)) problems.push(`packages/${pkg}  imports @myjs/${dep}, an edge the package graph does not allow`)
    let manifest
    try { manifest = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8')) } catch { /* a fixture tree has none */ }
    if (manifest !== undefined) {
      const declared = Object.keys(manifest.dependencies ?? {}).filter((d) => d.startsWith('@myjs/')).map((d) => d.slice('@myjs/'.length))
      for (const dep of imported) if (!declared.includes(dep)) problems.push(`packages/${pkg}  imports @myjs/${dep} without declaring it`)
      for (const dep of declared) if (!imported.has(dep)) problems.push(`packages/${pkg}  declares @myjs/${dep} and never imports it`)
    }
  }

} finally {
  try { snapshot?.dispose() } finally { api.close() }
}

if (problems.length > 0) {
  console.error('isomorphic lint failed — ground rule 1 (no Buffer, no node:* above the VFS) and the package graph:\n')
  for (const p of problems) console.error('  ' + p)
  console.error(`\n${problems.length} problem(s). Exempt paths: ${EXEMPT.join(', ')}`)
  process.exit(1)
}
console.log('isomorphic lint: clean, package graph as drawn')
