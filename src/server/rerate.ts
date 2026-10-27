// Rebuild every rating from the stored matches alone, after changing the rating
// rules or a bot's rating. Shows what would change; writes only with --write.
//
//   npm run rerate                            # this machine's DATABASE_URL (.env)
//   npm run rerate -- --service wordbreak-ro  # production, read-only, to look
//
// To apply it in production, from a shell on the service (render ssh), where
// DATABASE_URL is the owner's:
//
//   node dist/server/rerate.js --write
//
// and then restart the service (render restart), since the running server holds
// ratings in memory and would otherwise write its old ones back after the next match.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db, poolSql } from './db';
import { replay } from './ledger';
import { INITIAL, shown } from './rating';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A connection URL from a libpq service and its password file, which node's pg does
 *  not read by itself: how the read-only production login is kept on this machine
 *  (scripts/setup-readonly-db.sh). */
function serviceUrl(name: string): string {
  const conf = fs.readFileSync(path.join(os.homedir(), '.pg_service.conf'), 'utf8');
  const section = conf.split(/^\[/m).find((s) => s.startsWith(`${name}]`));
  if (!section) throw new Error(`no [${name}] in ~/.pg_service.conf`);
  const kv = Object.fromEntries(
    section
      .split('\n')
      .slice(1)
      .map((l) => l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
  const pass = fs
    .readFileSync(path.join(os.homedir(), '.pgpass'), 'utf8')
    .split('\n')
    .map((l) => l.split(':'))
    .find(([h, p, d, u]) => h === kv.host && p === (kv.port ?? '5432') && d === kv.dbname && u === kv.user)?.[4];
  if (!pass) throw new Error(`no password for ${kv.user}@${kv.host} in ~/.pgpass`);
  // Always checking the server's certificate: node's pg already treats 'require'
  // that way, and says so in a warning unless asked for it by name.
  return `postgresql://${encodeURIComponent(kv.user)}:${encodeURIComponent(pass)}@${kv.host}:${kv.port ?? 5432}/${kv.dbname}?sslmode=verify-full`;
}

async function main(): Promise<void> {
  const service = arg('service');
  const url = service ? serviceUrl(service) : process.env.DATABASE_URL;
  if (!url) throw new Error('no DATABASE_URL (or pass --service)');
  const write = process.argv.includes('--write');
  if (write && service) throw new Error('--write needs the owner, not a read-only service');

  const log = console.log;
  console.log = () => {}; // the migration notice
  const db = new Db(poolSql(url), undefined, write);
  const [players, matches] = await Promise.all([db.loadPlayers(), db.loadMatches()]);
  console.log = log;

  // A guest merged by linking browsers plays on as the one they joined.
  const byId = new Map(players.map((p) => [p.id, p]));
  const alias = new Map<string, string>();
  for (const p of players) {
    let to = p;
    for (let hops = 0; to.mergedInto && hops < 100; hops++) to = byId.get(to.mergedInto) ?? to;
    if (to !== p) alias.set(p.id, to.id);
  }
  const rebuilt = replay(matches, alias);
  const counted = new Map<string, number>();
  for (const m of matches) {
    if (m.how === 'abandoned' || m.playerIds.length < 2) continue;
    for (const id of new Set(m.playerIds.map((id) => alias.get(id) ?? id))) counted.set(id, (counted.get(id) ?? 0) + 1);
  }

  const next = new Map<string, { rating: number; rd: number; volatility: number; ratedMatches: number }>();
  const changes: { name: string; was: number; now: number }[] = [];
  for (const p of players) {
    if (p.kind === 'bot' || p.mergedInto) continue;
    const r = rebuilt.get(p.id) ?? INITIAL;
    next.set(p.id, { ...r, ratedMatches: counted.get(p.id) ?? 0 });
    const was = Math.round(shown(p));
    const now = Math.round(shown(r));
    if (was !== now) changes.push({ name: p.name, was, now });
  }

  console.log(`${matches.length} matches, ${next.size} players; ${changes.length} shown ratings would change`);
  for (const c of changes.sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was)).slice(0, 40)) {
    console.log(`  ${c.name.padEnd(20)} ${String(c.was).padStart(6)} -> ${String(c.now).padStart(6)}`);
  }
  if (write) {
    await db.setRatings(next);
    console.log('written. Restart the server so it reloads them.');
  } else if (changes.length) {
    console.log('dry run: nothing written (--write to apply)');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
