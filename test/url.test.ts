import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getFeedUrlError, normalizeFeedUrl, validateFeedUrl } from '../src/index.js';

test('normalizeFeedUrl trims paste junk from both ends only', () => {
  assert.equal(normalizeFeedUrl('  https://a.example/f.xml\n'), 'https://a.example/f.xml');
  assert.equal(normalizeFeedUrl('​https://a.example/f.xml﻿ '), 'https://a.example/f.xml');
  assert.equal(normalizeFeedUrl('\thttps://a.example/my feed.xml '), 'https://a.example/my feed.xml');
  const once = normalizeFeedUrl(' https://a.example/x ');
  assert.equal(normalizeFeedUrl(once), once);
});

test('getFeedUrlError names each bad character class, MSP-2.0 rules', () => {
  assert.equal(getFeedUrlError('https://a.example/feed.xml'), null);
  assert.equal(getFeedUrlError('  https://a.example/feed.xml  '), null, 'edge whitespace is not an error');
  assert.match(getFeedUrlError('https://a.example/my feed.xml')!, /whitespace/);
  assert.match(getFeedUrlError("https://a.example/rock'n.xml")!, /apostrophes/);
  assert.match(getFeedUrlError('https://a.example/rock’n.xml')!, /apostrophes/);
  assert.match(getFeedUrlError('https://a.example/a|b.xml')!, /special characters/);
  assert.match(getFeedUrlError('https://a.example/café.xml')!, /non-ASCII/);
  assert.equal(getFeedUrlError('https://a.example/rock%27n.xml'), null, 'pre-encoded %27 is fine');
});

test('validateFeedUrl accepts http(s) only, with no credentials', () => {
  assert.deepEqual(validateFeedUrl(' https://a.example/f.xml '), { ok: true, url: 'https://a.example/f.xml' });
  assert.equal(validateFeedUrl('http://a.example/f.xml').ok, true);
  for (const bad of ['', '   ', 'not a url', 'ftp://a.example/f.xml', 'javascript:alert(1)', 'file:///etc/passwd', '/relative.xml']) {
    assert.equal(validateFeedUrl(bad).ok, false, bad);
  }
  const creds = validateFeedUrl('https://user:pw@a.example/f.xml');
  assert.equal(creds.ok, false);
  assert.ok(!creds.ok && !creds.error.includes('pw'));
  assert.equal(validateFeedUrl(42).ok, false);
  assert.equal(validateFeedUrl('https://a.example/my feed.xml').ok, false);
});
