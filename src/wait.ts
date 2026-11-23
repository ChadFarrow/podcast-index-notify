// Wait for Podcast Index to hold a feed. When PI adds a new feed, that can take
// up to about 15 minutes after the notification. PI may also not add a brand-new
// feed at all (see pubnotify.ts). "Not found yet" is the normal answer for a
// while: it is never a failure here.

import type { PodcastIndexCredentials } from './auth.js';
import { PodcastIndexError } from './auth.js';
import { type RequestOptions, errorMessage, sleep as realSleep } from './http.js';
import { type FeedRef, lookup } from './lookup.js';

/** 15 minutes: the default wait. When Podcast Index adds a new feed, that can take up to about this long. */
export const DEFAULT_INDEX_WAIT_MS = 15 * 60 * 1000;

export interface WaitOptions extends RequestOptions {
  /** Give up after this long. Default 15 minutes. */
  timeoutMs?: number;
  /** The pause after the first check. Default 5 000 ms. */
  initialDelayMs?: number;
  /** The longest pause between checks. Default 60 000 ms. */
  maxDelayMs?: number;
  /** Each pause is this many times the one before. Default 2. */
  backoffFactor?: number;
  /** Called after each check: the attempt number, and the id or null. */
  onAttempt?: (attempt: number, id: number | null, error?: string) => void;
  /** For tests: a clock and a sleep. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type WaitResult =
  | { status: 'indexed'; id: number; attempts: number; elapsedMs: number }
  /**
   * Podcast Index does not hold the feed yet. Not a failure: it may still come.
   * A brand-new feed may need addByFeedUrl (a WRITE key) or the form at
   * https://podcastindex.org/add.
   */
  | { status: 'timeout'; attempts: number; elapsedMs: number; lastError?: string }
  /** The caller's signal stopped the wait. */
  | { status: 'aborted'; attempts: number; elapsedMs: number }
  /** The key pair was refused (HTTP 401 or 403). Waiting longer will not help. */
  | { status: 'error'; attempts: number; elapsedMs: number; error: string; httpStatus?: number };

/**
 * Check Podcast Index for the feed now, then again with growing pauses
 * (5 s, 10 s, 20 s, 40 s, then every 60 s), until it is there or the time is up.
 * Uses a READ key (lookup by GUID, then by URL). Never throws for a network
 * failure or a 5xx: those count as "not yet", and the last one is in `lastError`.
 */
export async function waitUntilIndexed(
  feed: FeedRef,
  credentials: PodcastIndexCredentials,
  options: WaitOptions = {}
): Promise<WaitResult> {
  const now = options.now ?? Date.now;
  const pause = options.sleep ?? realSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_INDEX_WAIT_MS;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const factor = options.backoffFactor ?? 2;
  let delay = options.initialDelayMs ?? 5_000;

  const start = now();
  const deadline = start + timeoutMs;
  let attempts = 0;
  let lastError: string | undefined;

  for (;;) {
    if (options.signal?.aborted) return { status: 'aborted', attempts, elapsedMs: now() - start };

    attempts++;
    let id: number | null = null;
    try {
      id = await lookup(feed, credentials, options);
      lastError = undefined;
    } catch (err) {
      if (err instanceof PodcastIndexError && err.isAuthError) {
        return { status: 'error', attempts, elapsedMs: now() - start, error: err.message, httpStatus: err.httpStatus };
      }
      if (!(err instanceof PodcastIndexError)) throw err; // a TypeError: no guid and no url
      lastError = errorMessage(err);
    }
    options.onAttempt?.(attempts, id, lastError);
    if (id !== null) return { status: 'indexed', id, attempts, elapsedMs: now() - start };

    const left = deadline - now();
    if (left <= 0) {
      return { status: 'timeout', attempts, elapsedMs: now() - start, ...(lastError ? { lastError } : {}) };
    }
    await pause(Math.min(delay, left), options.signal);
    delay = Math.min(delay * factor, maxDelayMs);
  }
}
