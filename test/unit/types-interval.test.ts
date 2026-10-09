// M5.10 — INTERVAL arithmetic on MySQL's day number. `calc_daynr` and
// `get_date_from_daynr` are MySQL's own calendar code, re-derived here, so the
// check that could falsify them is an independent calendar: JavaScript's
// proleptic Gregorian `Date`, which agrees with MySQL's from year 1 on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addInterval, dayNumber, intervalOf, intValue, stringValue } from '@myjs/types'

const at = (y: number, m: number, d: number) => ({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0, microsecond: 0 })

test('M5.10: adding days agrees with the proleptic Gregorian calendar from year 1 to 9999', () => {
  let seed = 7
  const next = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed % n
  }
  for (let i = 0; i < 5000; i++) {
    const y = 1 + next(9999)
    const m = 1 + next(12)
    const d = 1 + next(28)
    const days = next(200000) - 100000
    const js = new Date(0)
    js.setUTCFullYear(y, m - 1, d)
    js.setUTCDate(js.getUTCDate() + days)
    const got = addInterval(at(y, m, d), { months: 0n, micros: BigInt(days) * 86_400_000_000n })
    const year = js.getUTCFullYear()
    if (year < 1 || year > 9999) continue
    assert.deepEqual(got, at(year, js.getUTCMonth() + 1, js.getUTCDate()), `${y}-${m}-${d} + ${days} days`)
  }
  // Day numbers are consecutive across a leap day, a century and 1582.
  assert.equal(dayNumber(2024, 3, 1) - dayNumber(2024, 2, 28), 2)
  assert.equal(dayNumber(1900, 3, 1) - dayNumber(1900, 2, 28), 1)
  assert.equal(dayNumber(1582, 10, 15) - dayNumber(1582, 10, 4), 11)
})

test('M5.10: months clamp the day, and the range ends at 9999 and the zero date', () => {
  const month = intervalOf(intValue(1n), 'MONTH') as NonNullable<ReturnType<typeof intervalOf>>
  assert.deepEqual(addInterval(at(2024, 1, 31), month), at(2024, 2, 29))
  assert.deepEqual(addInterval(at(2023, 1, 31), month), at(2023, 2, 28))
  assert.equal(addInterval(at(9999, 12, 31), intervalOf(intValue(1n), 'DAY') as NonNullable<ReturnType<typeof intervalOf>>), undefined)
  assert.deepEqual(addInterval(at(1, 1, 1), intervalOf(intValue(1n), 'DAY') as NonNullable<ReturnType<typeof intervalOf>>, true), { ...at(0, 0, 0) })
  assert.equal(addInterval(at(0, 0, 0), month), undefined)
  // A compound value's fields align right; a microsecond field is a fraction.
  assert.deepEqual(intervalOf(stringValue('1:2:3', 255), 'DAY_SECOND'), { months: 0n, micros: 3_723_000_000n })
  assert.deepEqual(intervalOf(stringValue('1.5', 255), 'SECOND_MICROSECOND'), { months: 0n, micros: 1_500_000n })
  assert.equal(intervalOf(stringValue('1:2:3', 255), 'HOUR_MINUTE'), undefined)
})
