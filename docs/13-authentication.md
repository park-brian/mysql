# 13 — Authentication

> Sources: `sql/auth/sql_authentication.cc`
> (`@page page_protocol_connection_phase_authentication_methods`),
> `sql/auth/sha2_password.cc` (`@page page_caching_sha2_authentication_exchanges`,
> and the marker bytes at `sha2_password.cc:954`), cross-checked against
> `mysql2/lib/auth_41.js` and `mysql2/lib/auth_plugins/caching_sha2_password.js`.

Authentication is *pluggable*: the server names a plugin, the client runs the
matching client-side plugin, and the two exchange opaque blobs until one of them
declares success or failure. The framing is fixed; the contents are per-plugin.

## The framing packets

| Packet | Direction | Layout |
|---|---|---|
| **AuthSwitchRequest** | S→C | `0xFE`, `string<NUL>` plugin name, `string<EOF>` plugin data |
| **OldAuthSwitchRequest** | S→C | a single `0xFE` byte — means "switch to `mysql_old_password`" |
| **AuthSwitchResponse** | C→S | `string<EOF>` — raw plugin output, no header |
| **AuthMoreData** | S→C | `0x01`, `string<EOF>` plugin data |
| **AuthNextFactor** | S→C | `0x02`, `string<NUL>` plugin name, `string<EOF>` plugin data |

Note the header-byte overloading: `0xFE` as the first byte of a *connection
phase* packet is an auth switch, not an EOF; `0x01` is `AuthMoreData`, not a
length. Context, not byte value, decides.

The dialogue always terminates with `OK_Packet` or `ERR_Packet`.

## `mysql_native_password`

The legacy default (5.x through 8.0), deprecated in 8.0.34, off by default in
8.4, and **removed from the server entirely in MySQL 9.0**
(`sql/auth/sql_authentication.cc:274`) — but still what a lot of deployed
software expects, and still implemented by every client. Cheap and easy to
implement; safe only over TLS or in-process.

- Server stores `SHA1(SHA1(password))`.
- Server sends a 20-byte nonce (the scramble, split 8 + 12 in HandshakeV10).
- Client computes:

```
stage1  = SHA1(password)
stage2  = SHA1(stage1)                       # this is what the server stores
stage3  = SHA1(nonce || stage2)
response = XOR(stage1, stage3)               # 20 bytes
```

- Server verifies by recovering `stage1 = XOR(response, SHA1(nonce || stage2))`
  and checking `SHA1(stage1) == stage2`.
- **Empty password ⇒ empty response** (zero-length), not a hash of the empty
  string. Both sides must special-case this.

The server never learns the password, but the stored `stage2` is
password-equivalent for authentication — an attacker with the `mysql.user` table
can authenticate. This is why `caching_sha2_password` exists.

## `caching_sha2_password` — the default since MySQL 8.0.4

Two paths: a cheap cached path and an expensive full path.

Definitions from `sha2_password.cc`:

```
Nonce   = 20 random bytes (the handshake scramble)
Scramble = XOR( SHA256(password),
                SHA256( SHA256(SHA256(password)) || Nonce ) )
Cache entry: account -> SHA256(SHA256(password))
```

Note the asymmetry with `mysql_native_password`: the *inner* term hashes
`SHA256(SHA256(password))` concatenated with the nonce, and the XOR is against
`SHA256(password)`.

### Fast path (cache hit)

```
S→C  HandshakeV10 with 20-byte nonce, plugin = caching_sha2_password
C→S  HandshakeResponse41, auth_response = Scramble (32 bytes)
S→C  AuthMoreData [0x01] with payload 0x03   ← "fast_auth_success"
S→C  OK_Packet
```

The `0x03` marker is `fast_auth_success` (`sha2_password.cc:954`). It is a
separate packet *before* the OK — a client that expects OK immediately will
desynchronise.

### Full path (cache miss, or first ever connect)

```
S→C  AuthMoreData [0x01] with payload 0x04   ← "perform_full_authentication"
```

The client must now get the cleartext password to the server, and it will not do
that over an unprotected channel:

1. **If the connection is already secure** (TLS, a Unix socket, or shared
   memory), the client sends the password as `password || 0x00` in the clear
   inside that secure channel. Done.
