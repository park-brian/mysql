import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const tool = fileURLToPath(new URL('../../tools/test.mjs', import.meta.url))

function fixture(run: (root: string) => void, failure?: string) {
  const root = mkdtempSync(join(tmpdir(), 'myjs-tests-'))
  try {
    for (const suite of ['unit', 'format', 'protocol', 'crash']) {
      mkdirSync(join(root, 'test', suite, 'nested'), { recursive: true })
      writeFileSync(join(root, 'test', suite, 'nested', 'ordinary.test.ts'), `
        import { appendFileSync } from 'node:fs';
        import { test } from 'node:test';
        test('${suite}', () => {
          appendFileSync('executed', '${suite}\\n');
          ${failure === suite ? "throw new Error('ordinary failure')" : ''}
        });
      `)
      writeFileSync(join(root, 'test', suite, 'helper.ts'), "throw new Error('not a test')")
    }
    writeFileSync(join(root, 'test', 'protocol', 'mysql2-in-list.test.ts'), `
      import { appendFileSync, readFileSync } from 'node:fs';
      import { test } from 'node:test';
      import assert from 'node:assert/strict';
      test('in-list', () => {
        assert.ok(readFileSync('executed', 'utf8').includes('protocol\\n'));
        appendFileSync('executed', 'in-list\\n');
        ${failure === 'in-list' ? "throw new Error('in-list failure')" : ''}
      });
    `)
    writeFileSync(join(root, 'test', 'protocol', 'bulk-latency.test.ts'), `
      import { appendFileSync, readFileSync } from 'node:fs';
      import { test } from 'node:test';
      import assert from 'node:assert/strict';
      test('latency', () => {
        assert.ok(readFileSync('executed', 'utf8').includes('protocol\\n'));
        assert.ok(readFileSync('executed', 'utf8').endsWith('in-list\\n'));
        appendFileSync('executed', 'latency\\n');
        ${failure === 'latency' ? "throw new Error('latency failure')" : ''}
      });
    `)
    run(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('test runner discovers every test once and isolates IN-list and bulk latency after ordinary files', () => {
  for (const protocol of [false, true]) fixture((root) => {
    const result = spawnSync(process.execPath, [tool, ...(protocol ? ['protocol'] : [])], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const executed = readFileSync(join(root, 'executed'), 'utf8').trim().split('\n')
    assert.deepEqual(executed.slice(-2), ['in-list', 'latency'])
    assert.deepEqual(executed.toSorted(), (protocol ? ['protocol', 'in-list', 'latency'] : ['unit', 'format', 'protocol', 'crash', 'in-list', 'latency']).sort())
  })
})

test('ordinary test failure fails the runner before latency starts', () => {
  fixture((root) => {
    const result = spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /ordinary failure/)
    assert.doesNotMatch(readFileSync(join(root, 'executed'), 'utf8'), /in-list|latency/)
  }, 'unit')
})

test('latency test failure fails the runner after ordinary tests finish', () => {
  fixture((root) => {
    const result = spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /latency failure/)
    assert.equal(readFileSync(join(root, 'executed'), 'utf8').trim().split('\n').length, 6)
  }, 'latency')
})

test('IN-list test failure fails the runner before bulk latency starts', () => {
  fixture((root) => {
    const result = spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /in-list failure/)
    const executed = readFileSync(join(root, 'executed'), 'utf8').trim().split('\n')
    assert.equal(executed.length, 5)
    assert.equal(executed.at(-1), 'in-list')
    assert.ok(!executed.includes('latency'))
  }, 'in-list')
})
