import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkFeed, createThrottle, feedBlocksIndexing, hasItunesBlock, hasPodcastBlock, looksLikeFeed } from '../src/index.js';
import { FEED, RSS, fakeFetch, rssWith, text } from './helpers.js';

test('hasItunesBlock: yes in any case and spacing; no is not a block', () => {
  assert.equal(hasItunesBlock('<itunes:block>Yes</itunes:block>'), true);
  assert.equal(hasItunesBlock('<itunes:block> YES </itunes:block>'), true);
  assert.equal(hasItunesBlock('<itunes:block>no</itunes:block>'), false);
  assert.equal(hasItunesBlock(RSS), false);
});

test('hasPodcastBlock follows the podcast namespace order for the podcastindex slug', () => {
  const b = (id: string | null, v: string) => (id === null ? `<podcast:block>${v}</podcast:block>` : `<podcast:block id="${id}">${v}</podcast:block>`);
  assert.equal(hasPodcastBlock(b(null, 'yes')), true, 'unbounded yes blocks everyone');
  assert.equal(hasPodcastBlock(b(null, 'no')), false);
  assert.equal(hasPodcastBlock(b('podcastindex', 'yes')), true);
  assert.equal(hasPodcastBlock(b('google', 'yes') + b('amazon', 'yes')), false, 'other slugs only');
  assert.equal(hasPodcastBlock(b(null, 'yes') + b('podcastindex', 'no')), false, 'own "no" wins');
  assert.equal(hasPodcastBlock(b(null, 'yes') + b('google', 'no')), true);
  assert.equal(hasPodcastBlock(`<podcast:block id='PodcastIndex'>Yes</podcast:block>`), true, 'case and quotes');
  assert.equal(hasPodcastBlock(b('google', 'yes'), 'google'), true, 'another slug can be asked');
});

test('feedBlocksIndexing combines both tags', () => {
  assert.equal(feedBlocksIndexing(RSS), false);
  assert.equal(feedBlocksIndexing(rssWith('<itunes:block>yes</itunes:block>')), true);
  assert.equal(feedBlocksIndexing(rssWith('<podcast:block>yes</podcast:block>')), true);
});

test('looksLikeFeed sees RSS and Atom, not HTML', () => {
  assert.equal(looksLikeFeed(RSS), true);
  assert.equal(looksLikeFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">'), true);
  assert.equal(looksLikeFeed('<!doctype html><html><body>Just a moment...</body></html>'), false);
});

test('checkFeed: a 200 feed is ok, a blocked feed is ok but blocked', async () => {
  let f = fakeFetch(() => text(RSS));
  assert.deepEqual(await checkFeed(FEED, { fetch: f.fetch, userAgent: 'App/1' }), {
    ok: true,
    httpStatus: 200,
    looksLikeFeed: true,
    blocked: false,
  });
  assert.equal(f.calls[0]!.url, FEED);
  assert.equal(f.calls[0]!.headers['user-agent'], 'App/1');

  f = fakeFetch(() => text(rssWith('<itunes:block>Yes</itunes:block>')));
  const r = await checkFeed(FEED, { fetch: f.fetch });
  assert.equal(r.ok, true);
  assert.equal(r.blocked, true);
});

test('checkFeed: 403, 404, HTML and network failure are not ok', async () => {
  let r = await checkFeed(FEED, { fetch: fakeFetch(() => text('denied', 403, 'text/html')).fetch });
  assert.equal(r.ok, false);
  assert.equal(r.httpStatus, 403);
  assert.match(r.error!, /bot protection/);

  r = await checkFeed(FEED, { fetch: fakeFetch(() => text('gone', 404, 'text/plain')).fetch });
  assert.deepEqual(r, { ok: false, httpStatus: 404, error: 'feed answered HTTP 404' });

  r = await checkFeed(FEED, { fetch: fakeFetch(() => text('<html><body>hi</body></html>', 200, 'text/html')).fetch });
  assert.equal(r.ok, false);
  assert.equal(r.looksLikeFeed, false);

  r = await checkFeed(FEED, {
    fetch: fakeFetch(() => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    }).fetch,
  });
  assert.equal(r.ok, false);
  assert.match(r.error!, /ENOTFOUND/);

  const f = fakeFetch(() => text(RSS));
  r = await checkFeed('file:///etc/passwd', { fetch: f.fetch });
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
});

test('createThrottle lets one call per URL through per window', () => {
  let t = 1_000;
  const throttle = createThrottle({ windowMs: 60_000, now: () => t });
  assert.equal(throttle.check(FEED), true);
  assert.equal(throttle.check(FEED), false);
  assert.equal(throttle.check(` ${FEED}\n`), false, 'normalized key');
  assert.equal(throttle.check('https://other.example/f.xml'), true);
  t += 59_999;
  assert.equal(throttle.check(FEED), false);
  t += 1;
  assert.equal(throttle.check(FEED), true, 'the window ended');
  throttle.clear(FEED);
  assert.equal(throttle.check(FEED), true);
  throttle.clear();
  assert.equal(throttle.size, 0);
});

test('createThrottle forgets the oldest URL past maxEntries', () => {
  const throttle = createThrottle({ maxEntries: 2 });
  throttle.check('https://a.example/1.xml');
  throttle.check('https://a.example/2.xml');
  throttle.check('https://a.example/3.xml');
  assert.equal(throttle.size, 2);
  assert.equal(throttle.check('https://a.example/1.xml'), true, 'the oldest was dropped');
  assert.equal(throttle.check('https://a.example/3.xml'), false);
});
