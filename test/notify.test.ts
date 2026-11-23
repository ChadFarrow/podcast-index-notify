import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createThrottle, notifyNewOrChangedFeed } from '../src/index.js';
import { CREDS, FEED, TOKEN, type Call, fakeFetch, json, query, rssWith, RSS, text } from './helpers.js';

const PUSHER = { endpoint: 'https://pusher.example/', token: TOKEN };

/** Answers like PI, a feed host and a pusher, by URL. */
function world(feedBody = RSS, feedStatus = 200) {
  return fakeFetch((c: Call) => {
    if (c.url.includes('/hub/pubnotify')) return json({ status: 'true', description: 'Feed marked for immediate update.' });
    if (c.url.includes('/add/byfeedurl')) return json({ status: 'true', feedId: 555, existed: 'false' });
    if (c.url.startsWith('https://pusher.example/')) return json({ message: 'enqueued' });
    if (c.url === FEED) return text(feedBody, feedStatus);
    throw new Error(`unexpected request ${c.url}`);
  });
}

const kind = (c: Call) =>
  c.url.includes('/hub/pubnotify') ? 'pubnotify' : c.url.includes('/add/byfeedurl') ? 'add' : c.url.startsWith('https://pusher') ? 'podping' : 'feed';

test('default: ONE keyless pubnotify, nothing else (no add, no podping, no feed fetch)', async () => {
  const w = world();
  const r = await notifyNewOrChangedFeed(FEED, { fetch: w.fetch });
  assert.equal(r.ok, true);
  assert.equal(r.url, FEED);
  assert.deepEqual(w.calls.map(kind), ['pubnotify']);
  assert.deepEqual(Object.keys(w.calls[0]!.headers), ['user-agent']);
  assert.equal(r.add, undefined);
  assert.equal(r.podping, undefined);
});

test('full flow in MSP order: feed check, pubnotify, add (write key), wait, 2nd pubnotify, podping', async () => {
  const w = world();
  const r = await notifyNewOrChangedFeed(FEED, {
    fetch: w.fetch,
    register: CREDS,
    settleMs: 15,
    podping: PUSHER,
    medium: 'musicL',
  });
  assert.deepEqual(w.calls.map(kind), ['feed', 'pubnotify', 'add', 'pubnotify', 'podping']);
  assert.equal(r.ok, true);
  assert.equal(r.blocked, false);
  assert.equal(r.add?.feedId, 555);
  assert.equal(r.secondPubnotify?.ok, true);
  assert.equal(r.podping?.ok, true);

  const pubnotifies = w.calls.filter((c) => kind(c) === 'pubnotify');
  for (const c of pubnotifies) {
    assert.deepEqual(Object.keys(c.headers), ['user-agent'], 'pubnotify never carries a key, even with register');
  }
  const ping = w.calls.find((c) => kind(c) === 'podping')!;
  assert.equal(query(ping).get('medium'), 'musicL');
  assert.equal(query(ping).get('reason'), 'update');
});

test('the podping goes after the settle wait', async () => {
  const w = world();
  const started = Date.now();
  let pingAt = 0;
  const timed: typeof fetch = async (input, init) => {
    if (String(input).startsWith('https://pusher.example/')) pingAt = Date.now();
    return w.fetch(input, init);
  };
  await notifyNewOrChangedFeed(FEED, { fetch: timed, settleMs: 60, podping: PUSHER });
  assert.ok(pingAt - started >= 55, `podping at ${pingAt - started} ms`);
  assert.deepEqual(w.calls.map(kind), ['pubnotify', 'pubnotify', 'podping']);
});

test('a blocked feed is pinged but never registered', async () => {
  for (const tag of ['<itunes:block>Yes</itunes:block>', '<podcast:block>yes</podcast:block>', '<podcast:block id="podcastindex">yes</podcast:block>']) {
    const w = world(rssWith(tag));
    const r = await notifyNewOrChangedFeed(FEED, { fetch: w.fetch, register: CREDS, podping: PUSHER });
    assert.equal(r.blocked, true, tag);
    assert.equal(r.ok, true);
    assert.equal(r.add, undefined);
    assert.deepEqual(w.calls.map(kind), ['feed', 'pubnotify', 'podping'], tag);
  }
});

test('checkFeed: a feed that does not answer 200 gets nothing sent', async () => {
  for (const [body, status] of [['nope', 404], ['denied', 403], ['<html>challenge</html>', 200]] as const) {
    const w = world(body, status);
    const r = await notifyNewOrChangedFeed(FEED, { fetch: w.fetch, checkFeed: true, podping: PUSHER });
    assert.equal(r.ok, false);
    assert.ok(r.error);
    assert.deepEqual(w.calls.map(kind), ['feed'], `${status}`);
  }
});

test('a bad URL sends nothing', async () => {
  const w = world();
  const r = await notifyNewOrChangedFeed("https://a.example/rock'n roll.xml", { fetch: w.fetch, podping: PUSHER });
  assert.equal(r.ok, false);
  assert.match(r.error!, /whitespace/);
  assert.equal(w.calls.length, 0);
});

test('the throttle skips a repeat within its window', async () => {
  const w = world();
  const throttle = createThrottle({ windowMs: 60_000 });
  assert.equal((await notifyNewOrChangedFeed(FEED, { fetch: w.fetch, throttle })).ok, true);
  const again = await notifyNewOrChangedFeed(FEED, { fetch: w.fetch, throttle });
  assert.equal(again.ok, false);
  assert.equal(again.skipped, 'throttled');
  assert.equal(w.calls.length, 1);
});

test('a failed feed check does not use up the throttle window', async () => {
  const throttle = createThrottle({ windowMs: 60_000 });
  const broken = world('gone', 404);
  assert.equal((await notifyNewOrChangedFeed(FEED, { fetch: broken.fetch, throttle, checkFeed: true })).ok, false);
  const fixed = world();
  const r = await notifyNewOrChangedFeed(FEED, { fetch: fixed.fetch, throttle, checkFeed: true });
  assert.equal(r.ok, true);
  assert.equal(r.skipped, undefined);
});

test('a failed pubnotify is reported; the podping still goes', async () => {
  const f = fakeFetch((c) => (c.url.includes('/hub/pubnotify') ? json({ description: 'down' }, 500) : json({ message: 'enqueued' })));
  const r = await notifyNewOrChangedFeed(FEED, { fetch: f.fetch, podping: PUSHER });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'down');
  assert.equal(r.podping?.ok, true);
});

test('an abort during the settle wait stops before the second pubnotify', async () => {
  const w = world();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const r = await notifyNewOrChangedFeed(FEED, { fetch: w.fetch, settleMs: 5_000, podping: PUSHER, signal: controller.signal });
  assert.equal(r.ok, true);
  assert.equal(r.secondPubnotify, undefined);
  assert.equal(r.podping, undefined);
  assert.deepEqual(w.calls.map(kind), ['pubnotify']);
});
