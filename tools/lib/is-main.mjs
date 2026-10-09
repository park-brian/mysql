// Whether a module is the script Node was asked to run, rather than an import.
// Comparing `import.meta.url` with `file://${argv[1]}` breaks on a path with a
// space (the URL escapes it) or a symlink, so both sides are resolved paths.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function isMain(url) {
  const script = process.argv[1]
  if (script === undefined) return false
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(script)
  } catch {
    return false
  }
}
