// A sweep over every call: with failing and succeeding answers, no key, secret
// or token may appear in a request URL, in a result, in an error, or on the console.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PodcastIndexError, addByFeedUrl, checkFeed, lookup, notifyNewOrChangedFeed, podping, pubnotify, waitUntilIndexed } from '../src/index.js';
import { CREDS, FEED, TOKEN, fakeFetch, json, text, RSS } from './helpers.js';

const SECRETS = [CREDS.key, CREDS.secret, TOKEN];

function assertClean(label: string, value: unknown) {
  const s = value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value);
  for (const secret of SECRETS) assert.ok(!s.includes(secret), `${label} leaks a secret: ${s}`);
}

const answers: Array<() => Response> = [
  () => json({ status: 'true', feed: { id: 1 }, feedId: 1, message: 'enqueued' }),
  () => json({ status: 'false', description: 'Not authorized' }, 401),
  () => json({ description: 'boom' }, 500),
  () => text(RSS),
  () => {
    throw new TypeError('fetch failed');
  },
];

test('no secret reaches a URL, a result, an error or the console', async () => {
  const logged: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(original) as Array<keyof typeof original>) {
    console[k] = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
  }
  try {
    for (const answer of answers) {
      const f = fakeFetch(answer);
      const opts = { fetch: f.fetch, timeoutMs: 1_000 };
      const pusher = { endpoint: 'https://pusher.example/', token: TOKEN };

      assertClean('pubnotify', await pubnotify(FEED, opts));
      assertClean('podping', await podping(FEED, pusher, opts));
      assertClean('addByFeedUrl', await addByFeedUrl(FEED, CREDS, opts));
      assertClean('checkFeed', await checkFeed(FEED, opts));
      assertClean(
        'notify',
        await notifyNewOrChangedFeed(FEED, { ...opts, register: CREDS, podping: pusher, settleMs: 1 })
      );
      try {
        assertClean('lookup', await lookup({ guid: 'g', url: FEED }, CREDS, opts));
      } catch (err) {
        assert.ok(err instanceof PodcastIndexError);
        assertClean('lookup error', err);
      }
      assertClean('wait', await waitUntilIndexed({ url: FEED }, CREDS, { ...opts, timeoutMs: 0 }));

      for (const call of f.calls) assertClean('request URL', call.url);
    }
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(logged, [], 'the library logs nothing');
});
