// The same calls through Node's real fetch, against a server on 127.0.0.1 that
// this test starts and stops. It checks what a mock cannot: the bytes and headers
// on the wire, redirect handling, and that Node's fetch accepts every option sent.

import assert from 'node:assert/strict';
import { type IncomingHttpHeaders, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

import { checkFeed, lookup, notifyNewOrChangedFeed, podping, pubnotify } from '../src/index.js';
import { CREDS, RSS, TOKEN, rssWith } from './helpers.js';

interface Seen {
  path: string;
  method: string;
  headers: IncomingHttpHeaders;
}

const seen: Seen[] = [];
let base = '';

const server = createServer((req, res) => {
  const path = req.url ?? '';
  seen.push({ path, method: req.method ?? '', headers: req.headers });
  const send = (status: number, body: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(body);
  };
  if (path.startsWith('/api/1.0/hub/pubnotify')) return send(200, '{"status":"true","description":"Feed marked for immediate update."}');
  if (path.startsWith('/api/1.0/podcasts/byguid')) return send(302, '{}', { Location: '/stolen-by-redirect' });
  if (path.startsWith('/api/1.0/podcasts/byfeedurl')) return send(200, '{"status":"true","feed":{"id":4242}}');
  if (path.startsWith('/pusher-redirect')) return send(302, '{}', { Location: '/stolen-by-redirect' });
  if (path.startsWith('/pusher')) return send(200, '{"message":"enqueued"}');
  if (path === '/feed.xml') return send(200, RSS, { 'Content-Type': 'application/rss+xml' });
  if (path === '/big-blocked.xml') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.write(rssWith('<podcast:block>yes</podcast:block>').replace('</channel>\n</rss>', ''));
    // About 2 MB of items: checkFeed must stop reading long before the end.
    const item = `<item><title>${'x'.repeat(1000)}</title></item>\n`;
    for (let i = 0; i < 2000; i++) res.write(item);
    return res.end('</channel></rss>');
  }
  return send(404, '{}');
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const last = () => seen[seen.length - 1]!;

test('real fetch: pubnotify sends no key header on the wire', async () => {
  const r = await pubnotify(`${base}/feed.xml`, { apiBase: `${base}/api/1.0`, userAgent: 'WireTest/1.0' });
  assert.equal(r.ok, true);
  const s = last();
  assert.equal(s.method, 'GET');
  assert.equal(new URL(s.path, base).searchParams.get('url'), `${base}/feed.xml`);
  assert.equal(s.headers['user-agent'], 'WireTest/1.0');
  for (const h of ['x-auth-key', 'x-auth-date', 'authorization']) assert.equal(s.headers[h], undefined, h);
});

test('real fetch: lookup does not follow a redirect with the key headers', async () => {
  const before = seen.length;
  const id = await lookup({ guid: 'some-guid', url: `${base}/feed.xml` }, CREDS, { apiBase: `${base}/api/1.0` });
  assert.equal(id, 4242, 'the byguid 302 is skipped and byfeedurl answers');
  const paths = seen.slice(before).map((s) => s.path);
  assert.equal(paths.length, 2);
  assert.ok(!paths.some((p) => p.startsWith('/stolen-by-redirect')));
  const keyed = seen[seen.length - 1]!;
  assert.equal(keyed.headers['x-auth-key'], CREDS.key);
  assert.match(String(keyed.headers.authorization), /^[0-9a-f]{40}$/);
});

test('real fetch: podping refuses to follow a redirect with the token', async () => {
  const before = seen.length;
  const r = await podping(`${base}/feed.xml`, { endpoint: `${base}/pusher-redirect`, token: TOKEN });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.ok(!seen.slice(before).some((s) => s.path.startsWith('/stolen-by-redirect')));

  const ok = await podping(`${base}/feed.xml`, { endpoint: `${base}/pusher`, token: TOKEN }, { medium: 'music' });
  assert.deepEqual(ok, { ok: true, httpStatus: 200, message: 'enqueued' });
  assert.equal(last().headers.authorization, `Bearer ${TOKEN}`);
});

test('real fetch: checkFeed reads a big feed only in part and sees the block', async () => {
  const r = await checkFeed(`${base}/big-blocked.xml`);
  assert.deepEqual(r, { ok: true, httpStatus: 200, looksLikeFeed: true, blocked: true });
});

test('real fetch: the whole notify flow', async () => {
  const r = await notifyNewOrChangedFeed(`${base}/feed.xml`, {
    apiBase: `${base}/api/1.0`,
    checkFeed: true,
    settleMs: 10,
    podping: { endpoint: `${base}/pusher`, token: TOKEN },
    medium: 'musicL',
  });
  assert.equal(r.ok, true);
  assert.equal(r.secondPubnotify?.ok, true);
  assert.equal(r.podping?.ok, true);
  assert.equal(new URL(last().path, base).searchParams.get('medium'), 'musicL');
});
