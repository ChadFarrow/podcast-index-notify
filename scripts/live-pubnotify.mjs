#!/usr/bin/env node
// OPT-IN LIVE TEST. Sends ONE keyless hub/pubnotify to the real Podcast Index for
// the feed URL you give, and prints the answer. Nothing else: no key, no add, no
// podping, no lookup.
//
//   npm run live:pubnotify -- <feed-url> --yes [--user-agent "MyApp/1.0"]
//
// Without --yes it only prints what it would send. A pubnotify for a URL that
// Podcast Index does not hold can add that URL to the index, and Podcast Index has
// no delete. Run it only for a feed you mean to list. CI never runs this script.

import { DEFAULT_USER_AGENT, pubnotify, validateFeedUrl } from '../dist/index.js';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const uaIndex = args.indexOf('--user-agent');
const userAgent = uaIndex >= 0 ? args[uaIndex + 1] : DEFAULT_USER_AGENT;
const feedUrl = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--user-agent');

if (!feedUrl) {
  console.error('Usage: npm run live:pubnotify -- <feed-url> --yes [--user-agent "MyApp/1.0"]');
  process.exit(2);
}

const checked = validateFeedUrl(feedUrl);
if (!checked.ok) {
  console.error(`Refused: ${checked.error}`);
  process.exit(2);
}

console.log(`Feed:       ${checked.url}`);
console.log(`Request:    GET https://api.podcastindex.org/api/1.0/hub/pubnotify?url=...`);
console.log(`User-Agent: ${userAgent}`);
console.log('Headers:    User-Agent only (no key)');

if (!yes) {
  console.log('\nNot sent. Add --yes to send this ONE request.');
  console.log('A pubnotify for an unknown URL can add it to Podcast Index for good.');
  process.exit(1);
}

const sentAt = new Date();
const result = await pubnotify(checked.url, { userAgent });
console.log(`\nSent at:    ${sentAt.toISOString()}`);
console.log(`Result:     ${JSON.stringify(result)}`);
console.log('\nA 200 answer does not mean that Podcast Index will add a new feed.');
console.log('If it adds one, that can take up to about 15 minutes. If it does not, use https://podcastindex.org/add');
process.exit(result.ok ? 0 : 1);
