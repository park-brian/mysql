import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

/** Windows cannot exec npm.cmd directly; invoke npm's JavaScript CLI instead. */
export function npmCommand(command, args) {
  if (command !== 'npm' && command !== 'npx') return [command, args]
  if (process.platform !== 'win32') return [command, args]
  const filename = `${command}-cli.js`
  const candidates = [
    ...(process.env.npm_execpath ? [join(dirname(process.env.npm_execpath), filename)] : []),
    ...[dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)].map((dir) => join(dir, 'node_modules/npm/bin', filename)),
  ]
  const cli = candidates.find(existsSync)
  if (cli === undefined) throw new Error(`cannot locate ${filename}; install Node with npm on PATH`)
  return [process.execPath, [cli, ...args]]
}