2. **Otherwise**, RSA:
   - the client sends `0x02` (`REQUEST_SERVER_KEY`) — unless it was configured
     with the server's public key in advance, saving a round trip;
   - the server replies with `AuthMoreData` containing its RSA public key in
     PEM;
   - the client computes `XOR_rotating(password || 0x00, nonce)` and encrypts
     that with RSA using **OAEP padding with SHA-1** (`mysql2` sets
     `oaepHash: 'sha1'`, `RSA_PKCS1_OAEP_PADDING`), and sends the ciphertext;
   - the server decrypts, verifies, and caches `SHA256(SHA256(password))`.

The XOR is *rotating*: the nonce is 20 bytes and the password may be longer, so
the nonce repeats. `mysql2`'s `xorRotating` is the reference.

3. **Empty password** short-circuits: the client sends a zero-length response and
   the server accepts it only if the account's password is genuinely empty.

The server stores `$A$<cost>$<salt><digest>` — SHA-256 with a configurable
iteration count (`caching_sha2_password_digest_rounds`, default 5000) — in
`mysql.user.authentication_string`. `crypt_genhash_impl.h` in the MySQL tree has
the details.

### What our in-process server should do

In-process, there is no network and no impersonation risk: the caller already
has the database file.

- **Default to trusting the connection.** Treat it as "already secure", so the
  full path degenerates to "client sends password, server compares". No RSA, no
  key management, no dependency on `crypto.subtle` for OAEP.
- **Still implement both markers correctly** (`0x03` / `0x04`), because real
  drivers branch on them and will hang or error if we skip them.
- **Implement `mysql_native_password` too**, and honour `AuthSwitchRequest`, so
  older drivers and pinned configurations work.
- **Do implement the RSA path** in the Node TCP server, where the connection is
  a real socket. `crypto.subtle` supports RSA-OAEP with SHA-1 in browsers, so
  this stays isomorphic if we need it.
- **Never store cleartext.** Even for an embedded database, store
  `SHA256(SHA256(password))` for the fast path and the salted digest for the
  full path — because the datadir is a file a user may share.

## `sha256_password`

The predecessor of `caching_sha2_password`: no cache, so *every* connection
takes the full path. Same RSA mechanics. Implement it only if a client demands
it; it is strictly worse.

## Other plugins

| Plugin | Notes |
|---|---|
| `mysql_clear_password` | Sends the password in the clear. Clients refuse it unless explicitly enabled and the channel is secure. Useful for PAM/LDAP backends. |
| `authentication_ldap_sasl_client`, `authentication_kerberos_client`, `authentication_windows` | Enterprise / platform-specific. Out of scope. |
| `authentication_fido` / `authentication_webauthn` | Hardware second factor. Out of scope, but it is why the multi-factor framing exists. |
| `mysql_old_password` | Pre-4.1, cryptographically broken (CVE-2000-0981). Never implement. |

## Multi-factor authentication (8.0.27+)

With `MULTI_FACTOR_AUTHENTICATION` (`0x10000000`) negotiated, an account can
require up to three factors. After factor 1 succeeds, the server sends
`AuthNextFactor` (`0x02`, plugin name, plugin data) and the exchange repeats.
Out of scope for us, but the packet must at least be *recognised* so a
misconfigured client gets a clear error instead of a hang.

## Expired passwords

If an account's password is expired and the client set
`CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS`, the server completes the connection in
**sandbox mode**: the session status includes an indication that only
`SET PASSWORD` (and a few other statements) are permitted; everything else
returns `ER_MUST_CHANGE_PASSWORD`. Without the flag, the connection is refused
with `ER_MUST_CHANGE_PASSWORD_LOGIN`.

## Security notes for an embedded engine

1. **Auth is not the security boundary here.** Anyone who can call
   `MySQL.open(path)` already has the bytes. Authentication exists so that
   *drivers work*, and so that a `db.listen()` TCP endpoint is not wide open.
2. **The TCP listener is a real boundary.** Default it to `127.0.0.1`, require a
   password, and require an explicit opt-in to bind anywhere else. An embedded
   database that silently listens on `0.0.0.0` is a vulnerability.
3. **Constant-time comparison** for all digests, via `crypto.subtle.timingSafeEqual`
   where available and a manual constant-time loop otherwise.
4. **Nonces come from a CSPRNG** — `crypto.getRandomValues`, never `Math.random`.
5. **Rate-limit failures** on the TCP path, and reuse MySQL's own error
   (`1045 / 28000`) with no distinction between unknown user and bad password.
