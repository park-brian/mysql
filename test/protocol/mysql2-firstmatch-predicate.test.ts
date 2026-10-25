import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { NODE, parseExpression, parseStatement } from '@myjs/parser'
import { Session, capabilities } from '@myjs/protocol'
import { compile, type CompileContext, type Env, type SessionValues } from '../../packages/core/src/sql/compile.ts'
import { planFrom } from '../../packages/core/src/sql/from.ts'
import { statisticsOf } from '../../packages/core/src/sql/stats.ts'
import reference from './fixtures/firstmatch/predicates.json' with { type: 'json' }
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('FirstMatch omits only a physically implied integer bound; full-index LooseScan keeps its filter', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE filter126_live')
    await conn.query('USE filter126_live')
    assert.equal(reference.mysqlVersion, '8.4.11')
    for (const type of ['INT', 'INT UNSIGNED', 'BIGINT', 'BIGINT UNSIGNED']) for (const mode of ['range', 'loose-full']) {
      await conn.query('DROP TABLE IF EXISTS pa,ch')
      await conn.query('CREATE TABLE pa(id INT NOT NULL,g ' + type + ',s VARCHAR(12)' + (mode === 'range' ? ',KEY(g)' : '') + ') STATS_AUTO_RECALC=0')
      await conn.query('CREATE TABLE ch(id INT PRIMARY KEY,g ' + type + ',KEY(g)) STATS_AUTO_RECALC=0')
      const base = type.startsWith('BIGINT') ? 9007199254740992n : 0n
      const outer = mode === 'range' ? 4 : 20
      await conn.query('INSERT INTO pa VALUES' + Array.from({ length: outer }, (_, i) => '(' + (i + 1) + ',' + (i % 4 === 0 ? 'NULL' : base + BigInt(i % 4)) + ",'same')").join(','))
      const values = mode === 'range' ? [[1, base + 1n], [2, base + 2n]] : Array.from({ length: 100 }, (_, i) => [i + 1, i < 50 ? base : base + 2n])
      await conn.query('INSERT INTO ch VALUES' + values.map(([id, g]) => '(' + id + ',' + g + ')').join(','))
      await conn.query('ANALYZE TABLE pa,ch')
      for (const sample of reference.cases.filter((c) => c.type === type && c.mode === mode)) {
        await conn.query('SET optimizer_switch=' + mysql.escape(sample.switches))
        const sql = 'SELECT id,g,s FROM pa WHERE EXISTS(SELECT 1 FROM ch WHERE pa.g=ch.g AND ' + (mode === 'range' ? 'ch.g>' + (base + 1n) : 'ch.id>98') + ')' + sample.suffix
        for (const method of ['query', 'execute'] as const) {
          const options = { sql, rowsAsArray: true }
          const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, sample.rows, method + ': ' + sql)
          assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), sample.fields, method + ': ' + sql)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], sample.warnings, method + ': ' + sql)
          const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
          assert.equal(planSkeleton(explain[0]?.EXPLAIN), sample.plan, method + ': ' + sql)
          conn.unprepare(options)
        }
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS filter126_live')
    await conn.end(); await db?.end()
  }
})

