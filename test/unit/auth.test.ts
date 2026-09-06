// M1.10–M1.15 — authentication.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer } from '@myjs/bytes'
import {
  MapAccountStore,
  ServerAuthenticator,
  Sha2Cache,
  FailureLimiter,
  SHA2,
  nativeScramble,
  sha2Scramble,
  verifyNative,
  verifySha2Scramble,
  makeAccount,
  parseAuthSwitchRequest,
  parseAuthMoreData,
  parseAuthNextFactor,
  writeAuthNextFactor,
  writeAuthSwitchRequest,
  generateRsaKeyPair,
  importPublicKeyPem,
  rsaEncrypt,
  xorRotating,
  utf8,
  concat,
  CACHING_SHA2_PASSWORD,
  MYSQL_NATIVE_PASSWORD,
  SCRAMBLE_LENGTH,
  type HandshakeResponse41,
  type RsaKeyPair,
  type AuthStep,
} from '@myjs/protocol'

const NONCE = new Uint8Array(SCRAMBLE_LENGTH).map((_, i) => (i * 11 + 3) & 0xff)

/** Narrow an AuthStep to the packets it wants sent; a failure sends none. */
function sent(step: AuthStep): readonly Uint8Array[] {
  assert.notEqual(step.status, 'failure', 'expected packets, got a failure')
  return step.status === 'failure' ? [] : step.send
}

function response(over: Partial<HandshakeResponse41> = {}): HandshakeResponse41 {
  return {
    kind: 'handshake-response',
    capabilities: 0,
    maxPacketSize: 1 << 24,
    characterSet: 45,
    username: 'alice',
    authResponse: new Uint8Array(0),
    database: null,
    clientPluginName: CACHING_SHA2_PASSWORD,
    connectAttrs: new Map(),
    zstdLevel: null,
    ...over,
  }
}

async function store(user = 'alice', password = 's3cret', plugin?: 'caching_sha2_password' | 'mysql_native_password') {
  const s = new MapAccountStore()
  await s.add(user, password, plugin)
  return s
}

// --- M1.10: auth framing -------------------------------------------------

test('AuthSwitchRequest round-trips', () => {
  const w = new Writer()
  writeAuthSwitchRequest(w, CACHING_SHA2_PASSWORD, concat([NONCE, new Uint8Array([0])]))
  const parsed = parseAuthSwitchRequest(w.view())
  assert.equal(parsed.pluginName, CACHING_SHA2_PASSWORD)
  assert.equal(parsed.pluginData.length, 21)
})

test('a bare 0xFE is recognised as OldAuthSwitchRequest rather than hanging', () => {
  // D-11: mysql_old_password is never implemented, but recognising the packet
  // is what turns a hang into a clear error.
  const parsed = parseAuthSwitchRequest(new Uint8Array([0xfe]))
  assert.equal(parsed.pluginName, 'mysql_old_password')
})

test('AuthNextFactor is recognised, so a misconfigured MFA client gets an error not a hang', () => {
  const w = new Writer()
  writeAuthNextFactor(w, 'authentication_ldap_sasl', new Uint8Array([1, 2]))
  const parsed = parseAuthNextFactor(w.view())
  assert.equal(parsed.pluginName, 'authentication_ldap_sasl')
  assert.deepEqual([...parsed.pluginData], [1, 2])
})

// --- M1.11: mysql_native_password ---------------------------------------

test('the native scramble verifies against the stored SHA1(SHA1(password))', async () => {
  const account = await makeAccount('alice', 's3cret', MYSQL_NATIVE_PASSWORD)
  const scramble = await nativeScramble('s3cret', NONCE)
  assert.equal(scramble.length, 20)
  assert.equal(await verifyNative(account, NONCE, scramble), true)
  assert.equal(await verifyNative(account, NONCE, await nativeScramble('wrong', NONCE)), false)
})

test('an empty password produces a zero-length response, not a hash of ""', async () => {
  // Doc 13: both sides must special-case this.
  const empty = await makeAccount('bob', '', MYSQL_NATIVE_PASSWORD)
  const scramble = await nativeScramble('', NONCE)
  assert.equal(scramble.length, 0)
  assert.equal(await verifyNative(empty, NONCE, scramble), true)

  const withPassword = await makeAccount('alice', 's3cret', MYSQL_NATIVE_PASSWORD)
  assert.equal(
    await verifyNative(withPassword, NONCE, new Uint8Array(0)),
    false,
    'an empty response must not authenticate an account that has a password',
  )
})

test('the server switches a client that guessed the wrong plugin', async () => {
  const auth = new ServerAuthenticator({
    accounts: await store('alice', 's3cret', MYSQL_NATIVE_PASSWORD),
    scramble: NONCE,
    secureChannel: true,
  })
  const step = await auth.begin(response({ clientPluginName: CACHING_SHA2_PASSWORD }))
  assert.equal(step.status, 'continue')
  const switched = parseAuthSwitchRequest(sent(step)[0] as Uint8Array)
  assert.equal(switched.pluginName, MYSQL_NATIVE_PASSWORD)
  assert.equal(switched.pluginData.length, 21, 'the scramble plus its trailing NUL')

  const ok = await auth.next(await nativeScramble('s3cret', NONCE))
  assert.equal(ok.status, 'success')
})

