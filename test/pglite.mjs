// PGlite, a real Postgres compiled to WebAssembly, as the server's `Sql` (db.ts), so
// the tests run the true SQL with no database server.
import { PGlite } from '@electric-sql/pglite';

export function pglite() {
  const pg = new PGlite();
  const sql = {
    query: (t, p) => pg.query(t, p),
    transaction: (fn) => pg.transaction((tx) => fn({ query: (t, p) => tx.query(t, p), exec: (t) => tx.exec(t) })),
  };
  return { pg, sql };
}
