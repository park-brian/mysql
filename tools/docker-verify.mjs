#!/usr/bin/env node
// Disposable Linux dependencies and artifacts; the checkout is mounted read-only.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const name = `myjs-verify-${randomUUID()}`
const reference = process.argv.includes('--reference')
const full = process.argv.includes('--full')
const mysqlName = `${name}-mysql`
const network = `${name}-network`
const NODE = 'node:22.18.0-bookworm'
const MYSQL = 'mysql:8.4.11@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242'

function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed (${result.status}): ${result.stderr ?? ''}`)
  return result.stdout?.trim()
}

let nodeStarted = false
let mysqlStarted = false
let networkCreated = false
try {
  if (reference) {
    docker(['network', 'create', network])
    networkCreated = true
    docker(['run', '-d', '--name', mysqlName, '--network', network, '--network-alias', 'reference',
      '-e', 'MYSQL_ROOT_PASSWORD=review-root', '-e', 'MYSQL_ROOT_HOST=%', MYSQL])
    mysqlStarted = true
    let ready = false
    for (let n = 0; n < 90; n++) {
      const state = spawnSync('docker', ['exec', mysqlName, 'mysql', '--protocol=TCP', '-h127.0.0.1', '-uroot', '-preview-root', '-e', 'SELECT 1'], { stdio: 'ignore' })
      if (state.status === 0) { ready = true; break }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!ready) {
      docker(['logs', mysqlName], { allowFailure: true })
      throw new Error('reference MySQL did not become ready in 90 seconds')
    }
  }
  docker(['run', '-d', '--name', name, ...(reference ? ['--network', network] : []),
    '--mount', `type=bind,source=${root},target=/source,readonly`, '--workdir', '/work', NODE, 'sleep', 'infinity'])
  nodeStarted = true
  const setup = 'tar -C /source --exclude=./node_modules --exclude=./.git --exclude=./.pack --exclude=./.tmp --exclude=./reference -cf - . | tar -C /work -xf - && npm ci --no-audit --no-fund'
  docker(['exec', name, 'bash', '-lc', setup])
  for (const args of [['run', 'typecheck'], ['run', 'lint'], ['test'], ['run', 'size'], ['run', 'pack', '--', '--smoke']]) {
    docker(['exec', name, 'npm', ...args])
  }
  if (full) {
    docker(['exec', '-e', 'FUZZ_SEED=20261010', name, 'npm', 'run', 'fuzz'])
    docker(['exec', '-e', 'CRASH_POINTS=10000', name, 'npm', 'run', 'test:crash'])
  }
  if (reference) {
    const client = spawnSync('docker', ['cp', `${mysqlName}:/usr/bin/mysql`, '-'], { maxBuffer: 64 * 1024 * 1024 })
    if (client.error) throw client.error
    if (client.status !== 0) throw new Error(`copying the reference client failed: ${client.stderr}`)
    const installed = spawnSync('docker', ['exec', '-i', name, 'tar', '-C', '/usr/local/bin', '-xf', '-'], { input: client.stdout, stdio: ['pipe', 'inherit', 'inherit'] })
    if (installed.error) throw installed.error
    if (installed.status !== 0) throw new Error('installing the reference client failed')
    docker(['exec', name, 'node', 'tools/exit-criterion.mjs'])
    docker(['exec', '-e', 'MYSQL_HOST=reference', '-e', 'MYSQL_PASSWORD=review-root', name, 'node', 'tools/verify-reference.mjs'])
  }
  console.log('Docker verification passed; checkout untouched.')
} finally {
  if (nodeStarted) docker(['rm', '-f', '-v', name], { allowFailure: true })
  if (mysqlStarted) docker(['rm', '-f', '-v', mysqlName], { allowFailure: true })
  if (networkCreated) docker(['network', 'rm', network], { allowFailure: true })
}
