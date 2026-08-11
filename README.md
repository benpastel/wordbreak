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

## Build and serve like production

```sh
npm run build && npm start   # http://localhost:8080
```

## Deploy to Heroku

```sh
heroku create
git push heroku main
```

`heroku-postbuild` runs the build; the Express server hosts `dist/client` and the
websocket on the same origin, so there is no CORS and no build-time server URL.

To split the static half onto GitHub Pages later, deploy `dist/client` there and
build with `VITE_WS_URL=wss://<app>.herokuapp.com/ws`.

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
(1.6MB raw, ~430KB gzipped); the client fetches it once so auto-claiming needs no
round trip, and the server validates against the same file.
