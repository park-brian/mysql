// What every capture and fuzz tool here reads from its command line, and the
// seeded generator they share so that a seed reproduces a corpus.

/** `--name value` from the command line, or `fallback`. */
export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

/**
 * xorshift32, seeded: `rnd()` in [0, 1), and the draws built on it. Every
 * corpus tool uses this one generator, so `--seed` reproduces a corpus
 * exactly; changing it changes every committed fixture's statements.
 */
export function xorshift(seed) {
  let state = seed || 1
  const rnd = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
  return {
    rnd,
    pick: (xs) => xs[Math.floor(rnd() * xs.length)],
    chance: (p) => rnd() < p,
    int: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
  }
}
