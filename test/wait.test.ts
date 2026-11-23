import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_INDEX_WAIT_MS, waitUntilIndexed } from '../src/index.js';
import { CREDS, FEED, fakeFetch, json } from './helpers.js';

/** A fake clock that a fake sleep moves forward. */
function clock() {
  let t = 0;
  const pauses: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      pauses.push(ms);
      t += ms;
    },
    pauses,
  };
}

const miss = () => json({ status: 'true', feed: [] });

test('the default wait is 15 minutes', () => {
  assert.equal(DEFAULT_INDEX_WAIT_MS, 900_000);
});

test('waitUntilIndexed returns the id once PI holds the feed', async () => {
  const c = clock();
  let n = 0;
  const f = fakeFetch(() => (++n >= 3 ? json({ status: 'true', feed: { id: 123 } }) : miss()));
  const seen: Array<[number, number | null]> = [];
  const r = await waitUntilIndexed({ url: FEED }, CREDS, {
    fetch: f.fetch,
    now: c.now,
    sleep: c.sleep,
    onAttempt: (a, id) => seen.push([a, id]),
  });
  assert.deepEqual(r, { status: 'indexed', id: 123, attempts: 3, elapsedMs: 15_000 });
  assert.deepEqual(c.pauses, [5_000, 10_000]);
  assert.deepEqual(seen, [[1, null], [2, null], [3, 123]]);
});

test('waitUntilIndexed checks at once: an indexed feed needs no pause', async () => {
  const c = clock();
  const r = await waitUntilIndexed({ url: FEED }, CREDS, {
    fetch: fakeFetch(() => json({ status: 'true', feed: { id: 9 } })).fetch,
    now: c.now,
    sleep: c.sleep,
  });
  assert.deepEqual(r, { status: 'indexed', id: 9, attempts: 1, elapsedMs: 0 });
  assert.deepEqual(c.pauses, []);
});

test('"not yet" for 15 minutes is a timeout, not an error; the backoff caps at 60 s', async () => {
  const c = clock();
  const r = await waitUntilIndexed({ url: FEED }, CREDS, { fetch: fakeFetch(miss).fetch, now: c.now, sleep: c.sleep });
  assert.equal(r.status, 'timeout');
  assert.equal(r.elapsedMs, 900_000);
  assert.deepEqual(c.pauses.slice(0, 6), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  assert.ok(c.pauses.every((p) => p <= 60_000));
  assert.equal(c.pauses.reduce((a, b) => a + b, 0), 900_000, 'the last pause is cut to the deadline');
  assert.equal(r.attempts, c.pauses.length + 1, 'one last check at the deadline');
  assert.ok(!('lastError' in r));
});

test('network errors and 5xx count as "not yet"; the last one is reported', async () => {
  const c = clock();
  const r = await waitUntilIndexed({ url: FEED }, CREDS, {
    fetch: fakeFetch(() => json({ description: 'busy' }, 503)).fetch,
    now: c.now,
    sleep: c.sleep,
    timeoutMs: 30_000,
  });
  assert.equal(r.status, 'timeout');
  assert.ok(r.status === 'timeout' && /busy/.test(r.lastError ?? ''));
});

test('a refused key stops the wait at once with status error', async () => {
  const c = clock();
  const r = await waitUntilIndexed({ guid: 'g', url: FEED }, CREDS, {
    fetch: fakeFetch(() => json({ description: 'Authorization header is not valid' }, 401)).fetch,
    now: c.now,
    sleep: c.sleep,
  });
  assert.equal(r.status, 'error');
  assert.equal(r.attempts, 1);
  assert.ok(r.status === 'error' && r.httpStatus === 401);
  assert.ok(!JSON.stringify(r).includes(CREDS.key));
});

test('the caller signal stops the wait', async () => {
  const controller = new AbortController();
  const c = clock();
  let calls = 0;
  const r = await waitUntilIndexed({ url: FEED }, CREDS, {
    fetch: fakeFetch(() => {
      if (++calls === 2) controller.abort();
      return miss();
    }).fetch,
    now: c.now,
    sleep: c.sleep,
    signal: controller.signal,
  });
  assert.equal(r.status, 'aborted');
  assert.equal(r.attempts, 2);
});

test('the real sleep is used when none is given (short timeout)', async () => {
  const r = await waitUntilIndexed({ url: FEED }, CREDS, {
    fetch: fakeFetch(miss).fetch,
    timeoutMs: 30,
    initialDelayMs: 10,
  });
  assert.equal(r.status, 'timeout');
  assert.ok(r.attempts >= 2);
});
