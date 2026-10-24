// The reference binaries, suite and Docker verifier must describe one release.
import reference from './mysql-reference.json' with { type: 'json' }

export const MYSQL_REFERENCE = reference
export const MYSQL_VERSION = reference.version
export const MYSQL_IMAGE = `mysql:${MYSQL_VERSION}@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242`

export function assertMysqlVersion(output, binary) {
  const version = /\bVer\s+(\S+)/.exec(output)?.[1] ?? output.trim()
  if (version !== MYSQL_VERSION) throw new Error(`Expected ${binary} ${MYSQL_VERSION}, found ${version}; install the pinned reference packages`)
  return version
}

/** Refuse to combine a fresh executor run with a different server cohort. */
export function assertMysqltestFiles(files, recorded) {
  const actual = [...files].sort(), expected = [...recorded].sort()
  if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) {
    throw new Error(`mysql-test suite differs from the recorded ${MYSQL_VERSION} baseline (${actual.length} files, expected ${expected.length}); install the pinned mysql-community-test package`)
  }
}