test('physical FirstMatch proof skips evaluations and declines points, other columns, types and forced scans', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE filter126')
    const repeated = [3, 7, 11, 15, 19]
    for (const [mode, where, expected, ids] of [
      ['range', 'ch.g>1', 0, [3]],
      ['forced-scan', 'ch.g>1', 2, [3]],
      ['point-bypass', 'pa.g=1 AND ch.g>1', 1, []],
      ['mixed-signed', 'pa.g>1 AND ch.g>1', 1, [3]],
      ['mixed-width', 'pa.g>1 AND ch.g>1', 1, [3]],
      ['tiny-excluded', 'pa.g>1 AND ch.g>1', 1, [3]],
      ['multiple-bounds', 'ch.g>1 AND ch.g>0', 2, [3]],
      ['decimal-bound', 'pa.g>1 AND ch.g>1.5', 1, [3]],
      ['parameter-bound', 'pa.g>1 AND ch.g>?', 1, [3]],
      ['other-column', 'pa.h>1 AND ch.g>1', 2, [3]],
      ['self-alias', 'ch.g>1', 0, [3, 4]],
      ['self-alias-point', 'pa.g=1 AND ch.g>1', 1, []],
      ['loose', 'ch.g>1', 2, repeated],
      ['loose-id-bound', 'ch.g>1 AND ch.id>1', 2, repeated],
      ['loose-full', 'ch.id>98', 100, repeated],
    ] as const) {
      await db.query('DROP TABLE IF EXISTS filter126.pa,filter126.ch')
      const small = mode === 'tiny-excluded' ? 'TINYINT' : 'INT'
      const pa = mode === 'other-column' ? 'id INT NOT NULL,g INT,h INT,s VARCHAR(12),KEY(h)'
        : 'id INT NOT NULL,g ' + small + ',s VARCHAR(12)' + (mode === 'loose-full' ? '' : ',KEY(g)') + ',KEY(id)'
      await db.query('CREATE TABLE filter126.pa(' + pa + ') STATS_AUTO_RECALC=0')
      await db.query('CREATE TABLE filter126.ch(id INT PRIMARY KEY,g ' + (mode === 'mixed-width' ? 'BIGINT' : small) + (mode === 'mixed-signed' ? ' UNSIGNED' : '') + ',KEY(g)) STATS_AUTO_RECALC=0')
      const outer = mode.startsWith('loose') ? 20 : 4
      await db.query('INSERT INTO filter126.pa VALUES' + Array.from({ length: outer }, (_, i) => '(' + (i + 1) + ',' + (i % 4 === 0 ? 'NULL' : i % 4) + (mode === 'other-column' ? ',' + (i === 3 ? 0 : 2) : '') + ",'same')").join(','))
      await db.query(mode === 'loose-full' ? 'INSERT INTO filter126.ch VALUES' + Array.from({ length: 100 }, (_, i) => '(' + (i + 1) + ',' + (i < 50 ? 0 : 2) + ')').join(',') : 'INSERT INTO filter126.ch VALUES(1,1),(2,2),(3,2),(4,NULL)')
      await db.query('ANALYZE TABLE filter126.pa,filter126.ch')
      const session = new Session({ connectionId: 1, capabilities: capabilities(0) })
      const state: SessionValues = {
        userVariables: new Map(), lastInsertId: 0n, insertIdSet: false, rowCount: 0n,
        systemVariable: (name) => name === 'optimizer_switch' ? { kind: 'string', v: 'materialization=off' + (mode.startsWith('loose') ? '' : ',loosescan=off'), collationId: 255, coercibility: 4 } : undefined,
      }
      const env: Env = { params: mode === 'parameter-bound' ? [{ kind: 'int', v: 1n, unsigned: false }] : [], now: new Date(), session, state }
      const query = parseStatement('SELECT pa.g,pa.s FROM pa JOIN ' + (mode.startsWith('self-alias') ? 'pa AS ch' : 'ch') + ' ON pa.g=ch.g WHERE ' + where)
      if (query.kind !== 'query' || query.body.kind !== 'select') throw new Error('expected SELECT')
      let evaluations = 0
      const compiled = (e: Parameters<typeof compile>[0], scope: CompileContext['scope']) => {
        const c = compile(e, { scope, session, state, connectionCollation: 255, clause: 'on clause', serverVersion: '8.4.11' })
        if (e.kind !== NODE.BINARY || e.op !== '>' || e.left.kind !== NODE.COLUMN || e.left.parts[0] !== 'ch' || e.left.parts.at(-1) !== (mode === 'loose-full' ? 'id' : 'g')) return c
        return { ...c, eval(row: Parameters<typeof c.eval>[0], env: Env) { evaluations++; return c.eval(row, env) } }
      }
      const plan = planFrom(query.body.from!, {
        env,
        open: (ref) => ({ schema: 'filter126', def: db.catalog!.definition('filter126', ref.name), table: db.catalog!.table('filter126', ref.name) }),
        statistics: (def, table) => statisticsOf(def, table, db.store!),
        compileOn: compiled,
      }, query.body.where)
      plan.reads(new Map([['pa', new Set(mode === 'other-column' ? ['id', 'g', 'h', 's'] : ['id', 'g', 's'])], ['ch', new Set(mode.startsWith('loose-') ? ['g', 'id'] : ['g'])]]))
      if (mode !== 'loose-full') plan.sortedBy('pa', 1)
      plan.filter(query.body.where, (e) => compiled(e, plan.scope))
      const index = plan.tables[1]!.def!.indexes.find((i) => i.name === 'g')!
      assert.notEqual(plan.integerSemijoin('ch', index, compiled(parseExpression('ch.g'), plan.scope), query.body.where, true), undefined, mode)
      if (mode === 'forced-scan') plan.readInOrder('id', true, false, 'pa')
      const tree = plan.explain(env)
      evaluations = 0 // Range-estimation work is not predicate evaluation in the row loop.
      const rows = [...plan.rows(undefined, env, { locking: false, ids: mode === 'self-alias' })]
      if (mode === 'self-alias') for (const row of rows) assert.equal(row.ids?.filter((id) => id !== undefined).length, 2, 'self-join roles retain both physical identities')
      assert.equal(evaluations, expected, mode)
      assert.equal(rows.length, ids.length, mode)
      assert.deepEqual(rows.map((r) => r.row[0]?.kind === 'int' ? Number(r.row[0].v) : null), ids, mode)
      if (mode === 'loose-full') assert.equal(tree.label, 'Inner hash join', mode)
      else if (mode.startsWith('loose')) assert.equal(tree.label, 'Remove duplicate pa rows using temporary table', mode)
      else assert.equal(tree.label, 'Nested loop semijoin', mode)
      if (mode === 'range') assert.notEqual(tree.children[1]?.label, 'Filter')
      else if (mode === 'forced-scan' || mode === 'point-bypass') assert.equal(tree.children[1]?.label, 'Filter')
      else if (mode === 'loose-full') assert.equal(tree.children[1]?.children[0]?.children[0]?.label, 'Filter')
    }
  } finally { await db.end() }
})