// --- M1.12: caching_sha2_password fast path ------------------------------

test('the sha2 scramble verifies against the cached digest', async () => {
  const account = await makeAccount('alice', 's3cret')
  const scramble = await sha2Scramble('s3cret', NONCE)
  assert.equal(scramble.length, 32)
  assert.equal(await verifySha2Scramble(account, NONCE, scramble), true)
  assert.equal(await verifySha2Scramble(account, NONCE, await sha2Scramble('wrong', NONCE)), false)
})

test('0x03 is sent as its own packet BEFORE the OK', async () => {
  // M1.12's whole acceptance assertion. A client expecting OK immediately
  // would desync — the AuthMoreData packet has to be separate.
  const cache = new Sha2Cache()
  cache.add('alice')
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    cache,
  })
  const step = await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal(step.status, 'success')
  assert.equal(sent(step).length, 1, 'exactly one packet, and it is not the OK')
  const data = parseAuthMoreData(sent(step)[0] as Uint8Array)
  assert.deepEqual([...data], [SHA2.FAST_AUTH_SUCCESS])
  assert.equal(SHA2.FAST_AUTH_SUCCESS, 0x03)
})

test('a fresh, uncached account is sent 0x04 and takes the full path', async () => {
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    cache: new Sha2Cache(),
  })
  const step = await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal(step.status, 'continue')
  assert.deepEqual([...parseAuthMoreData(sent(step)[0] as Uint8Array)], [SHA2.PERFORM_FULL_AUTHENTICATION])
  assert.equal(SHA2.PERFORM_FULL_AUTHENTICATION, 0x04)
})

// --- M1.13: the secure-channel branch ------------------------------------

test('an in-process connection takes the secure branch and never touches RSA', async () => {
  // D-11: passing no RSA key at all proves the branch is not merely preferred
  // — it is never reached.
  const cache = new Sha2Cache()
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    rsa: null,
    cache,
  })
  const first = await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal(first.status, 'continue')

  // The client sends `password ‖ 0x00` in the clear inside the secure channel.
  const done = await auth.next(concat([utf8('s3cret'), new Uint8Array([0])]))
  assert.equal(done.status, 'success')
  assert.equal(cache.has('alice'), true, 'and the account is cached for next time')
})

test('the secure branch still rejects a wrong password', async () => {
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    rsa: null,
  })
  await auth.begin(response({ authResponse: await sha2Scramble('nope', NONCE) }))
  const done = await auth.next(concat([utf8('nope'), new Uint8Array([0])]))
  assert.equal(done.status, 'failure')
})

test('the second connection for a cached account takes the fast path', async () => {
  const cache = new Sha2Cache()
  const accounts = await store()
  const first = new ServerAuthenticator({ accounts, scramble: NONCE, secureChannel: true, cache })
  await first.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  await first.next(concat([utf8('s3cret'), new Uint8Array([0])]))

  const second = new ServerAuthenticator({ accounts, scramble: NONCE, secureChannel: true, cache })
  const step = await second.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal(step.status, 'success', 'one round trip now, not three')
})

// --- M1.14: the RSA branch -----------------------------------------------

let rsaPair: RsaKeyPair | null = null
async function rsa(): Promise<RsaKeyPair> {
  rsaPair ??= await generateRsaKeyPair(2048)
  return rsaPair
}

test('an insecure channel drives the full RSA exchange', async () => {
  const pair = await rsa()
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: false,
    rsa: pair,
    cache: new Sha2Cache(),
  })

  const askFull = await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal(askFull.status, 'continue')
  assert.deepEqual([...parseAuthMoreData(sent(askFull)[0] as Uint8Array)], [SHA2.PERFORM_FULL_AUTHENTICATION])

  // The client asks for the public key rather than being configured with it.
  const keyStep = await auth.next(new Uint8Array([SHA2.REQUEST_SERVER_KEY]))
  assert.equal(keyStep.status, 'continue')
  const pem = new TextDecoder().decode(parseAuthMoreData(sent(keyStep)[0] as Uint8Array))
  assert.match(pem, /BEGIN PUBLIC KEY/)

  // The client obscures the password with the nonce, then encrypts.
  const obscured = xorRotating(concat([utf8('s3cret'), new Uint8Array([0])]), NONCE)
  const ciphertext = await rsaEncrypt(await importPublicKeyPem(pem), obscured)
  const done = await auth.next(ciphertext)
  assert.equal(done.status, 'success')
  assert.deepEqual([...parseAuthMoreData(sent(done)[0] as Uint8Array)], [SHA2.FAST_AUTH_SUCCESS])
})

