// The one call most apps want after they save a feed: tell Podcast Index (and,
// optionally, podping readers) that the feed is new or changed.
//
// The order is MSP-2.0's (api/_utils/feedUtils.ts, notifyPodcastIndex and
// schedulePodping):
//
// 1. Check the URL (and, if asked, fetch the feed: 2xx, looks like a feed, block tags).
// 2. pubnotify now. Keyless.
// 3. OPTIONAL, only with a write key: add/byfeedurl. Skipped for a blocked feed.
// 4. With `settleMs`: wait, then pubnotify again. A host behind a cache can serve
//    the old copy for a while, and the first crawl may have read it.
// 5. With `podping`: ask your pusher to send a podping (after the wait, so readers
//    that fetch within seconds get the new bytes).
//
// A blocked feed (<itunes:block>yes or <podcast:block>yes) is still pinged: that
// makes a directory that lists it read it again and drop it. It is never registered.

import { type AddResult, addByFeedUrl } from './add.js';
import type { PodcastIndexCredentials } from './auth.js';
import { type FeedCheckResult, checkFeed } from './feed.js';
import { type RequestOptions, sleep } from './http.js';
import { type PodpingReason, type PodpingResult, type PodpingTarget, podping } from './podping.js';
import { type PubnotifyResult, pubnotify } from './pubnotify.js';
import type { Throttle } from './throttle.js';
import { validateFeedUrl } from './url.js';

export interface NotifyOptions extends RequestOptions {
  /**
   * Fetch the feed first. Nothing is sent unless it answers 2xx and looks like
   * RSS or Atom; the block tags are read too. Default false. Read the SSRF note
   * in feed.ts before you turn it on for URLs that users type.
   */
  checkFeed?: boolean;
  /**
   * Wait this long, then send a second pubnotify (and the podping). Use it when
   * your host caches the feed: MSP-2.0 waits 100 000 ms for its blob CDN and edge
   * cache. Default 0: no wait, no second pubnotify.
   */
  settleMs?: number;
  /** Send a podping through your pusher. Default: no podping. */
  podping?: PodpingTarget;
  /** The feed's medium, passed to the podping ("music", "musicL", "podcast", ...). */
  medium?: string;
  /** The podping reason. Default `update`. */
  reason?: PodpingReason;
  /**
   * OPTIONAL, and only for a key with the WRITE permission: also call
   * add/byfeedurl. Turns on `checkFeed`, so a blocked feed is never registered.
   * You do not need it: the pubnotify alone gets a new feed into the index.
   */
  register?: PodcastIndexCredentials;
  /** Skip a URL this throttle has seen within its window (see createThrottle). */
  throttle?: Throttle;
}

export interface NotifyResult {
  /** True when the first pubnotify succeeded. */
  ok: boolean;
  /** The normalized feed URL that was sent. */
  url?: string;
  /** Why nothing was sent, or why the first pubnotify failed. */
  error?: string;
  /** Set when the throttle stopped this call. Nothing was sent. */
  skipped?: 'throttled';
  feedCheck?: FeedCheckResult;
  /** True when the feed asks not to be listed. It was pinged, not registered. */
  blocked?: boolean;
  pubnotify?: PubnotifyResult;
  add?: AddResult;
  secondPubnotify?: PubnotifyResult;
  podping?: PodpingResult;
}

/**
 * Tell Podcast Index that a feed is new or changed. Never throws.
 *
 * With `settleMs` the promise takes that long. On a serverless platform, keep the
 * function alive for it: Next.js `after(() => notifyNewOrChangedFeed(...))`, or
 * Vercel `waitUntil(...)`.
 */
export async function notifyNewOrChangedFeed(feedUrl: string, options: NotifyOptions = {}): Promise<NotifyResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return { ok: false, error: checked.error };
  const url = checked.url;

  if (options.throttle && !options.throttle.check(url)) {
    return { ok: false, url, skipped: 'throttled', error: 'this feed was notified a moment ago' };
  }

  const result: NotifyResult = { ok: false, url };

  if (options.checkFeed || options.register) {
    result.feedCheck = await checkFeed(url, options);
    if (!result.feedCheck.ok) {
      result.error = result.feedCheck.error ?? 'the feed check failed';
      // Nothing was sent, so a fixed feed may try again at once.
      options.throttle?.clear(url);
      return result;
    }
    result.blocked = Boolean(result.feedCheck.blocked);
  }

  result.pubnotify = await pubnotify(url, options);
  result.ok = result.pubnotify.ok;
  if (!result.ok) result.error = result.pubnotify.error;

  if (options.register && !result.blocked) {
    result.add = await addByFeedUrl(url, options.register, options);
  }

  const settleMs = options.settleMs ?? 0;
  if (settleMs > 0) {
    await sleep(settleMs, options.signal);
    if (options.signal?.aborted) return result;
    result.secondPubnotify = await pubnotify(url, options);
  }

  if (options.podping) {
    result.podping = await podping(url, options.podping, {
      ...options,
      reason: options.reason ?? 'update',
      medium: options.medium,
    });
  }

  return result;
}
