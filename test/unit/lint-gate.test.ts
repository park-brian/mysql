// M0.2 — the lint gate must actually fail. Ground rule 1 is only worth stating
// if a violation stops a commit, so the negative case is a test, not a promise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LINTER = new URL('../../tools/lint-isomorphic.mjs', import.meta.url).pathname

function lintTree(pkg: string, filename: string, source: string): { code: number; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'myjs-lint-'))
  try {
    const dir = join(root, 'packages', pkg, 'src')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, filename), source)
    try {
      const out = execFileSync(process.execPath, [LINTER, '--root', root], { encoding: 'utf8' })
      return { code: 0, out }
    } catch (err) {
      const e = err as { status: number; stderr: string }
      return { code: e.status, out: e.stderr }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a deliberate node:buffer import outside the exempt paths fails the gate', () => {
  const { code, out } = lintTree('protocol', 'bad.ts', "import { Buffer } from 'node:buffer'\nexport const x = Buffer\n")
  assert.equal(code, 1, 'linter must exit non-zero')
  assert.match(out, /node:buffer/)
})

test('a bare `Buffer` identifier outside the exempt paths fails the gate', () => {
  const { code, out } = lintTree('protocol', 'bad.ts', 'export const b = Buffer.alloc(4)\n')
  assert.equal(code, 1)
  assert.match(out, /uses `Buffer`/)
})

test('the same violations are permitted inside packages/vfs', () => {
  const { code } = lintTree('vfs', 'ok.ts', "import { openSync } from 'node:fs'\nexport const f = openSync\n")
  assert.equal(code, 0, 'packages/vfs is the one platform-dependent layer')
})

test('the same violations are permitted inside packages/server', () => {
  const { code } = lintTree('server', 'ok.ts', "import net from 'node:net'\nexport const n = net\n")
  assert.equal(code, 0, 'D-27: @myjs/server owns the TCP listener')
})

test('"Buffer" inside a comment or a string is not a violation', () => {
  const { code } = lintTree(
    'protocol',
    'ok.ts',
    '// Buffer is deliberately not used here\nexport const msg = "Buffer"\nexport const t = `Buffer`\n',
  )
  assert.equal(code, 0)
})
