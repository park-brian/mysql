#!/usr/bin/env node
// Clone the pinned MySQL tree into `reference/`, which every generator and the
// census will then read instead of the network.
//
// Ground rule 7 is about what may be **committed**: `reference/` is gitignored
// and nothing from it is copied into this repository. What a clone buys is that
// the generators become a pure function of a commit already on disk — no
// network, no `api.github.com` rate limit, and `npm run gen:*` reproducing the
// committed tables offline, which is the property CI checks with
// `git diff --exit-code`.
//
//   node tools/fetch-reference.mjs
//
// Blobs are fetched, not filtered. `--filter=blob:none` would make every later
// read a network round trip, which is the thing this exists to remove.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { REPO, REF } from './lib/gen-common.mjs'

const REFERENCE = fileURLToPath(new URL('../reference/', import.meta.url))
const DEST = join(REFERENCE, 'mysql')
// doc 90's ref is abbreviated; `git fetch` wants the whole thing.
const FULL_REF = 'e174239c5b3c2bcf164649042ab8a7fc972ce88d'

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'inherit' })
const quiet = (args, cwd) => {
  try {
    execFileSync('git', args, { cwd, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (existsSync(DEST) && quiet(['cat-file', '-e', `${FULL_REF}^{commit}`], DEST)) {
  console.log(`reference/mysql already has ${REF}`)
  process.exit(0)
}

console.log(`fetching ${REPO}@${REF} into reference/mysql (~1.7 GB, shallow)`)
mkdirSync(REFERENCE, { recursive: true })
const staging = `${DEST}.partial`
rmSync(staging, { recursive: true, force: true })
git(['init', '-q', staging])
git(['remote', 'add', 'origin', `https://github.com/${REPO}.git`], staging)
// The exact commit, at depth 1 — not a branch. `trunk` happens to sit on this
// commit today and will not tomorrow, and a reference tree at a *different*
// commit would silently generate different tables, which is the one failure
// this must not have.
git(['fetch', '-q', '--depth', '1', 'origin', FULL_REF], staging)
git(['checkout', '-q', 'FETCH_HEAD'], staging)
rmSync(DEST, { recursive: true, force: true })
execFileSync('mv', [staging, DEST])
console.log(`reference/mysql is at ${FULL_REF}`)
