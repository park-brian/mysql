// M4.24 — what any `Table` must do: the conformance suite (doc 30).
//
// "The executor cannot tell the two apart" is the done-when, and this is what
// it means in cases: the same rows back, in the same orders, the same errors
// with the same numbers, for every engine. Exported, as the VFS suite is, so a
// third engine runs this identical body — from `@myjs/engine/conformance`, out
// of the main bundle — and with no test-runner dependency: each case is a
// function that throws on failure.
//
// What an engine may differ in is declared, not discovered: `transactional`
// and `consistentReads` (`StorageEngine`). These cases are autocommit and
// single-session, the ground where those capabilities do not show; the native
// engine's transactions are tested by name, elsewhere.
import { FIELD_TYPE, MyjsError } from '@myjs/bytes'
import { encodeDouble, encodeInt } from '@myjs/types'
import type { ColumnDef, IndexDef, TableSpec } from './schema.ts'
import type { KeyRange, Table } from './table.ts'

/** Make a table to `spec` in a fresh catalog, in the engine under test. */
export type TableFactory = (spec: TableSpec) => Table | Promise<Table>

export interface TableCase {
  readonly name: string
  run(make: TableFactory): Promise<void>
}

class ConformanceFailure extends Error {}

function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual, (_, v: unknown) => (v instanceof Uint8Array ? [...v] : typeof v === 'bigint' ? `${v}n` : v))
  const e = JSON.stringify(expected, (_, v: unknown) => (v instanceof Uint8Array ? [...v] : typeof v === 'bigint' ? `${v}n` : v))
  if (a !== e) throw new ConformanceFailure(`${message}: expected ${e}, got ${a}`)
}

function throwsCode(fn: () => unknown, code: string, message: string, mentions?: string): void {
  try {
    fn()
  } catch (err) {
    if (err instanceof MyjsError && err.code === code && (mentions === undefined || err.message.includes(`'${mentions}'`))) return
    throw new ConformanceFailure(`${message}: threw ${String(err)} rather than ${code}${mentions === undefined ? '' : ` naming '${mentions}'`}`)
  }
  throw new ConformanceFailure(`${message}: did not throw ${code}`)
}

const utf8 = new TextEncoder()
const text = new TextDecoder()
const i32 = (n: number): Uint8Array => encodeInt(BigInt(n), 4, false)
const s = (v: string | null): Uint8Array | null => (v === null ? null : utf8.encode(v))
const str = (v: Uint8Array | null | undefined): string | null => (v === null || v === undefined ? null : text.decode(v))
const num = (v: Uint8Array | null | undefined): number | null => (v === null || v === undefined ? null : Number(new DataView(v.buffer, v.byteOffset, 4).getUint32(0) ^ 0x80000000) | 0)

const int = (name: string, nullable = false, more: Partial<ColumnDef> = {}): ColumnDef => ({ name, type: { type: FIELD_TYPE.LONG }, nullable, ...more })
/** `utf8mb4_0900_ai_ci`, MySQL's default: NO PAD, accent- and case-insensitive, expanding. */
const varchar = (name: string, length: number, nullable = true): ColumnDef => ({ name, type: { type: FIELD_TYPE.VAR_STRING, length, collationId: 255 }, nullable })
const char = (name: string, length: number): ColumnDef => ({ name, type: { type: FIELD_TYPE.STRING, length, collationId: 255 }, nullable: false })
const double = (name: string): ColumnDef => ({ name, type: { type: FIELD_TYPE.DOUBLE }, nullable: true })
const primary = (...columns: string[]): IndexDef => ({ name: 'PRIMARY', kind: 'primary', parts: columns.map((column) => ({ column })) })
const unique = (name: string, ...columns: string[]): IndexDef => ({ name, kind: 'unique', parts: columns.map((column) => ({ column })) })

/** The people table most cases use: an INT key, a text column with a UNIQUE index, a nullable INT with a plain one. */
const people: TableSpec = {
  name: 'people',
  columns: [int('id'), varchar('name', 20), int('age', true)],
  indexes: [primary('id'), unique('name', 'name'), { name: 'age', kind: 'index', parts: [{ column: 'age' }] }],
}

