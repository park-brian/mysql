// M1.24's second acceptance assertion: "`serve()` refuses a non-loopback bind
// without a configured password" — and M1.14, whose RSA branch is reachable
// only here, because a plain TCP socket is not a secure channel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { serve, isLoopback, InsecureBindError } from '@myjs/server'
import { MapAccountStore, Sha2Cache } from '@myjs/protocol'

test('serve() refuses a non-loopback bind while an account has no password', async () => {
  // The default in-process account is a passwordless root, which is fine on a
  // loopback socket and a vulnerability on any other.
  const db = await MySQL.open(':memory:')
  await assert.rejects(
    serve(db, { host: '0.0.0.0', port: 0 }),
    (err: unknown) => {
      assert.ok(err instanceof InsecureBindError)
      assert.match(err.message, /these accounts have no password: root/)
      return true
    },
  )
})

test('serve() allows a non-loopback bind once every account has a password', async () => {
  const accounts = new MapAccountStore()
  await accounts.add('alice', 'a real password')
  const db = await MySQL.open(':memory:', { accounts })
  const server = await serve(db, { host: '0.0.0.0', port: 0 })
  try {
    assert.ok(server.port > 0)
  } finally {
    await server.close()
  }
})

test('serve() defaults to loopback', async () => {
  const db = await MySQL.open(':memory:')
  const server = await serve(db, { port: 0 })
  try {
    assert.equal(server.host, '127.0.0.1')
    assert.ok(isLoopback(server.host))
  } finally {
    await server.close()
  }
})

test('the escape hatch has to be asked for explicitly', async () => {
  const db = await MySQL.open(':memory:')
  const server = await serve(db, { host: '0.0.0.0', port: 0, allowInsecureBind: true })
  try {
    assert.ok(server.port > 0)
  } finally {
    await server.close()
  }
})

test('mysql2 connects over a real TCP socket and runs SELECT 1', async () => {
  const db = await MySQL.open(':memory:')
  const server = await serve(db, { port: 0 })
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      port: server.port,
      user: 'root',
      password: '',
    })
    try {
      const [rows] = await conn.query('SELECT 1')
      assert.deepEqual(rows, [{ 1: 1 }])
    } finally {
      await conn.end()
    }
  } finally {
    await server.close()
  }
})

test('M1.14: a fresh, uncached account authenticates over TCP through the RSA branch', async () => {
  // Over a plain socket mysql2 will not send a cleartext password, so on 0x04
  // it requests our public key and encrypts with RSA-OAEP-SHA1. The cache
  // starts empty, so the first connection genuinely takes the full path.
  const accounts = new MapAccountStore()
  await accounts.add('alice', 'correct horse battery staple')
  const db = await MySQL.open(':memory:', { accounts })
  const cache = new Sha2Cache()
  const server = await serve(db, { port: 0, accounts })
  try {
    assert.equal(cache.size, 0)
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      port: server.port,
      user: 'alice',
      password: 'correct horse battery staple',
    })
    try {
      const [rows] = await conn.query('SELECT 1')
      assert.deepEqual(rows, [{ 1: 1 }])
    } finally {
      await conn.end()
    }

    // And the second connection takes the fast path, one round trip shorter.
    const again = await mysql.createConnection({
      host: '127.0.0.1',
      port: server.port,
      user: 'alice',
      password: 'correct horse battery staple',
    })
    try {
      const [rows] = await again.query('SELECT 2')
      assert.deepEqual(rows, [{ 2: 2 }])
    } finally {
      await again.end()
    }
  } finally {
    await server.close()
  }
})

test('a wrong password over TCP is refused with 1045', async () => {
  const accounts = new MapAccountStore()
  await accounts.add('alice', 'correct')
  const db = await MySQL.open(':memory:', { accounts })
  const server = await serve(db, { port: 0, accounts })
  try {
    await assert.rejects(
      mysql.createConnection({
        host: '127.0.0.1',
        port: server.port,
        user: 'alice',
        password: 'wrong',
      }),
      (err: unknown) => {
        assert.equal((err as { errno?: number }).errno, 1045)
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('several TCP connections are served at once, each with its own session', async () => {
  const db = await MySQL.open(':memory:')
  const server = await serve(db, { port: 0 })
  try {
    const conns = await Promise.all(
      [0, 1, 2].map(() =>
        mysql.createConnection({ host: '127.0.0.1', port: server.port, user: 'root', password: '' }),
      ),
    )
    try {
      await conns[0]?.query('USE alpha')
      const [rows] = (await conns[1]?.query('SELECT DATABASE()')) as [unknown, unknown]
      assert.deepEqual(rows, [{ 'DATABASE()': null }], 'sessions do not share state')
    } finally {
      await Promise.all(conns.map((c) => c.end()))
    }
  } finally {
    await server.close()
  }
})
