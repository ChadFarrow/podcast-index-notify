// Read a feed before telling Podcast Index about it: does it answer 2xx, does it
// look like a feed, and does it ask not to be listed?
//
// SECURITY: checkFeed fetches the URL it is given. If your server takes feed URLs
// from users, guard against private and internal addresses (SSRF) before you
// call it, or leave the check off. This module returns a verdict, never the bytes.

import { DEFAULT_USER_AGENT, type RequestOptions, readCapped, send } from './http.js';
import { validateFeedUrl } from './url.js';

/** Enough to reach the <channel> tags of any real feed without downloading every item. */
const MAX_FEED_BYTES = 512 * 1024;

/** Podcast Index's slug in the podcast namespace's service slug list. */
export const PODCAST_INDEX_SLUG = 'podcastindex';

/**
 * True for `<itunes:block>Yes</itunes:block>` (any case). MSP-2.0 writes this tag
 * for a hidden feed, and Apple honors it.
 */
export function hasItunesBlock(xml: string): boolean {
  return /<itunes:block\s*>\s*yes\s*<\/itunes:block\s*>/i.test(xml);
}

/**
 * True when `<podcast:block>` keeps the service `slug` (default `podcastindex`)
 * from listing the feed. The order is the one the podcast namespace gives:
 *
 * 1. `<podcast:block id="slug">no</podcast:block>`: allowed.
 * 2. `<podcast:block id="slug">yes</podcast:block>`: blocked.
 * 3. `<podcast:block>yes</podcast:block>` (no id): blocked.
 */
export function hasPodcastBlock(xml: string, slug: string = PODCAST_INDEX_SLUG): boolean {
  const tags = [...xml.matchAll(/<podcast:block\b([^>]*)>\s*(yes|no)\s*<\/podcast:block\s*>/gi)];
  let forSlug: string | undefined;
  let unbounded = false;
  for (const [, attrs = '', value = ''] of tags) {
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.trim().toLowerCase();
    const yes = value.toLowerCase() === 'yes';
    if (id === undefined || id === '') {
      if (yes) unbounded = true;
    } else if (id === slug.toLowerCase()) {
      // "no" wins over "yes" for the same slug: step 1 comes first.
      forSlug = forSlug === 'no' ? 'no' : value.toLowerCase();
    }
  }
  if (forSlug === 'no') return false;
  if (forSlug === 'yes') return true;
  return unbounded;
}

/**
 * True when the feed asks not to be listed by Podcast Index: an `<itunes:block>`
 * yes, or a `<podcast:block>` that blocks the `podcastindex` slug. Such a feed is
 * pinged (so a directory that lists it reads it again and drops it) but never
 * registered.
 */
export function feedBlocksIndexing(xml: string, slug: string = PODCAST_INDEX_SLUG): boolean {
  return hasItunesBlock(xml) || hasPodcastBlock(xml, slug);
}

/** True when the text starts like an RSS or Atom feed. */
export function looksLikeFeed(text: string): boolean {
  return /<rss[\s>]|<feed[\s>]|<channel[\s>]/i.test(text.slice(0, 64 * 1024));
}

export interface FeedCheckResult {
  /** True when the feed answered 2xx and looks like RSS or Atom. */
  ok: boolean;
  httpStatus?: number;
  looksLikeFeed?: boolean;
  /** True when the feed asks not to be listed (see feedBlocksIndexing). */
  blocked?: boolean;
  error?: string;
}

/**
 * Fetch a feed once and report whether Podcast Index could use it. Never throws,
 * never returns the feed's content. Read the SECURITY note at the top of this file.
 */
export async function checkFeed(feedUrl: string, options: RequestOptions = {}): Promise<FeedCheckResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return { ok: false, error: checked.error };

  const { response, error } = await send(
    checked.url,
    {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    },
    options
  );
  if (!response) return { ok: false, error: `feed could not be fetched: ${error}` };

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const blockedByHost = response.status === 401 || response.status === 403 || response.status === 429;
    return {
      ok: false,
      httpStatus: response.status,
      error: blockedByHost
        ? `feed host answered HTTP ${response.status}: bot protection or a firewall may block crawlers, so Podcast Index would be blocked too`
        : `feed answered HTTP ${response.status}`,
    };
  }

  const text = await readCapped(response, MAX_FEED_BYTES);
  const isFeed = looksLikeFeed(text);
  const blocked = feedBlocksIndexing(text);
  return {
    ok: isFeed,
    httpStatus: response.status,
    looksLikeFeed: isFeed,
    blocked,
    ...(isFeed ? {} : { error: 'the URL answered, but the answer does not look like an RSS or Atom feed' }),
  };
}