test('a wrong password over RSA fails without crashing', async () => {
  const pair = await rsa()
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: false,
    rsa: pair,
    cache: new Sha2Cache(),
  })
  await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  const keyStep = await auth.next(new Uint8Array([SHA2.REQUEST_SERVER_KEY]))
  const pem = new TextDecoder().decode(parseAuthMoreData(sent(keyStep)[0] as Uint8Array))
  const obscured = xorRotating(concat([utf8('wrong'), new Uint8Array([0])]), NONCE)
  const ciphertext = await rsaEncrypt(await importPublicKeyPem(pem), obscured)
  assert.equal((await auth.next(ciphertext)).status, 'failure')
})

test('undecryptable ciphertext is a failed login, not a thrown error', async () => {
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: false,
    rsa: await rsa(),
    cache: new Sha2Cache(),
  })
  await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  await auth.next(new Uint8Array([SHA2.REQUEST_SERVER_KEY]))
  assert.equal((await auth.next(new Uint8Array(256).fill(0x41))).status, 'failure')
})

test('with no key configured, an insecure full auth is refused rather than left hanging', async () => {
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: false,
    rsa: null,
    cache: new Sha2Cache(),
  })
  await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))
  assert.equal((await auth.next(new Uint8Array([SHA2.REQUEST_SERVER_KEY]))).status, 'failure')
})

// --- M1.15: uniform access denied ----------------------------------------

test('an unknown user and a wrong password are byte-identical', async () => {
  const cache = new Sha2Cache()
  cache.add('alice')

  const wrongPassword = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    cache,
  })
  const a = await wrongPassword.begin(response({ authResponse: await sha2Scramble('nope', NONCE) }))

  const unknownUser = new ServerAuthenticator({
    accounts: new MapAccountStore(), // alice does not exist at all
    scramble: NONCE,
    secureChannel: true,
    cache,
  })
  const b = await unknownUser.begin(response({ authResponse: await sha2Scramble('nope', NONCE) }))

  assert.equal(a.status, 'failure')
  assert.equal(b.status, 'failure')
  assert.deepEqual(a, b, 'errno, SQLSTATE and message must all match')
  assert.equal(a.status === 'failure' ? a.errno : 0, 1045)
  assert.equal(a.status === 'failure' ? a.sqlState : '', '28000')
})

test('an unknown user still walks the full state machine, so timing does not leak', async () => {
  // The observable proxy for "no early return": an unknown user on a cache
  // miss is asked for full authentication exactly as a real one is, rather
  // than being denied a round trip earlier.
  const auth = new ServerAuthenticator({
    accounts: new MapAccountStore(),
    scramble: NONCE,
    secureChannel: true,
    cache: new Sha2Cache(),
  })
  const step = await auth.begin(response({ username: 'ghost', authResponse: await sha2Scramble('x', NONCE) }))
  assert.equal(step.status, 'continue')
  assert.deepEqual([...parseAuthMoreData(sent(step)[0] as Uint8Array)], [SHA2.PERFORM_FULL_AUTHENTICATION])

  // And it still fails at the end, with the right password for no account.
  const done = await auth.next(concat([utf8('x'), new Uint8Array([0])]))
  assert.equal(done.status, 'failure')
})

test('the failure limiter delays, then blocks', async () => {
  let now = 0
  const slept: number[] = []
  const limiter = new FailureLimiter({
    maxFailures: 3,
    windowMs: 1000,
    delayStepMs: 10,
    now: () => now,
    sleep: async (ms) => void slept.push(ms),
  })

  const attempt = async () => {
    const auth = new ServerAuthenticator({
      accounts: await store(),
      scramble: NONCE,
      secureChannel: true,
      cache: (() => {
        const c = new Sha2Cache()
        c.add('alice')
        return c
      })(),
      limiter,
      clientHost: '10.0.0.1',
    })
    return auth.begin(response({ authResponse: await sha2Scramble('nope', NONCE) }))
  }

  assert.equal((await attempt()).status, 'failure')
  assert.equal(limiter.failureCount('10.0.0.1'), 1)
  assert.equal((await attempt()).status, 'failure')
  assert.deepEqual(slept, [10], 'the second attempt waits before it is answered')
  assert.equal((await attempt()).status, 'failure')
  assert.equal(limiter.isBlocked('10.0.0.1'), true)

  // Failures age out of the window.
  now += 2000
  assert.equal(limiter.isBlocked('10.0.0.1'), false)
})

test('a successful login clears the failure record', async () => {
  const limiter = new FailureLimiter({ sleep: async () => {} })
  limiter.recordFailure('10.0.0.2')
  assert.equal(limiter.failureCount('10.0.0.2'), 1)
  const cache = new Sha2Cache()
  cache.add('alice')
  const auth = new ServerAuthenticator({
    accounts: await store(),
    scramble: NONCE,
    secureChannel: true,
    cache,
    limiter,
    clientHost: '10.0.0.2',
  })
  assert.equal((await auth.begin(response({ authResponse: await sha2Scramble('s3cret', NONCE) }))).status, 'success')
  assert.equal(limiter.failureCount('10.0.0.2'), 0)
})
