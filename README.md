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

Two halves, both triggered by `git push origin main`:

| half | where | what serves it |
| --- | --- | --- |
| static client | `https://benpastel.com/wordbreak/` | GitHub Pages, via `.github/workflows/pages.yml` |
| game server | `https://<app>.herokuapp.com` | Heroku, via `Procfile` + `heroku-postbuild` |

The client opens a websocket to the Heroku origin. That cross-origin URL is the only
thing the two halves must agree on, and it lives in one place: `VITE_WS_URL` at the
top of the Pages workflow. The build fails loudly if it is still the placeholder,
rather than publishing a page that loads but never connects.

`benpastel.com` is the custom domain on the `benpastel.github.io` user site, and
project sites inherit it — so this repo needs no `CNAME` of its own.

### Heroku

Dashboard → new app → Deploy tab → connect this GitHub repo → enable automatic
deploys from `main`. No CLI and no config: the buildpack reads `engines`, runs
`heroku-postbuild`, and starts the `Procfile` process.

Keep it at **exactly one web dyno** — all state is in memory, so a second dyno is a
second, invisible lobby. Every deploy and every dyno cycle ends the games in progress.

### GitHub Pages

Repo Settings → Pages → Source: **GitHub Actions**. The workflow builds only the
client (`npm run build:client`) and uploads `dist/client`.

Vite is configured with `base: './'`, so the bundle is path-relative and works under
`/wordbreak/` with no path baked in.

### Running the whole thing from Heroku instead

The server also hosts `dist/client` itself, so `npm run build && npm start` gives you
both halves on one origin with no `VITE_WS_URL` at all — that is what local
production testing uses, and it stays a working fallback.

## Layout

| path | what |
| --- | --- |
| `src/shared` | types + pure rules, run by both halves |
| `src/server` | hub (tables, claims, hold timers), store seam, dictionary |
| `src/client` | React board, lobby, table room |
| `public` | `tutorial.html`, `words.txt` |
| `mockup` | the static design mockup the visual language came from |

State is in memory on a single dyno: a restart or deploy ends every game. All access
goes through the `Store` interface in `src/server/store.ts` so adding a real
database later stays contained.

## Words

[ENABLE](https://github.com/dolph/dictionary) — a public-domain list of ~170,000
everyday English words, no proper nouns and no abbreviations. We drop anything
containing `q`, since there is no Q tile. `public/words.txt` is the filtered result
(1.6MB raw, ~430KB gzipped); the client fetches it once so the claim button can light
up with no round trip, and the server validates against the same file.

`data/word-frequency.txt` ranks those words by how often they turn up in ordinary
speech, which decides the **most obscure** award at the end of a match. It is
server-side only. Derived from [FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles, CC BY-SA 4.0) — see [`data/README.md`](data/README.md) for
attribution and how to rebuild it.

`data/definitions.txt` holds a one-line definition for each word, shown under the
most obscure word in the write-up. From [Princeton WordNet 3.0](https://wordnet.princeton.edu/)
under the OSI-approved WordNet licence. Also server-side only.
