#!/usr/bin/env node
// Timing assertions measure competing connections, without unrelated test processes.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const protocol = process.argv[2] === 'protocol'
const suites = protocol ? ['protocol'] : ['unit', 'format', 'protocol', 'crash']
const options = process.argv.slice(protocol ? 3 : 2)
const files = suites.flatMap((suite) => readdirSync(join('test', suite), { recursive: true })
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => join('test', suite, file)))
const isolated = ['mysql2-in-list.test.ts', 'bulk-latency.test.ts'].map((file) => join('test', 'protocol', file))
for (const file of isolated) if (!files.includes(file)) throw new Error(`${file} is missing`)

for (const phase of [files.filter((file) => !isolated.includes(file)), ...isolated.map((file) => [file])]) {
  if (phase.length === 0) continue
  const result = spawnSync(process.execPath, ['--test', ...options, ...phase], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
