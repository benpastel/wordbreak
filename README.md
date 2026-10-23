# WordBreak

A multiplayer word game. Select adjacent letters to make a word and you **claim**
it, locking those letters; only a strictly **longer** word can **break** the claim,
including one of your own. Survive the hold time and it **banks** — one point per
letter — then the tiles **reseed**.

Rules in full: [`public/tutorial.html`](public/tutorial.html) (served at `/tutorial.html`).

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
served by one Render web service: the page, the tutorial and the websocket all come
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

### The old address

The game used to be a GitHub Pages project site at `https://benpastel.com/wordbreak/`
(inheriting the custom domain of the `benpastel.github.io` user site). That address
now forwards to wordbreak.games: `.github/workflows/pages.yml` publishes
`redirect/index.html` there as the index, `tutorial.html` and `404.html`, turning
any `#/t/CODE` table link into `/table/CODE`. It only redeploys when that page or the workflow
changes. Repo Settings → Pages → Source stays on **GitHub Actions**.

## Layout

| path | what |
| --- | --- |
| `src/shared` | types + pure rules, run by both halves |
| `src/server` | hub (tables, claims, hold timers), store seam, dictionary |
| `src/client` | React board, lobby, table room |
| `public` | `tutorial.html`, `words.txt` |
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
