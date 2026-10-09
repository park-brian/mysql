#!/usr/bin/env node
// M5.41 / D-79 — every package as npm would install it, and the proof that it
// installs.
//
// The repository is source-first (D-01): each package exports its
// `src/*.ts`, and Node strips the types as it loads them. Node refuses to
// strip types inside `node_modules`, so a tarball of that source fails on
// its first import. This stages each package as JavaScript and declarations
// that `tsc` emits, under a `package.json` whose `exports` and `imports` name
// them, and packs it:
//
//   node tools/pack.mjs            # .pack/<package>/ staged, .pack/tarballs/*.tgz packed
//   node tools/pack.mjs --smoke    # and then installed into an empty project and run there
//
// The smoke test is what a user does: install `myjs` and `mysql2` from the
// tarballs, open a directory database, query it through `db.query()`,
// through `mysql2` over `createStream()` and over TCP from `myjs/server`,
// reopen it, and typecheck doc 42's typed example against the installed
// declarations. Nothing is published from here; `npm publish` of each staged
// directory, leaves first, is a person's decision.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, '.pack')
const REPOSITORY = 'https://github.com/park-brian/mysql'
/** Leaves first: the order they publish in, so each one's dependencies are already there. */
const ORDER = ['bytes', 'vfs', 'charsets', 'protocol', 'types', 'parser', 'engine', 'core', 'server', 'myjs']

const fail = (message) => {
  console.error(`pack: ${message}`)
  process.exit(1)
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

const packages = readdirSync(join(ROOT, 'packages')).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
for (const p of packages) if (!ORDER.includes(p)) fail(`packages/${p} has no place in the publish order`)

// --- emit ----------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const build = join(OUT, 'build')
mkdirSync(join(OUT, 'tarballs'))
writeFileSync(
  join(OUT, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: join(ROOT, 'tsconfig.base.json'),
      compilerOptions: { noEmit: false, declaration: true, outDir: build, rootDir: join(ROOT, 'packages'), typeRoots: [join(ROOT, 'node_modules/@types')] },
      include: [join(ROOT, 'packages/*/src/**/*.ts')],
    },
    null,
    2,
  ),
)
run(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(OUT, 'tsconfig.json')], ROOT)

// --- stage ---------------------------------------------------------------------

/** `./src/x.ts` as the emitted files: declarations for the checker, JavaScript for everyone else. */
function emitted(target) {
  if (typeof target === 'string') {
    if (!target.startsWith('./src/') || !target.endsWith('.ts')) fail(`an export that is not a source file: ${target}`)
    const base = `./dist/${target.slice('./src/'.length, -'.ts'.length)}`
    return { types: `${base}.d.ts`, default: `${base}.js` }
  }
  return Object.fromEntries(Object.entries(target).map(([condition, t]) => [condition, emitted(t)]))
}

const versions = new Map(packages.map((p) => [JSON.parse(readFileSync(join(ROOT, 'packages', p, 'package.json'), 'utf8')).name, JSON.parse(readFileSync(join(ROOT, 'packages', p, 'package.json'), 'utf8')).version]))
const tarballs = []
for (const p of packages) {
  const source = JSON.parse(readFileSync(join(ROOT, 'packages', p, 'package.json'), 'utf8'))
  const dir = join(OUT, p)
  cpSync(join(build, p, 'src'), join(dir, 'dist'), { recursive: true })
  for (const [dep, range] of Object.entries(source.dependencies ?? {})) {
    if (versions.has(dep) && versions.get(dep) !== range) fail(`${source.name} depends on ${dep}@${range}, which is at ${versions.get(dep)}`)
  }
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    type: 'module',
    license: source.license,
    repository: { type: 'git', url: `git+${REPOSITORY}.git`, directory: `packages/${p}` },
    homepage: `${REPOSITORY}#readme`,
    bugs: `${REPOSITORY}/issues`,
    engines: source.engines,
    exports: emitted(source.exports),
    ...(source.imports === undefined ? {} : { imports: emitted(source.imports) }),
    files: ['dist', 'LICENSE', 'README.md'],
    ...(source.dependencies === undefined ? {} : { dependencies: source.dependencies }),
    ...(source.name.startsWith('@') ? { publishConfig: { access: 'public' } } : {}),
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'))
  if (p === 'myjs') cpSync(join(ROOT, 'README.md'), join(dir, 'README.md'))
  else writeFileSync(join(dir, 'README.md'), `# ${source.name}\n\n${source.description}.\n\nPart of [myjs](${REPOSITORY}), an in-process MySQL for JavaScript. Most applications want the \`myjs\` package itself.\n`)
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', join(OUT, 'tarballs')], dir))[0]
  const source_ = packed.files.map((f) => f.path).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  if (source_.length > 0) fail(`${source.name} packs TypeScript source, which Node will not run from node_modules: ${source_.slice(0, 3).join(', ')}`)
  tarballs.push(join(OUT, 'tarballs', packed.filename))
  console.log(`${source.name}@${source.version}  ${packed.files.length} files, ${(packed.size / 1024).toFixed(0)} KB packed`)
}