const person = (id: number, name: string | null, age: number | null) => [i32(id), s(name), age === null ? null : i32(age)]
const ids = (rows: Iterable<[Uint8Array, (Uint8Array | null)[]]>): (number | null)[] => [...rows].map(([, r]) => num(r[0]))

export const tableConformanceCases: readonly TableCase[] = [
  {
    name: 'rows come back as they went in, in clustered order',
    async run(make) {
      const t = await make(people)
      for (const [id, name, age] of [[3, 'c', 30], [1, 'a', null], [2, 'b', 20]] as const) t.insert(person(id, name, age))
      eq(ids(t.scan()), [1, 2, 3], 'clustered order')
      eq(ids(t.scan({ reverse: true })), [3, 2, 1], 'reversed')
      eq(t.get(i32(1)), person(1, 'a', null), 'a row by its id')
      eq(t.get(i32(9)), undefined, 'a missing id')
    },
  },
  {
    name: 'a row id is the clustered key, and an update that changes it moves the row',
    async run(make) {
      const t = await make(people)
      const id = t.insert(person(1, 'a', 1))
      eq(t.get(id), person(1, 'a', 1), 'the returned id finds the row')
      const moved = t.update(id, person(5, 'a', 1))
      eq(moved !== undefined && t.get(moved), person(5, 'a', 1), 'found by its new id')
      eq(t.get(id), undefined, 'gone from its old one')
      eq(t.update(id, person(6, 'x', 1)), undefined, 'an update of a missing id')
      eq(t.delete(id), false, 'a delete of a missing id')
    },
  },
  {
    name: 'a duplicate is ER_DUP_ENTRY naming its index, and NULLs never collide',
    async run(make) {
      const t = await make(people)
      t.insert(person(1, 'Ann', null))
      throwsCode(() => t.insert(person(1, 'Bob', null)), 'ER_DUP_ENTRY', 'the same primary key', 'PRIMARY')
      // utf8mb4_0900_ai_ci: case and accents do not distinguish.
      throwsCode(() => t.insert(person(2, 'ÄNN', null)), 'ER_DUP_ENTRY', 'the same name under the collation', 'name')
      t.insert(person(2, null, null))
      t.insert(person(3, null, null))
      eq(ids(t.scan()), [1, 2, 3], 'NULL names coexist')
    },
  },
  {
    name: 'a refused row or update leaves nothing changed in any index',
    async run(make) {
      const t = await make(people)
      t.insert(person(1, 'a', 10))
      t.insert(person(2, 'b', 20))
      throwsCode(() => t.insert(person(3, 'a', 30)), 'ER_DUP_ENTRY', 'a second index refuses it', 'name')
      eq(ids(t.indexScan('age')), [1, 2], 'the first index has no trace of it')
      throwsCode(() => t.update(i32(2), person(2, 'a', 99)), 'ER_DUP_ENTRY', 'an update into a duplicate', 'name')
      eq(t.get(i32(2)), person(2, 'b', 20), 'the row is as it was')
      eq(ids(t.indexScan('age')), [1, 2], 'and so is every index')
      throwsCode(() => t.update(i32(2), person(1, 'b', 20)), 'ER_DUP_ENTRY', 'an update onto a taken key', 'PRIMARY')
    },
  },
  {
    name: 'a delete removes the row from every index',
    async run(make) {
      const t = await make(people)
      for (let i = 1; i <= 5; i++) t.insert(person(i, `n${i}`, i % 2))
      eq(t.delete(i32(3)), true, 'deleted')
      eq(ids(t.scan()), [1, 2, 4, 5], 'from the clustered index')
      eq(ids(t.indexScan('name')), [1, 2, 4, 5], 'from a unique one')
      eq(ids(t.indexScan('age')), [2, 4, 1, 5], 'from a plain one, in its order')
      t.insert(person(3, 'n3', 7))
      eq(ids(t.indexScan('age')), [2, 4, 1, 5, 3], 'and the key can be used again')
    },
  },
  {
    name: 'an index orders by its collation, then by the clustered key',
    async run(make) {
      const t = await make(people)
      const names = ['b', 'Straße', 'strasse ', 'a', 'Æon', 'z', 'ss', 'É', 'e ']
      for (const [i, n] of names.entries()) t.insert(person(i, n, 0))
      eq([...t.indexScan('name')].map(([, r]) => str(r[1])), ['a', 'Æon', 'b', 'É', 'e ', 'ss', 'Straße', 'strasse ', 'z'], 'utf8mb4_0900_ai_ci order')
      eq(ids(t.indexScan('age')), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'equal keys in clustered order')
    },
  },
  {
    name: 'a range is a prefix of the leading columns, each end inclusive or not',
    async run(make) {
      const t = await make({
        name: 'grid',
        columns: [int('x'), int('y'), int('v', true)],
        indexes: [primary('x', 'y'), { name: 'v', kind: 'index', parts: [{ column: 'v' }] }],
      })
      for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) t.insert([i32(x), i32(y), i32(x * 10 + y)])
      const vs = (r: KeyRange, index?: string) => [...(index === undefined ? t.scan(r) : t.indexScan(index, r))].map(([, row]) => num(row[2]))
      eq(vs({ from: { values: [i32(1)], inclusive: true }, to: { values: [i32(2)], inclusive: true } }), [10, 11, 12, 20, 21, 22], 'x in [1, 2]')
      eq(vs({ from: { values: [i32(1)], inclusive: false }, to: { values: [i32(3)], inclusive: false } }), [20, 21, 22], 'x in (1, 3)')
      eq(vs({ from: { values: [i32(1), i32(1)], inclusive: true }, to: { values: [i32(2), i32(0)], inclusive: true } }), [11, 12, 20], '(1,1) to (2,0)')
      eq(vs({ from: { values: [i32(2)], inclusive: true }, reverse: true }), [32, 31, 30, 22, 21, 20], 'x >= 2, reversed')
      eq(vs({ to: { values: [i32(0), i32(1)], inclusive: false } }), [0], 'below (0,1)')
      eq(vs({ from: { values: [i32(12)], inclusive: false }, to: { values: [i32(21)], inclusive: true } }, 'v'), [20, 21], 'a secondary range')
      eq(vs({ from: { values: [i32(5)], inclusive: true }, to: { values: [i32(4)], inclusive: true } }), [], 'an empty range')
    },
  },
  {
    name: 'a DESC part reverses its column, and ranges follow index order',
    async run(make) {
      const t = await make({
        name: 'desc',
        columns: [int('id'), int('a', true), varchar('b', 8)],
        indexes: [primary('id'), { name: 'ab', kind: 'index', parts: [{ column: 'a', descending: true }, { column: 'b' }] }],
      })
      const rows = [[1, 5, 'x'], [2, null, 'y'], [3, 7, 'b'], [4, 7, 'a'], [5, 1, 'z']] as const
      for (const [id, a, b] of rows) t.insert([i32(id), a === null ? null : i32(a), s(b)])
      eq(ids(t.indexScan('ab')), [4, 3, 1, 5, 2], 'a high to low, NULL last, then b ascending')
      eq(ids(t.indexScan('ab', { from: { values: [i32(7)], inclusive: false } })), [1, 5, 2], 'after a = 7 in index order')
    },
  },
  {
    name: 'FLOAT and DOUBLE keys order by number, and -0 is 0',
    async run(make) {
      const t = await make({ name: 'f', columns: [int('id'), double('d')], indexes: [primary('id'), unique('d', 'd')] })
      const values = [1.5, -Infinity, -2, 0, 1e-300, Infinity, -1e-300, 2]
      for (const [i, d] of values.entries()) t.insert([i32(i), encodeDouble(d)])
      eq([...t.indexScan('d')].map(([, r]) => new DataView((r[1] as Uint8Array).buffer).getFloat64(0, true)), [...values].sort((a, b) => a - b), 'numeric order')
      throwsCode(() => t.insert([i32(99), encodeDouble(-0)]), 'ER_DUP_ENTRY', '-0 is a duplicate of 0', 'd')
    },
  },
  {
    name: 'CHAR keys ignore trailing spaces, and a prefix index compares prefixes',
    async run(make) {
      const t = await make({
        name: 'c',
        columns: [int('id'), char('c', 4), varchar('v', 10)],
        indexes: [primary('id'), unique('c', 'c'), { name: 'v', kind: 'unique', parts: [{ column: 'v', prefix: 2 }] }],
      })
      t.insert([i32(1), s('a  '), s('abc')])
      throwsCode(() => t.insert([i32(2), s('a'), s('xyz')]), 'ER_DUP_ENTRY', "CHAR 'a' is 'a  '", 'c')
      throwsCode(() => t.insert([i32(2), s('b'), s('abd')]), 'ER_DUP_ENTRY', "'abd' shares the prefix 'ab'", 'v')
      t.insert([i32(2), s('a\t'), s('ax')])
      // Trimmed, 'a  ' is 'a', a prefix of 'a\t', so first; untrimmed, a tab
      // weighs less than a space and it would be second.
      eq(ids(t.indexScan('c')), [1, 2], "'a  ' keys as 'a', before 'a\\t'")
    },
  },
  {
    name: 'with no key to cluster by, rows keep the order they came in',
    async run(make) {
      const t = await make({ name: 'heap', columns: [int('v', true), varchar('w', 4)], indexes: [{ name: 'v', kind: 'index', parts: [{ column: 'v' }] }] })
      const id = [5, 3, 9, 1].map((v) => t.insert([i32(v), s('x')]))
      eq(ids(t.scan()), [5, 3, 9, 1], 'insertion order')
      eq(ids(t.indexScan('v')), [1, 3, 5, 9], 'an index still orders')
      eq(id.map((x) => [...x]), [1, 2, 3, 4].map((n) => [0, 0, 0, 0, 0, n]), 'six-byte row ids, from 1')
      t.update(id[1] as Uint8Array, [i32(4), s('y')])
      eq(t.get(id[1] as Uint8Array), [i32(4), s('y')], 'an update keeps its id')
    },
  },
  {
    name: 'a UNIQUE NOT NULL index clusters a table that has no primary key',
    async run(make) {
      const t = await make({ name: 'u', columns: [int('a', true), varchar('b', 8, false)], indexes: [unique('a', 'a'), unique('b', 'b')] })
      for (const [a, b] of [[1, 'z'], [2, 'y'], [3, 'x']] as const) t.insert([i32(a), s(b)])
      eq([...t.scan()].map(([, r]) => str(r[1])), ['x', 'y', 'z'], "clustered by 'b', the first all-NOT-NULL one")
      throwsCode(() => t.insert([i32(4), s('X')]), 'ER_DUP_ENTRY', 'its duplicates name it', 'b')
    },
  },
  {
    name: 'AUTO_INCREMENT values are handed out once, and an explicit value moves the counter',
    async run(make) {
      const t = await make({ name: 'a', columns: [int('id', false, { autoIncrement: true }), varchar('v', 4)], indexes: [primary('id')] })
      eq(t.nextAutoIncrement(), 1n, 'the first')
      eq(t.nextAutoIncrement(3), 2n, 'a block of three')
      t.insert([i32(50), s('x')])
      eq(t.nextAutoIncrement(), 51n, 'past an explicit value')
      t.insert([i32(10), s('y')])
      eq(t.nextAutoIncrement(), 52n, 'not back to a smaller one')
      throwsCode(() => t.insert([i32(10), s('z')]), 'ER_DUP_ENTRY', 'a duplicate explicit value')
    },
  },
]

export interface TableConformanceFailure {
  readonly name: string
  readonly error: unknown
}

/** Run every case; the failures, by name. */
export async function runTableConformance(make: TableFactory): Promise<TableConformanceFailure[]> {
  const failures: TableConformanceFailure[] = []
  for (const c of tableConformanceCases) {
    try {
      await c.run(make)
    } catch (error) {
      failures.push({ name: c.name, error })
    }
  }
  return failures
}
