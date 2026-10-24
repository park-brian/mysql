import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MYSQL_REFERENCE, MYSQL_VERSION, MYSQL_IMAGE, assertMysqlVersion, assertMysqltestFiles } from '../../tools/lib/mysql-reference.mjs'

test('the binary, package and Docker reference pins describe MySQL 8.4.11', () => {
  assert.equal(MYSQL_VERSION, '8.4.11')
  assert.match(MYSQL_IMAGE, /^mysql:8\.4\.11@sha256:[0-9a-f]{64}$/)
  assert.equal(MYSQL_REFERENCE.revision, '8.4.11-1ubuntu24.04')
  const names = new Set<string>()
  for (const pkg of MYSQL_REFERENCE.packages) {
    assert.ok(!names.has(pkg.name), pkg.name)
    names.add(pkg.name)
    assert.ok(pkg.filename.includes(`${MYSQL_REFERENCE.revision}_amd64.deb`), pkg.filename)
    assert.equal(pkg.url, `https://repo.mysql.com/apt/ubuntu/pool/mysql-8.4-lts/m/mysql-community/${pkg.filename}`)
    assert.match(pkg.sha256, /^[0-9a-f]{64}$/)
  }
  for (const name of ['mysql-common', 'mysql-community-server', 'mysql-community-server-core', 'mysql-community-client', 'mysql-community-client-core', 'mysql-community-client-plugins', 'mysql-community-test']) assert.ok(names.has(name), name)
})

test('reference versions accept the actual server and client version output', () => {
  for (const binary of ['mysqltest', 'mysql', 'mysqld']) {
    assert.equal(assertMysqlVersion(`${binary}  Ver 8.4.11 for Linux on x86_64 (MySQL Community Server - GPL)`, binary), MYSQL_VERSION)
  }
})

test('reference versions refuse a moving apt release and malformed output', () => {
  for (const version of ['8.4.13', '8.4.110', '8.0.46', 'unknown']) {
    assert.throws(() => assertMysqlVersion(`mysqltest Ver ${version}`, 'mysqltest'), /Expected mysqltest 8\.4\.11/)
  }
})

test('mysqltest cohorts compare identities, independently of order', () => {
  assert.doesNotThrow(() => assertMysqltestFiles(['beta', 'alpha'], ['alpha', 'beta']))
})

test('mysqltest refuses extra, missing and substituted files before a run is recorded', () => {
  const recorded = ['alpha', 'beta']
  for (const files of [['alpha'], ['alpha', 'beta', 'new_upstream_file'], ['alpha', 'other'], ['alpha', 'alpha']]) {
    assert.throws(() => assertMysqltestFiles(files, recorded), /suite differs from the recorded 8\.4\.11 baseline/)
  }
})
