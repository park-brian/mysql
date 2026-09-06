# Captured protocol traces

Recorded by `tools/capture-traces.mjs`, which proxies a real client to a real
server and writes down every byte that crossed, in order, with its direction.

- **Server**: MySQL 8.0.46 (Ubuntu), `caching_sha2_password` default.
- **Clients**: the `mysql` command-line client 8.0.46, and `mysql2` 3.24.3.
- **Shape**: `{ events: [{ direction: 'c2s' | 's2c', bytes: [...] }] }` — the
  form doc 43 §3's `loadTrace()` consumes.

`../trace-conformance.test.ts` asserts that our readers parse them: a real
server's `HandshakeV10`, its column definitions, its OK/ERR packets and its
binary rows, and a real client's `HandshakeResponse41`, `COM_QUERY` and
`COM_STMT_EXECUTE`. Two errata were settled here rather than by argument —
E-07 (the all-zero binary `TIME`) and E-08 (the parameter type word).

`--ssl-mode=DISABLED` is passed to the CLI when capturing. Without it the
client defaults to `PREFERRED`, a real server advertises `CLIENT_SSL`, and
everything after the 32-byte `SSLRequest` is ciphertext. We never advertise
`CLIENT_SSL` in-process (D-12), so the cleartext capture is also the
negotiation our own server offers.

## Licensing

These are recordings of a program's observable network behaviour, not copies of
its source, and doc 43 §3 prescribes making them: "Record real client/server
byte exchanges … then replay them." Ground rule 7 governs MySQL *source*, which
is why the error table is generated from `messages_to_clients.txt` and then
discarded (D-14, D-29) rather than vendored.

A few of MySQL's error strings do appear inside these byte streams, because an
ERR packet carries one. That is incidental to capturing the packet, and is a
different thing from reproducing the message catalogue — which we deliberately
do not do. If that boundary ever looks uncomfortable, the fix is to re-capture
against statements whose errors we raise ourselves, not to stop testing against
a real server.

## Re-capturing

Needs a MySQL server on `127.0.0.1:3306` and the accounts `trace`/`tracepw`
and `nopw` (empty password) with rights on `tracedb`:

```sh
npm run capture:traces
```

CI re-captures against `mysql:8.4` in a non-blocking job, so that a newer
server's bytes are noticed rather than assumed. The committed fixtures are what
`npm test` actually checks.
