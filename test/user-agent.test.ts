import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { DEFAULT_USER_AGENT } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
  repository: { url: string };
};

test('DEFAULT_USER_AGENT has the form <name>/<version> (+<link>)', () => {
  assert.match(DEFAULT_USER_AGENT, /^[a-z][a-z0-9.-]*\/\d+\.\d+\.\d+ \(\+https:\/\/[^\s()]+\)$/);
});

test('DEFAULT_USER_AGENT names this package, its version and its public repo', () => {
  const repo = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  assert.equal(DEFAULT_USER_AGENT, `${pkg.name}/${pkg.version} (+${repo})`);
});

test('DEFAULT_USER_AGENT has no email and imitates no browser', () => {
  assert.ok(!DEFAULT_USER_AGENT.includes('@'));
  assert.doesNotMatch(DEFAULT_USER_AGENT, /mozilla|chrome|safari|applewebkit|gecko/i);
});
