// M1.24's stub executor, kept as what it has become: the real executor with no
// database behind it.
//
// Until M5 this file was a regex matcher that answered the handful of
// statements a client sends before `SELECT 1`. The executor that replaced it
// (`sql/executor.ts`) answers all of those through the parser, so the stub is
// now that executor without a catalog: `SET`, `USE`, `SELECT @@version_comment`,
// `SELECT 1`, stored-program statements — everything that needs no table —
// behave as they do with a database, and anything that needs one is refused.
// `MySQL.open()` no longer uses it; a test or an embedder that wants a
// server with no storage still can.
import { SqlExecutor } from './sql/executor.ts'
import type { ServerOptions } from './sql/admin.ts'

export type StubOptions = ServerOptions

export class StubExecutor extends SqlExecutor {
  constructor(options: StubOptions = {}) {
    super(options)
  }
}
