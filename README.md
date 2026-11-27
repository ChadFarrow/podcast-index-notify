# podcast-index-notify

Tell [Podcast Index](https://podcastindex.org) about a new or changed podcast feed.

- **A feed that is already in the index: no key needed.** A keyless `hub/pubnotify` makes
  Podcast Index read the changed feed again now, for every medium.
- **A brand-new feed: Podcast Index may add it, but it does not promise to.** Read
  [What a keyless pubnotify can and cannot do](#what-a-keyless-pubnotify-can-and-cannot-do).
- Optional podping through a pusher you run, a lookup of the feed's Podcast Index id, a
  wait that polls until the feed is in the index (or the time is up), and `add/byfeedurl`
  for a key with the write permission.
- TypeScript, zero runtime dependencies. Uses the global `fetch` and web APIs only, so it
  runs on Node 18+ and on edge runtimes such as Vercel Edge. ESM only: `import`, not
  `require` (Node 22.12+ can also `require` it).
- Never reads an environment variable, never logs, never puts a key or a token in a URL or
  an error. You pass the keys in.

The code comes from [MSP-2.0](https://github.com/ChadFarrow/MSP-2.0) (Music Side Project
Studio), which sends this keyless pubnotify after each feed save.

```sh
npm install podcast-index-notify
```

## What a keyless pubnotify can and cannot do

**A feed that Podcast Index already holds: it works.** A keyless `hub/pubnotify` tells
Podcast Index that the feed changed, and Podcast Index reads it again. This works for every
medium. `hub/pubnotify` needs no key at all
(Podcast Index: "No API key needed for this endpoint"). This library sends it with a
`User-Agent` and nothing else. Do not add key headers to it.

**A brand-new feed: Podcast Index may add it, but it does not promise to.** Podcast Index
answers HTTP 200 `{"status":"true","description":"Feed marked for immediate update."}` also
for a URL that it does not hold. That answer does not mean that the feed is in the index, or
that it will be. In tests on 2026-11-23:

- One new feed got two pubnotifies and a podping, and was in the index about 70 seconds
  later.
- Two other new feeds got pubnotifies, podpings or both. Feed readers fetched one of them
  with HTTP 200 after each notification. One was still not in the index more than 30
  minutes after its first pubnotify, the other 20 minutes after its first podping. Both got
  in only through the form below.

Why Podcast Index added one and not the others is not known. So send the pubnotify (and a
podping, if you run a pusher), then check with `lookup` or `waitUntilIndexed`.

**To add a brand-new feed on purpose, use one of these:**

- `addByFeedUrl`, with a key that has the **write** permission. A normal read-only key gets
  HTTP 401 with an empty body from `add/byfeedurl`, by GET and by POST, even for a feed that
  is already in the index. Nothing in this library calls it unless you ask.
- The form at <https://podcastindex.org/add>, by hand.

**"Not in the index yet" is not a failure.** When Podcast Index adds a new feed, that can
take up to about 15 minutes, and a lookup finds nothing until then. `waitUntilIndexed` polls
for 15 minutes by default. After a timeout the feed may still come, or it may need the form
or a write key.

You need a normal (read) key only to look a feed up (`lookup`, `waitUntilIndexed`). Get one
free at <https://api.podcastindex.org>.

## Quick start

```ts
import { notifyNewOrChangedFeed } from 'podcast-index-notify';

const result = await notifyNewOrChangedFeed('https://example.com/feed.xml', {
  userAgent: 'MyApp/1.0 (+https://myapp.example)',
});
// { ok: true, url: 'https://example.com/feed.xml',
//   pubnotify: { ok: true, httpStatus: 200, description: 'Feed marked for immediate update.' } }
```

With no options it sends ONE keyless pubnotify and nothing else. `ok: true` means that
Podcast Index accepted the ping. It does not mean that the feed is in the index.

## Next.js on Vercel

Send the notification after the response, so a save never waits for Podcast Index:

```ts
// app/api/feeds/route.ts
import { after } from 'next/server';
import { createThrottle, notifyNewOrChangedFeed } from 'podcast-index-notify';

// One notification per feed URL per minute, per warm instance.
const throttle = createThrottle({ windowMs: 60_000 });

const podping =
  process.env.PODPING_ENDPOINT_URL && process.env.PODPING_BEARER_TOKEN
    ? { endpoint: process.env.PODPING_ENDPOINT_URL, token: process.env.PODPING_BEARER_TOKEN }
    : undefined;

export async function PUT(request: Request) {
  const feedUrl = await saveTheFeed(request); // your code

  after(async () => {
    const result = await notifyNewOrChangedFeed(feedUrl, {
      userAgent: 'MyApp/1.0 (+https://myapp.example)',
      throttle,
      medium: 'music', // the feed's <podcast:medium>, for the podping
      podping,
    });
    if (!result.ok && !result.skipped) console.warn('[podcast-index]', result.error, feedUrl);
  });

  return Response.json({ saved: true });
}
```

If your host caches the feed (a CDN, `s-maxage`), add `settleMs`: the call waits that long,
then sends a second pubnotify and the podping, so readers get the new copy. MSP-2.0 uses
`settleMs: 100_000` (a 60 s blob CDN floor + a 30 s edge cache + 10 s). Keep the function
alive for it: set `maxDuration` in `vercel.json` above `settleMs`.

To show the Podcast Index id to the user, poll from the browser (or a background job) with
`lookup`. Do not hold a serverless function open for `waitUntilIndexed`'s 15 minutes.

## Plain Node

```js
import { notifyNewOrChangedFeed, waitUntilIndexed } from 'podcast-index-notify';

const feedUrl = 'https://example.com/feed.xml';
const userAgent = 'my-feed-tool/1.0 (+https://my-feed-tool.example)';

const sent = await notifyNewOrChangedFeed(feedUrl, { userAgent, checkFeed: true });
if (!sent.ok) throw new Error(sent.error);
if (sent.blocked) console.log('The feed asks not to be listed. It was pinged, not registered.');

const found = await waitUntilIndexed(
  { guid: '917393e3-1b1e-5cef-ace4-edaa54e1f810', url: feedUrl },
  { key: process.env.PODCASTINDEX_API_KEY, secret: process.env.PODCASTINDEX_API_SECRET },
  { userAgent, onAttempt: (n, id) => console.log(`check ${n}: ${id ?? 'not yet'}`) }
);

if (found.status === 'indexed') console.log(`https://podcastindex.org/podcast/${found.id}`);
else if (found.status === 'timeout') console.log('Not in the index yet. Check again later, or add it at https://podcastindex.org/add');
else if (found.status === 'error') console.error(found.error); // the read key was refused
```

## API

Every network call takes these options: `userAgent` (Podcast Index asks each app to name
itself, as `<AppName>/<version> (+<link>)`; default
`podcast-index-notify/<version> (+https://github.com/ChadFarrow/podcast-index-notify)`), `timeoutMs` (default 10 000), `signal`,
`fetch` (your own fetch) and `apiBase`. Only `lookup` throws for a network problem; every
other call returns a result object.

### `pubnotify(feed, options?)`

`feed` is a URL string, `{ url }`, or `{ id }` (a Podcast Index feed id). Sends
`GET hub/pubnotify` with a `User-Agent` only. Returns
`{ ok, httpStatus?, description?, error? }`. Podcast Index answers 200 (`ok: true`) also for a
URL that it does not hold, so `ok` is not proof that the feed is or will be in the index.

Use `{ id }` for a feed Podcast Index already holds when your URL may differ from the one it
stores: a URL it does not know can be added as a second feed.

### `notifyNewOrChangedFeed(feedUrl, options?)`

The usual call after a save. In order:

1. Checks the URL (see `validateFeedUrl`). With `checkFeed: true` it also fetches the feed and
   sends nothing unless the feed answers 2xx and looks like RSS or Atom.
2. Sends a pubnotify.
3. With `register` (a WRITE key pair, optional): calls `add/byfeedurl`. Skipped for a blocked
   feed.
4. With `settleMs`: waits, then sends a second pubnotify.
5. With `podping: { endpoint, token }`: sends a podping through your pusher, with `medium`
   and `reason` (default `update`).

Other options: `throttle` (from `createThrottle`). Returns
`{ ok, url, error?, skipped?, feedCheck?, blocked?, pubnotify?, add?, secondPubnotify?, podping? }`.
`ok` is the first pubnotify's result: Podcast Index accepted the ping. It does not mean that
the feed is in the index.

A feed with `<itunes:block>yes</itunes:block>`, `<podcast:block>yes</podcast:block>` or
`<podcast:block id="podcastindex">yes</podcast:block>` is **pinged but never registered**. The
ping makes a directory that already lists it read it again and drop it. (`register` turns
`checkFeed` on, so the block tags are always read before an add.)

### `podping(feedUrl, { endpoint, token }, options?)`

Asks a podping pusher that you run (for example
[msp-podping-service](https://github.com/ChadFarrow/msp-podping-service), a
podping-hivepinger) to write a podping to Hive:
`GET {endpoint}?url=<feed>&reason=<reason>&medium=<medium>` with
`Authorization: Bearer <token>`. The endpoint must be https (plain http only on localhost).
The request never follows a redirect, so the token cannot travel to another host.

`medium` matters: the pusher names the op `pp_<medium>_<reason>`, and a reader may watch
only some media (the msp-podping-service consumer reads only `pp_music_*`). With no medium
the op is `pp_podcast_*`. Pass the feed's `<podcast:medium>` value, such as `music` or
`musicL`. A podping is public and permanent.

### `lookup({ guid?, url? }, { key, secret }, options?)`

Returns the feed's Podcast Index id, or `null` when Podcast Index does not hold it (yet).
Tries `podcasts/byguid` first, then `podcasts/byfeedurl`, with a read key. Throws a
`PodcastIndexError` when Podcast Index cannot answer; `error.isAuthError` is true for a
refused key (401 or 403).

### `waitUntilIndexed({ guid?, url? }, { key, secret }, options?)`

Checks at once, then after 5 s, 10 s, 20 s, 40 s and every 60 s, for up to 15 minutes.
Options: `timeoutMs`, `initialDelayMs`, `maxDelayMs`, `backoffFactor`, `onAttempt`, `signal`.
Never treats "not yet" as a failure. Returns one of:

- `{ status: 'indexed', id, attempts, elapsedMs }`
- `{ status: 'timeout', attempts, elapsedMs, lastError? }`: not in the index yet. It may still
  come. A brand-new feed may need `addByFeedUrl` (a write key) or the form at
  <https://podcastindex.org/add>.
- `{ status: 'aborted', attempts, elapsedMs }`
- `{ status: 'error', error, httpStatus?, attempts, elapsedMs }`: the key was refused.

Network errors and 5xx answers count as "not yet".

### `addByFeedUrl(feedUrl, writeKey, options?)`: optional

Only for a key with the **write** permission. `POST add/byfeedurl`. Returns
`{ ok, feedId?, existed?, httpStatus?, description?, error? }`. A read-only key gets HTTP 401
with an empty body, even for a feed that is already in the index; the result is then
`ok: false` with an `error` that says so. Without a write key, use the form at
<https://podcastindex.org/add>. The success answer was not tested live (no write key was at
hand). A new feed may come back with no `feedId`; then poll with `lookup`.

### Feed helpers

- `checkFeed(feedUrl, options?)`: fetches the feed once (at most 512 KB) and returns
  `{ ok, httpStatus?, looksLikeFeed?, blocked?, error? }`. Never returns the content.
- `feedBlocksIndexing(xml, slug = 'podcastindex')`, `hasItunesBlock(xml)`,
  `hasPodcastBlock(xml, slug?)`: the block tag rules, in the
  [podcast namespace](https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/block.md)
  order.
- `validateFeedUrl(url)`: `{ ok: true, url }` (normalized) or `{ ok: false, error }`. Refuses
  a non-http(s) URL, a URL with a user name or password, and the characters that make
  Podcast Index store a feed twice or not fetch it: whitespace, apostrophes, `<>"{}|\^\``
  and non-ASCII. `getFeedUrlError(url)` and `normalizeFeedUrl(url)` are the parts.
- `createThrottle({ windowMs?, maxEntries? })`: `check(url)` is true once per URL per window.
  It lives in memory: per process, or per warm serverless instance.
- `podcastIndexAuthHeaders({ key, secret }, userAgent)`: the four headers of a keyed request.

## Security notes

- Keys go only into the `X-Auth-Key` and `Authorization` headers of keyed requests, and the
  pusher token only into its `Authorization` header. Keyed requests and the podping never
  follow a redirect.
- `hub/pubnotify` never gets a key header.
- `checkFeed` fetches the URL you give it. If your server takes feed URLs from users, guard
  against private and internal addresses (SSRF) before you call it, or leave it off.
- A pubnotify for a URL Podcast Index does not hold can add that URL to the index, and
  Podcast Index has no delete. A podping is written to a public blockchain.

## Live test

The unit tests never touch the network. One opt-in script sends ONE real keyless pubnotify
for a URL you name, and prints Podcast Index's answer:

```sh
npm run live:pubnotify -- https://example.com/feed.xml --yes
```

Without `--yes` it only prints what it would send. A 200 answer does not show that Podcast
Index will add a new feed.

## License

MIT
