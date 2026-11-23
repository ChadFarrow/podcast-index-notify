# CLAUDE.md

`podcast-index-notify`: a small public npm library (MIT) that tells Podcast Index about a
new or changed feed. Chad's apps use it, and so can anyone. Started 2026-11-23 from the
MSP-2.0 code (`api/_utils/feedUtils.ts`, `api/pubnotify.ts`, `api/_utils/urlValidation.ts`).

## Commands

- `npm ci`, then `npm run build` (tsc to `dist/`), `npm test` (tsc to `.test-build/`, then
  `node --test`), `npm run typecheck`.
- `npm run live:pubnotify -- <feed-url> --yes`: sends ONE real keyless pubnotify. Never in CI,
  and never for a feed that nobody asked to list (Podcast Index has no delete).
- Publishing to npm is Chad's step (his npm account): `npm login`, then
  `npm publish --access public`. Agents do not publish.

## Rules

- **pubnotify is keyless.** `src/pubnotify.ts` sends a `User-Agent` and nothing else. Never add
  `X-Auth-*` or `Authorization` there (the Boost Me Bitch bug, boostmebitch#666). A test checks
  the headers on the wire.
- **`add/byfeedurl` is optional.** It needs a WRITE key. Only `addByFeedUrl` and
  `notifyNewOrChangedFeed({ register })` call it; nothing calls it by default.
- **A blocked feed is pinged, never registered** (`<itunes:block>yes`, `<podcast:block>yes`,
  `<podcast:block id="podcastindex">yes`), as in MSP-2.0.
- **"Not in the index yet" is never a failure.** A new feed can take up to about 15 minutes
  (Chad, 2026-11-23). `waitUntilIndexed` waits 15 minutes by default.
- **Keys and tokens:** the caller passes them. The library reads no environment variable,
  logs nothing, and never puts a key or a token in a URL, a result or an error. Keyed requests
  use `redirect: 'manual'`, the podping `redirect: 'error'`. `test/secrets.test.ts` sweeps for
  leaks; keep it passing.
- **Zero runtime dependencies.** Web APIs only in `src/` (no `node:` imports): it must run on
  Node 18+, Vercel Edge and Workers. Node 18 has no global WebCrypto and no `AbortSignal.any`,
  so `src/sha1.ts` is a plain SHA-1 and `src/http.ts` joins the abort signals by hand.
- **No network in tests.** Unit tests use the fake fetch in `test/helpers.ts`;
  `test/real-fetch.test.ts` uses a server on 127.0.0.1 that it starts and stops.
- **Version:** change `package.json` and `src/version.ts` together (a test checks them).

## Layout

- `src/pubnotify.ts`, `src/notify.ts` (the main flow, MSP order), `src/podping.ts`,
  `src/lookup.ts`, `src/wait.ts`, `src/add.ts` (optional), `src/feed.ts` (feed check and block
  tags), `src/throttle.ts`, `src/url.ts` (MSP's URL rules), `src/auth.ts` + `src/sha1.ts`,
  `src/http.ts` (fetch, timeout, capped reads), `src/index.ts` (the public API).
- `scripts/live-pubnotify.mjs`: the opt-in live test.
- `.github/workflows/ci.yml`: typecheck, build, test and `npm pack --dry-run` on Node 18, 20,
  22 and 24.

## Who uses it

Planned (2026-11-23): MSP-2.0, MSP-2.0-Desktop-App, boostmebitch, sovereign-feeds,
musicL-playlist-updater. Each move is its own task, one PR per repo. Until then those repos
keep their own copies of this code.