if (!process.argv.includes('--smoke')) process.exit(0)

// --- smoke ---------------------------------------------------------------------

const SMOKE = `import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { MySQL } from 'myjs'
import { serve } from 'myjs/server'

const dir = mkdtempSync(join(tmpdir(), 'myjs-smoke-db-'))
try {
  const db = await MySQL.open(dir)
  await db.query('CREATE DATABASE app')
  await db.query('CREATE TABLE app.users (id INT PRIMARY KEY, name VARCHAR(20))')
  await db.execute('INSERT INTO app.users VALUES (?, ?)', [1, 'ann'])
  const [rows] = await db.execute('SELECT name FROM app.users WHERE id = ?', [1])
  assert.deepEqual(rows, [{ name: 'ann' }])

  const viaStream = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  assert.deepEqual((await viaStream.query('SELECT COUNT(*) AS n FROM app.users'))[0], [{ n: 1 }])
  await viaStream.end()

  const server = await serve(db, { port: 0 })
  const viaTcp = await mysql.createConnection({ host: '127.0.0.1', port: server.port, user: 'root', password: '' })
  await viaTcp.query("INSERT INTO app.users VALUES (2, 'bob')")
  await viaTcp.end()
  await server.close()
  await db.end()

  const again = await MySQL.open(dir)
  assert.deepEqual((await again.query('SELECT name FROM app.users ORDER BY id'))[0], [{ name: 'ann' }, { name: 'bob' }])
  await again.end()
  console.log('smoke: myjs installs, opens a directory, and answers db.query(), mysql2 over createStream() and over TCP')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
`

const TYPED = `import type { Duplex } from 'node:stream'
import { MySQL } from 'myjs'

const db = await MySQL.open(':memory:')
interface User { id: number; name: string; email: string }
const [rows] = await db.execute<User[]>(
  'SELECT * FROM users WHERE id = ?', [1])
const email: string | undefined = rows[0]?.email
const stream: Duplex = db.createStream()
void email
void stream
`

const rootVersion = (name) => JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
const project = mkdtempSync(join(tmpdir(), 'myjs-smoke-'))
try {
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'myjs-smoke', private: true, type: 'module' }, null, 2)}\n`)
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs, `mysql2@${rootVersion('mysql2')}`, `typescript@${rootVersion('typescript')}`, `@types/node@${rootVersion('@types/node')}`], project)
  writeFileSync(join(project, 'smoke.mjs'), SMOKE)
  writeFileSync(join(project, 'smoke.ts'), TYPED)
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'es2023', module: 'nodenext', moduleResolution: 'nodenext', strict: true, noEmit: true, types: ['node'] }, files: ['smoke.ts'] }, null, 2))
  process.stdout.write(run(process.execPath, ['smoke.mjs'], project))
  run(process.execPath, [join(project, 'node_modules/typescript/bin/tsc'), '-p', project], project)
  console.log('smoke: doc 42\'s typed example checks against the installed declarations')
} finally {
  rmSync(project, { recursive: true, force: true })
}
