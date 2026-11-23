import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_USER_AGENT, podping, podpingRequestUrl, pubnotify } from '../src/index.js';
import { FEED, TOKEN, fakeFetch, json, query, text } from './helpers.js';

const PI_OK = { status: 'true', description: 'Feed marked for immediate update.' };

test('pubnotify sends ONE keyless GET with only a User-Agent', async () => {
  const f = fakeFetch(() => json(PI_OK));
  const r = await pubnotify(FEED, { fetch: f.fetch, userAgent: 'MyApp/2.0' });

  assert.deepEqual(r, { ok: true, httpStatus: 200, description: 'Feed marked for immediate update.' });
  assert.equal(f.calls.length, 1);
  const call = f.calls[0]!;
  assert.equal(call.method, 'GET');
  assert.ok(call.url.startsWith('https://api.podcastindex.org/api/1.0/hub/pubnotify?'));
  assert.equal(query(call).get('url'), FEED);
  assert.deepEqual(Object.keys(call.headers), ['user-agent']);
  assert.equal(call.headers['user-agent'], 'MyApp/2.0');
  assert.equal(call.cache, 'no-store');
});

test('pubnotify encodes the feed URL and normalizes paste junk', async () => {
  const f = fakeFetch(() => json(PI_OK));
  const tricky = 'https://a.example/feed.xml?x=1&y=two';
  await pubnotify(`  ${tricky}\n`, { fetch: f.fetch });
  assert.equal(query(f.calls[0]!).get('url'), tricky);
  assert.equal(new URL(f.calls[0]!.url).searchParams.getAll('y').length, 0, 'the feed query must not leak into PI params');
  assert.equal(f.calls[0]!.headers['user-agent'], DEFAULT_USER_AGENT);
});

test('pubnotify by Podcast Index id', async () => {
  const f = fakeFetch(() => json(PI_OK));
  const r = await pubnotify({ id: 920666 }, { fetch: f.fetch });
  assert.equal(r.ok, true);
  assert.equal(query(f.calls[0]!).get('id'), '920666');
  assert.equal(query(f.calls[0]!).get('url'), null);
});

test('pubnotify refuses a bad URL or id without sending anything', async () => {
  const f = fakeFetch(() => json(PI_OK));
  for (const bad of ['ftp://a.example/f.xml', 'https://a.example/my feed.xml', '', { id: 0 }, { id: -5 }, { id: 1.5 }, { url: 'nope' }]) {
    const r = await pubnotify(bad as never, { fetch: f.fetch });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }
  assert.equal(f.calls.length, 0);
});

test('pubnotify reports PI status "false", HTTP errors and network failures', async () => {
  let r = await pubnotify(FEED, { fetch: fakeFetch(() => json({ status: 'false', description: 'Feed not found.' })).fetch });
  assert.deepEqual(r, { ok: false, httpStatus: 200, description: 'Feed not found.', error: 'Feed not found.' });

  r = await pubnotify(FEED, { fetch: fakeFetch(() => text('<html>oops</html>', 503, 'text/html')).fetch });
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 503);
  assert.match(r.error!, /HTTP 503/);

  r = await pubnotify(FEED, { fetch: fakeFetch(() => text('', 200, 'text/plain')).fetch });
  assert.equal(r.ok, true, 'an empty 200 is a success');

  r = await pubnotify(FEED, {
    fetch: fakeFetch(() => {
      throw new TypeError('fetch failed');
    }).fetch,
  });
  assert.deepEqual(r, { ok: false, error: 'fetch failed' });
});

test('pubnotify times out and honors the caller signal', async () => {
  const hang = fakeFetch(
    (call) =>
      new Promise<Response>(() => {
        void call;
      })
  );
  // The fake never answers, so only the timeout can end it. Real fetch rejects on abort;
  // emulate that by racing the signal.
  const abortingFetch: typeof fetch = (input, init) =>
    new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      void hang.fetch(input, init).then(resolve, reject);
    });
  const r = await pubnotify(FEED, { fetch: abortingFetch, timeoutMs: 20 });
  assert.deepEqual(r, { ok: false, error: 'timed out after 20 ms' });

  const controller = new AbortController();
  controller.abort();
  const r2 = await pubnotify(FEED, { fetch: abortingFetch, signal: controller.signal });
  assert.deepEqual(r2, { ok: false, error: 'aborted' });
});

test('podping: GET {endpoint}?url&reason&medium with the bearer token in a header only', async () => {
  const f = fakeFetch(() => json({ message: 'enqueued' }));
  const r = await podping(FEED, { endpoint: 'https://pusher.example/', token: TOKEN }, { fetch: f.fetch, medium: 'musicL' });

  assert.deepEqual(r, { ok: true, httpStatus: 200, message: 'enqueued' });
  const call = f.calls[0]!;
  assert.equal(call.method, 'GET');
  assert.equal(new URL(call.url).origin + new URL(call.url).pathname, 'https://pusher.example/');
  assert.equal(query(call).get('url'), FEED);
  assert.equal(query(call).get('reason'), 'update');
  assert.equal(query(call).get('medium'), 'musicL');
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(call.redirect, 'error', 'a redirect must not carry the token away');
  assert.ok(!call.url.includes(TOKEN));
});

test('podping: no medium means no medium param; a reason passes through', async () => {
  const f = fakeFetch(() => json({ message: 'duplicate' }));
  const r = await podping(FEED, { endpoint: 'https://pusher.example/ping?team=a', token: TOKEN }, { fetch: f.fetch, reason: 'live' });
  assert.equal(r.ok, true);
  assert.equal(r.message, 'duplicate');
  assert.equal(query(f.calls[0]!).get('medium'), null);
  assert.equal(query(f.calls[0]!).get('reason'), 'live');
  assert.equal(query(f.calls[0]!).get('team'), 'a', 'an existing endpoint query stays');
});

test('podping refuses plain http (except localhost), credentials in the endpoint, and no token', async () => {
  assert.ok('error' in podpingRequestUrl('http://pusher.example/', FEED));
  assert.ok('url' in podpingRequestUrl('http://localhost:4010/', FEED));
  assert.ok('url' in podpingRequestUrl('http://127.0.0.1:4010/', FEED));
  assert.ok('error' in podpingRequestUrl('https://u:p@pusher.example/', FEED));
  assert.ok('error' in podpingRequestUrl('not a url', FEED));

  const f = fakeFetch(() => json({ message: 'enqueued' }));
  assert.equal((await podping(FEED, { endpoint: 'http://pusher.example/', token: TOKEN }, { fetch: f.fetch })).ok, false);
  assert.equal((await podping(FEED, { endpoint: 'https://pusher.example/', token: '' }, { fetch: f.fetch })).ok, false);
  assert.equal((await podping('ftp://x.example/f.xml', { endpoint: 'https://pusher.example/', token: TOKEN }, { fetch: f.fetch })).ok, false);
  assert.equal(f.calls.length, 0);
});

test('podping reports a refusal without the token', async () => {
  const r = await podping(FEED, { endpoint: 'https://pusher.example/', token: TOKEN }, { fetch: fakeFetch(() => json({ error: 'unauthorized' }, 401)).fetch });
  assert.deepEqual(r, { ok: false, httpStatus: 401, message: 'unauthorized', error: 'unauthorized' });
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});
