/** Radix of deltas and absolute values in the internal generated tables. */
export const PACKED_RUN_RADIX = 36

/** Encode a page of weights or code points relative to its identity values. */
export function packRuns(values: readonly number[], base: number, repeats?: 'zero' | 'absolute', radix = 16): string {
  const out: string[] = []
  for (let i = 0; i < values.length;) {
    const value = values[i]!
    const delta = value - (base + i)
    let count = 1
    while (i + count < values.length && values[i + count]! - (base + i + count) === delta) count++
    const absolute = repeats === 'zero' ? value === 0 : repeats === 'absolute' && values[i + 1] === value && values[i + 2] === value
    if (count === 1 && absolute) {
      while (values[i + count] === value) count++
      out.push((count === 1 ? '' : String(count)) + '=' + (value === 0 ? '' : value.toString(radix)))
    } else {
      const digits = delta.toString(radix)
      out.push(count === 1 ? digits : `${count}*${digits}`)
    }
    i += count
  }
  return out.join(',')
}
