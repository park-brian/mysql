// `npm run bench`: the executor's speed on a fixed set of workloads, in-process
// through `db.query()`, so a change that should make one faster can say by
// how much (M5.46). Each workload is built fresh, warmed once, then timed as
// the best of `--runs` (default 5); the best, not the mean, because what is
// being measured is the code, and a slower run is the machine.
//
// Not a CI gate: timings are the machine's. The change log records the
// figures a commit moves, before and after, on one machine.
//
//   node tools/bench.mjs [--runs 5] [--only join]
import { MySQL } from '@myjs/core'
import { arg } from './lib/cli.mjs'

const runs = Number(arg('runs', '5'))
const only = arg('only', '')

/** Rows of the two joined tables, and of the larger single tables. */
const N = 2_000
const BIG = 20_000

async function setup(db) {
  await db.query('CREATE DATABASE b')
  await db.query('USE b')
  await db.query('CREATE TABLE p (id INT PRIMARY KEY, g INT, name VARCHAR(20), KEY (g))')
  await db.query('CREATE TABLE c (id INT PRIMARY KEY, p_id INT, qty INT, label VARCHAR(20), KEY (p_id))')
  await db.query('CREATE TABLE big (id INT PRIMARY KEY, k INT, s VARCHAR(20), d DOUBLE)')
  const insert = async (table, rows) => {
    for (let i = 0; i < rows.length; i += 1000) await db.query(`INSERT INTO ${table} VALUES ${rows.slice(i, i + 1000).join(', ')}`)
  }
  await insert('p', Array.from({ length: N }, (_, i) => `(${i + 1}, ${i % 50}, 'name${(i * 7919) % N}')`))
  await insert('c', Array.from({ length: N }, (_, i) => `(${i + 1}, ${((i * 31) % N) + 1}, ${i % 13}, 'label${i % 97}')`))
  await insert('big', Array.from({ length: BIG }, (_, i) => `(${i + 1}, ${(i * 7) % 1000}, 's${(i * 104729) % BIG}', ${i / 3})`))
}

/** Each workload: one call of `run` is one timed unit. */
const WORKLOADS = [
  { name: 'point select x1000', run: async (db) => { for (let i = 1; i <= 1000; i++) await db.query('SELECT name FROM p WHERE id = ?', [i]) } },
  { name: 'range scan', run: (db) => db.query('SELECT id, s FROM big WHERE id BETWEEN 1000 AND 15000') },
  { name: 'hash join 2k x 2k', run: (db) => db.query('SELECT COUNT(*) FROM c JOIN p ON p.g = c.qty') },
  { name: 'left hash join 2k x 2k', run: (db) => db.query('SELECT COUNT(p.id) FROM c LEFT JOIN p ON p.g = c.p_id') },
  { name: 'eq_ref join 2k', run: (db) => db.query('SELECT p.name, c.label FROM c JOIN p ON p.id = c.p_id') },
  { name: 'group by 20k', run: (db) => db.query('SELECT k, COUNT(*), SUM(d) FROM big GROUP BY k') },
  { name: 'order by limit 10 of 20k', run: (db) => db.query('SELECT id, s FROM big ORDER BY s LIMIT 10') },
  { name: 'order by 20k strings', run: (db) => db.query('SELECT id FROM big ORDER BY s') },
  { name: 'correlated subquery 2k', run: (db) => db.query('SELECT p.id, (SELECT COUNT(*) FROM c WHERE c.p_id = p.id) FROM p') },
  { name: 'IN subquery 20k', run: (db) => db.query('SELECT COUNT(*) FROM big WHERE k IN (SELECT qty FROM c)') },
  { name: 'LIKE 20k', run: (db) => db.query("SELECT COUNT(*) FROM big WHERE s LIKE '%99%'") },
  {
    name: 'insert 5k rows',
    run: async (db) => {
      await db.query('DROP TABLE IF EXISTS ins')
      await db.query('CREATE TABLE ins (id INT PRIMARY KEY, v VARCHAR(20))')
      await db.query(`INSERT INTO ins VALUES ${Array.from({ length: 5000 }, (_, i) => `(${i + 1}, 'v${i}')`).join(', ')}`)
    },
  },
]

const db = await MySQL.open(':memory:')
await setup(db)
console.log(`bench: best of ${runs}, ms`)
for (const w of WORKLOADS) {
  if (only !== '' && !w.name.includes(only)) continue
  await w.run(db)
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await w.run(db)
    best = Math.min(best, performance.now() - t)
  }
  console.log(`  ${w.name.padEnd(28)} ${best.toFixed(1).padStart(9)}`)
}
await db.end()
