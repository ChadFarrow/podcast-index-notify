import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PodcastIndexError, VERSION, podcastIndexAuthHeaders } from '../src/index.js';
import { sha1Hex } from '../src/sha1.js';

const nodeSha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

test('sha1Hex matches the FIPS 180 test vectors', () => {
  assert.equal(sha1Hex(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(
    sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '84983e441c3bd26ebaae4aa1f95129e5e54670f1'
  );
  assert.equal(sha1Hex('a'.repeat(1_000_000)), '34aa973cd4c4daa4f61eeb2bdbad27316534016f');
});

test('sha1Hex matches node:crypto at every padding edge and on Unicode', () => {
  for (let n = 0; n <= 200; n++) {
    const s = 'x'.repeat(n);
    assert.equal(sha1Hex(s), nodeSha1(s), `length ${n}`);
  }
  for (const s of ['héllo wörld', '日本語のキー', '🎵🎶 musicL', 'key\u0000with\u0000nul']) {
    assert.equal(sha1Hex(s), nodeSha1(s), s);
  }
  for (let i = 0; i < 50; i++) {
    const s = randomBytes(1 + (i * 7) % 130).toString('base64');
    assert.equal(sha1Hex(s), nodeSha1(s));
  }
});

test('podcastIndexAuthHeaders gives the four headers PI documents', () => {
  const now = 1_763_900_000_123;
  const h = podcastIndexAuthHeaders({ key: 'K', secret: 'S' }, 'App/1.0', now);
  assert.deepEqual(Object.keys(h).sort(), ['Authorization', 'User-Agent', 'X-Auth-Date', 'X-Auth-Key']);
  assert.equal(h['X-Auth-Key'], 'K');
  assert.equal(h['X-Auth-Date'], '1763900000');
  assert.equal(h.Authorization, nodeSha1('KS1763900000'));
  assert.equal(h['User-Agent'], 'App/1.0');
});

test('missing credentials throw a TypeError that does not echo a value', () => {
  for (const bad of [undefined, null, {}, { key: 'ONLYKEYVALUE' }, { key: '', secret: 'SECRETVALUE' }]) {
    assert.throws(
      () => podcastIndexAuthHeaders(bad as never, 'ua'),
      (err: unknown) => {
        assert.ok(err instanceof TypeError);
        assert.doesNotMatch(err.message, /ONLYKEYVALUE|SECRETVALUE/);
        return true;
      }
    );
  }
});

test('PodcastIndexError.isAuthError is true for 401 and 403 only', () => {
  assert.equal(new PodcastIndexError('x', 401).isAuthError, true);
  assert.equal(new PodcastIndexError('x', 403).isAuthError, true);
  assert.equal(new PodcastIndexError('x', 500).isAuthError, false);
  assert.equal(new PodcastIndexError('x').isAuthError, false);
});

test('VERSION equals the package.json version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(VERSION, pkg.version);
});
