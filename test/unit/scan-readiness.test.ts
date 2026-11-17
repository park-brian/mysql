import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyRange, Table, Trx } from '@myjs/engine'
import { accessRows, limit } from '../../packages/core/src/sql/operators.ts'

const id = new Uint8Array([1])

test('scan construction failure precedes readiness; deferred read failure follows it', () => {
  const events: string[] = []
  const failure = new Error('reader construction failed')
  const construction = { def: { columns: [] }, scan: () => { events.push('construct'); throw failure } } as unknown as Table
  assert.throws(() => accessRows(construction, {}, undefined, false, () => events.push('ready')).next(), (error) => error === failure)
  assert.deepEqual(events, ['construct'])

  events.length = 0
  function* reader(): ReturnType<Table['scan']> {
    try { events.push('read'); throw failure }
    finally { events.push('close') }
  }
  const deferred = { def: { columns: [] }, scan: () => { events.push('construct'); return reader() } } as unknown as Table
  assert.throws(() => accessRows(deferred, {}, undefined, false, () => events.push('ready')).next(), (error) => error === failure)
  assert.deepEqual(events, ['construct', 'ready', 'read', 'close'])
})

test('LIMIT 0 constructs no reader; LIMIT and abandonment close a partially read reader', () => {
  const events: string[] = []
  function* reader(): ReturnType<Table['scan']> {
    try {
      events.push('read 1')
      yield [id, []]
      events.push('read 2')
      yield [id, []]
    } finally { events.push('close') }
  }
  const table = { def: { columns: [] }, scan: () => { events.push('construct'); return reader() } } as unknown as Table
  const open = () => accessRows(table, {}, undefined, false, () => events.push('ready'))
  assert.deepEqual([...limit(open(), 0, 0)], [])
  assert.deepEqual(events, [])
  assert.equal([...limit(open(), 0, 1)].length, 1)
  assert.deepEqual(events, ['construct', 'ready', 'read 1', 'close'])
  events.length = 0
  const rows = open()
  assert.equal(rows.next().done, false)
  rows.return(undefined)
  assert.deepEqual(events, ['construct', 'ready', 'read 1', 'close'])
})

test('an empty reader still reports readiness before its first read', () => {
  const events: string[] = []
  function* reader(): ReturnType<Table['scan']> { events.push('read') }
  const table = { def: { columns: [] }, scan: () => { events.push('construct'); return reader() } } as unknown as Table
  assert.deepEqual([...accessRows(table, {}, undefined, false, () => events.push('ready'))], [])
  assert.deepEqual(events, ['construct', 'ready', 'read'])
})

test('indexed reader construction keeps the invocation range, transaction and read mode', () => {
  const trx = {} as Trx
  const range: KeyRange = { reverse: true }
  const events: string[] = []
  const table = {
    def: { columns: [] },
    indexScan(index: string, gotRange: KeyRange, gotTrx: Trx, mode: string) {
      assert.equal(index, 'PRIMARY')
      assert.deepEqual(gotRange, range)
      assert.equal(gotTrx, trx)
      assert.equal(mode, 'current')
      events.push('construct')
      return (function* (): ReturnType<Table['scan']> { events.push('read'); yield [id, []] })()
    },
  } as unknown as Table
  assert.equal([...accessRows(table, { index: 'PRIMARY', reverse: true }, trx, true, () => events.push('ready'))].length, 1)
  assert.deepEqual(events, ['construct', 'ready', 'read'])
})

test('ranged access retains reverse range order without claiming whole-reader readiness', () => {
  const first: KeyRange = { from: { values: [new Uint8Array([1])], inclusive: true } }
  const second: KeyRange = { from: { values: [new Uint8Array([2])], inclusive: true } }
  const events: unknown[] = []
  const table = {
    def: { columns: [] },
    indexScan(index: string, range: KeyRange, trx: Trx | undefined, mode: string | undefined) {
      assert.equal(index, 'k')
      assert.equal(trx, undefined)
      assert.equal(mode, undefined)
      events.push(range)
      return (function* (): ReturnType<Table['scan']> {
        try { yield [id, []] } finally { events.push('close') }
      })()
    },
  } as unknown as Table
  const access = { index: 'k', ranges: [first, second], reverse: true }
  assert.equal([...accessRows(table, access, undefined, false, () => assert.fail('ranged reader is not admitted'))].length, 2)
  assert.deepEqual(events, [{ ...second, reverse: true }, 'close', { ...first, reverse: true }, 'close'])
  assert.deepEqual(access.ranges, [first, second])
})

test('an ordered union closes the active scan on return without opening the second one', () => {
  const trx = {} as Trx
  const boundary = Uint8Array.of(4)
  const bound = { values: [boundary], inclusive: true }
  const secondary = { from: bound, to: bound }
  for (const primaryUpper of [true, false]) {
    const primary = primaryUpper ? { to: bound } : { from: bound }
    const events: string[] = []
    const table = {
      def: { columns: [] },
      *indexScan(index: string, range: KeyRange, gotTrx: Trx | undefined, mode: string | undefined): ReturnType<Table['indexScan']> {
        assert.equal(gotTrx, trx)
        assert.equal(mode, undefined)
        assert.equal(range, index === 'PRIMARY' ? primary : secondary)
        events.push('open ' + index)
        try {
          const ids = index === 'PRIMARY' ? (primaryUpper ? [1, 2, 3] : [6, 7]) : [1, 3, 6]
          for (const n of ids) yield [Uint8Array.of(n), []]
        } finally { events.push('close ' + index) }
      },
    } as unknown as Table
    const access = { index: 'PRIMARY', ranges: [primary], indexUnion: {
      index: 'by_g', range: secondary, over: '(g = 4)', bound: boundary, ordered: true, primaryFirst: true,
    } }
    const rows = accessRows(table, access, trx)
    const first = primaryUpper ? 'PRIMARY' : 'by_g'
    assert.deepEqual(rows.next().value?.id, Uint8Array.of(1))
    assert.deepEqual(events, ['open ' + first])
    rows.return(undefined)
    assert.deepEqual(events, ['open ' + first, 'close ' + first])
    assert.deepEqual([...accessRows(table, access, trx)].map(({ id }) => id[0]), primaryUpper ? [1, 2, 3, 6] : [1, 3, 6, 7])
  }
})
