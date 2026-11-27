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
  `X-Auth-*` or `Authorization` there: Podcast Index documents it as keyless, and a key there
  gains nothing (boostmebitch#666 sent one). A test checks the headers on the wire.
- **Never promise that a pubnotify adds a new feed.** Tests on 2026-11-23: for a feed already
  in PI, a keyless pubnotify works for every medium. For a URL PI does not hold, it still
  answers 200 "Feed marked for immediate update.". One brand-new feed was in PI 71 s after
  two pubnotifies and a podping; two others were not, after pubnotifies, podpings or both,
  and got in only by the hand form https://podcastindex.org/add. The cause is not known. The README, the JSDoc
  and the package description must not say more than this. Public text stays general: no
  app names, no feed URLs.
- **`add/byfeedurl` is optional.** It needs a WRITE key: a read key gets 401 with an empty
  body, by GET and POST, even for a feed already in PI (2026-11-23; Chad asked PI for write
  access). Its success answer is not tested live. Only `addByFeedUrl` and
  `notifyNewOrChangedFeed({ register })` call it; nothing calls it by default.
- **A blocked feed is pinged, never registered** (`<itunes:block>yes`, `<podcast:block>yes`,
  `<podcast:block id="podcastindex">yes`), as in MSP-2.0.
- **"Not in the index yet" is never a failure.** When PI adds a new feed, that can take up to
  about 15 minutes (Chad, 2026-11-23). `waitUntilIndexed` waits 15 minutes by default. After a
  timeout, the fallback is a write key or the hand form.
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
- **User-Agent:** every call sends `options.userAgent` when the caller gives one, else
  `DEFAULT_USER_AGENT` (`src/http.ts`): `podcast-index-notify/<version> (+https://github.com/ChadFarrow/podcast-index-notify)`.
  Keep that form, `<name>/<version> (+<link>)`: no email, no browser imitation.
  `test/user-agent.test.ts` checks it against package.json.

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
