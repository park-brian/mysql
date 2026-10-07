// The log sequence number. Until Tier 4 there is no log, and an LSN is a
// counter that every page change draws from and the superblock persists — so
// that page LSNs, the dirty list's order and a torn-page check already mean
// what they will mean once the WAL arrives.
export class LsnClock {
  #value: number

  constructor(start: number) {
    this.#value = start
  }

  /** The highest LSN issued. */
  get current(): number {
    return this.#value
  }

  next(): number {
    return ++this.#value
  }
}
