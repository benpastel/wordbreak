# WordBreak

A multiplayer word game. Select adjacent letters to make a word and you **claim**
it, locking those letters; only a strictly **longer** word can **break** the claim,
including one of your own. Survive the hold time and it **banks** — one point per
letter — then the tiles **reseed**.

How to play is shown on the home page, as three animated boards (`src/client/HowTo.tsx`). To check them
by eye after a change, `npm run howto-frames` films each one at desktop and phone size
in both themes and prints where the contact sheets went.

## Run it locally

```sh
npm install
npm run dev
```

Open http://localhost:5173. Vite serves the client and proxies `/ws` to the game
server on :8080. Open a second window to play against yourself — a table works with
one player, and you can join mid-game.

## Tests

```sh
npm test
```

Three plain-node suites, no framework. `test/rules.test.mjs` and
`test/selection.test.mjs` exercise the pure logic in `src/shared`;
`test/protocol.test.mjs` boots a real server on a spare port and drives the real
websocket protocol with two clients through a claim, a break, a bank and a
reconnect.

## Build and serve like production

```sh
npm run build && npm start   # http://localhost:8080
```

## Deploying

`git push origin main` deploys everything. The game lives at **https://wordbreak.games**,
served by one Render web service: the page and the websocket both come
from the same origin, so there is no cross-origin configuration anywhere.

### Render

A web service connected to this GitHub repo, auto-deploying from `main`. It builds
with `npm ci && npm run build` and starts with `npm start`. Its custom domains are
`wordbreak.games` and `www.wordbreak.games`, the latter redirecting to the former;
`wordbreak.onrender.com` still answers too.

Keep it at **exactly one instance** — all state is in memory, so a second instance is
a second, invisible lobby. Every deploy and every restart ends the games in progress.

Every match prints one line to the service's log when it ends (or is abandoned):
`match {…}`, JSON with the players and bot levels, each claim with rough timings and
whether it banked, broke or was still held, and each word tried and turned down. See
`src/server/matchlog.ts`.

### Database

Render Postgres `wordbreak-db` (Basic-256mb, Ohio, beside the service), reachable only
from inside Render: its IP allow list is empty. The service finds it through
`DATABASE_URL`, set to the database's internal connection string.

Play never touches it. Everything during a match stays in memory; when a match ends
(or is abandoned), its report and the ids of everyone who played are written to
`matches`, fire-and-forget, so a slow or missing database cannot stall a game.
After a match each player can open their own misses (words they slid that were
not words) at the bottom of the results and request any for inclusion; those land in
`word_requests`, one row per word per player, and also print a `word-request {…}`
log line. The most-asked first, from a shell on the service:

```sh
render ssh srv-db3rsj8473hc73f47f6g
psql "$DATABASE_URL" -c "select word, count(*) from word_requests group by word order by 2 desc"
```

Accepted words go in `data/modern-words.txt`.

Migrations live in `src/server/db.ts` and run at startup, each once. Without
`DATABASE_URL`, as locally and in the tests, nothing is kept; `test/db.test.mjs` checks
the SQL against PGlite instead.

### Players and ratings

A guest is a browser and a name together: each browser keeps a secret
(`wordbreak.device` in local storage, stored server-side only as a hash), and every
name played under on it is a separate player, so people sharing a browser are rated
apart. The secret is also what lets a refreshed tab take its seat back; the player
id everyone at a table sees is not enough on its own.

Ratings are Glicko-2 (`src/server/rating.ts`), one match per rating period. A match
of several players is every pair of them: the higher score wins, equal is a draw,
leaving early loses to everyone who stayed. The leaderboard shows the cautious
rating, rating − 2 × RD, so newcomers start low and climb. Bot levels are fixed
players with no uncertainty, at ratings measured in the bot tournament (below).

Ratings live in memory (`src/server/ledger.ts`), loaded from `players` at startup
and written back after each match. Every match row keeps its players' ids and the
report with everyone's rating before and after, and `replay()` in `ledger.ts`
recomputes every rating from those rows alone; `test/ledger.test.mjs` checks it
matches exactly. Signing in by emailed link will use `login_links` and `sessions`,
already in the schema and not yet used.

### The old address

The game used to be a GitHub Pages project site at `https://benpastel.com/wordbreak/`
(inheriting the custom domain of the `benpastel.github.io` user site). That address
now forwards to wordbreak.games: `.github/workflows/pages.yml` publishes
`redirect/index.html` there as the index, the old `tutorial.html` and `404.html`, turning
any `#/t/CODE` table link into `/table/CODE`. It only redeploys when that page or the workflow
changes. Repo Settings → Pages → Source stays on **GitHub Actions**.

## Bot tournament

`npm run tournament` keeps a standing population of varied bots and every game they
have played, in `data/bots/`: each bot a full set of knobs drawn around a base
difficulty, each game a random board (4×4 to 6×6, points or time, two to four bots)
between bots near each other's rating. Ratings are fitted to all games at once,
intermediate pinned at 1500, so they share a scale with players' ratings; the named
levels' ratings in `BOT_LEVELS` come from here. Games are stamped with a hash of the
bot code, and only games from the current code count, the previous fit becoming the
starting point after a change.

```sh
npm run tournament -- grow --bots 100      # more bots
npm run tournament -- play --games 20000   # play (all cores), refitting as it goes
npm run tournament -- report               # named levels, what each knob is worth
npm run tournament -- pick 0,800,1500      # bots nearest those ratings
```

## Layout

| path | what |
| --- | --- |
| `src/shared` | types + pure rules, run by both halves |
| `src/server` | hub (tables, claims, hold timers), store seam, dictionary |
| `src/client` | React board, lobby, table room |
| `public` | `words.txt`, `favicon.svg` |
| `mockup` | the static design mockup the visual language came from |

State is in memory on a single server: a restart or deploy ends every game. All access
goes through the `Store` interface in `src/server/store.ts` so adding a real
database later stays contained.

## Words

[ENABLE](https://github.com/dolph/dictionary) — a list of ~173,000 everyday English
words, no proper nouns and no abbreviations, [released into the public
domain](https://tiltingatwindmills.dev/enable_README.txt) by its compilers. We drop
anything containing `q`, since there is no Q tile, and add the 313 entries of
[`data/modern-words.txt`](data/modern-words.txt) — ENABLE was last revised in 1999,
and a rejected `selfie` reads as a bug rather than a rule. `public/words.txt` is the
result, 166,393 words (1.6MB raw, ~430KB gzipped); the client fetches it once so the
claim button can light up with no round trip, and the server validates against the
same file. Rebuild with `node scripts/build-words.mjs`.

`data/word-frequency.txt` ranks those words by how often they turn up in ordinary
speech, which decides the **most obscure** award at the end of a match. It is
server-side only. Derived from [FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles, CC BY-SA 4.0) — see [`data/README.md`](data/README.md) for
attribution and how to rebuild it.

`data/definitions.txt` holds a one-line definition for each word, shown under the
most obscure word in the write-up. From [Princeton WordNet 3.0](https://wordnet.princeton.edu/)
under the OSI-approved WordNet licence. Also server-side only.
