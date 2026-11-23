import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PodcastIndexError, addByFeedUrl, lookup } from '../src/index.js';
import { CREDS, FEED, fakeFetch, json, query } from './helpers.js';

const GUID = '917393e3-1b1e-5cef-ace4-edaa54e1f810';
const hit = (id: number) => json({ status: 'true', feed: { id, title: 'x' } });
const miss = () => json({ status: 'true', feed: [], description: 'No feeds match this guid.' });

test('lookup tries byguid first and stops on a hit', async () => {
  const f = fakeFetch(() => hit(7536878));
  assert.equal(await lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), 7536878);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0]!;
  assert.ok(call.url.includes('/podcasts/byguid?'));
  assert.equal(query(call).get('guid'), GUID);
  assert.equal(call.headers['x-auth-key'], CREDS.key);
  assert.match(call.headers.authorization!, /^[0-9a-f]{40}$/);
  assert.match(call.headers['x-auth-date']!, /^\d+$/);
  assert.equal(call.redirect, 'manual', 'never follow a redirect with the key headers');
  assert.ok(!call.url.includes(CREDS.key) && !call.url.includes(CREDS.secret));
});

test('lookup falls back to byfeedurl, and returns null when PI holds neither', async () => {
  let f = fakeFetch((c) => (c.url.includes('byguid') ? miss() : hit(42)));
  assert.equal(await lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), 42);
  assert.equal(f.calls.length, 2);
  assert.equal(query(f.calls[1]!).get('url'), FEED);

  f = fakeFetch(() => miss());
  assert.equal(await lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), null);

  f = fakeFetch(() => json({ description: 'not found' }, 404));
  assert.equal(await lookup({ url: FEED }, CREDS, { fetch: f.fetch }), null, '404 is a miss, not an error');
});

test('lookup throws an auth error at once on 401, with no key in the message', async () => {
  const f = fakeFetch(() => json({ status: 'false', description: 'Authorization header is not valid' }, 401));
  await assert.rejects(lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), (err: unknown) => {
    assert.ok(err instanceof PodcastIndexError);
    assert.equal(err.isAuthError, true);
    assert.equal(err.httpStatus, 401);
    assert.ok(!err.message.includes(CREDS.key) && !err.message.includes(CREDS.secret));
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('lookup: a 5xx on one step and a clean miss on the other is a miss; errors on all steps throw', async () => {
  let f = fakeFetch((c) => (c.url.includes('byguid') ? json({}, 502) : miss()));
  assert.equal(await lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), null);

  f = fakeFetch(() => json({ description: 'busy' }, 503));
  await assert.rejects(lookup({ guid: GUID, url: FEED }, CREDS, { fetch: f.fetch }), (err: unknown) => {
    assert.ok(err instanceof PodcastIndexError);
    assert.equal(err.httpStatus, 503);
    assert.equal(err.isAuthError, false);
    return true;
  });

  f = fakeFetch(() => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(lookup({ url: FEED }, CREDS, { fetch: f.fetch }), /fetch failed/);
});

test('lookup needs a guid or a url, and real credentials', async () => {
  await assert.rejects(lookup({}, CREDS), TypeError);
  await assert.rejects(lookup({ guid: '  ' }, CREDS), TypeError);
  await assert.rejects(lookup({ guid: GUID }, { key: '', secret: '' }), TypeError);
});

test('addByFeedUrl is a keyed POST and reads feedId and existed', async () => {
  const f = fakeFetch(() => json({ status: 'true', feedId: 8125553, existed: 'false', description: 'Feed added.' }));
  const r = await addByFeedUrl(FEED, CREDS, { fetch: f.fetch });
  assert.deepEqual(r, { ok: true, httpStatus: 200, feedId: 8125553, existed: false, description: 'Feed added.' });
  const call = f.calls[0]!;
  assert.equal(call.method, 'POST');
  assert.ok(call.url.includes('/add/byfeedurl?'));
  assert.equal(query(call).get('url'), FEED);
  assert.equal(call.headers['x-auth-key'], CREDS.key);
  assert.equal(call.redirect, 'manual');
});

test('addByFeedUrl: 302 with a body is a success; "existed" is read', async () => {
  const r = await addByFeedUrl(FEED, CREDS, { fetch: fakeFetch(() => json({ status: 'true', feedId: '99', existed: 'true' }, 302)).fetch });
  assert.equal(r.ok, true);
  assert.equal(r.feedId, 99);
  assert.equal(r.existed, true);
});

test('addByFeedUrl explains a 401 (no write permission) and a "false" status, never throws', async () => {
  let r = await addByFeedUrl(FEED, CREDS, { fetch: fakeFetch(() => json({ status: 'false', description: 'Not authorized' }, 401)).fetch });
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 401);
  assert.match(r.error!, /write permission/);
  assert.ok(!JSON.stringify(r).includes(CREDS.key));

  r = await addByFeedUrl(FEED, CREDS, { fetch: fakeFetch(() => json({ status: 'false', description: 'Feed url is invalid.' })).fetch });
  assert.deepEqual(r, { ok: false, httpStatus: 200, description: 'Feed url is invalid.', error: 'Feed url is invalid.' });

  r = await addByFeedUrl(FEED, { key: '', secret: '' }, { fetch: fakeFetch(() => json({})).fetch });
  assert.equal(r.ok, false);
  assert.match(r.error!, /key and secret/);

  r = await addByFeedUrl('https://a.example/my feed.xml', CREDS, { fetch: fakeFetch(() => json({})).fetch });
  assert.equal(r.ok, false);
});
