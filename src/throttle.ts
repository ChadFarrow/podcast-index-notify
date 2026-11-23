// A per-URL dedupe: one notification per feed URL per time window.
//
// It lives in memory, so it holds per process (on serverless, per warm instance).
// It stops a burst of saves from sending a burst of pings; it is not a global
// rate limit.

import { normalizeFeedUrl } from './url.js';

export interface ThrottleOptions {
  /** How long a URL stays blocked after it is let through. Default 60 000 ms. */
  windowMs?: number;
  /** The most URLs it remembers; the oldest go first. Default 10 000. */
  maxEntries?: number;
  /** A clock, for tests. Default Date.now. */
  now?: () => number;
}

export interface Throttle {
  /** True (and remembered) when `key` was not let through within the window; false for a repeat. */
  check(key: string): boolean;
  /** Forget one key, or every key. */
  clear(key?: string): void;
  /** How many keys it remembers now. */
  readonly size: number;
}

export function createThrottle(options: ThrottleOptions = {}): Throttle {
  const windowMs = options.windowMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  // Insertion order is age order, because a re-allowed key is deleted and set again.
  const seen = new Map<string, number>();

  const keyOf = (key: string) => normalizeFeedUrl(key);

  return {
    check(key: string): boolean {
      const k = keyOf(key);
      const t = now();
      const last = seen.get(k);
      if (last !== undefined && t - last < windowMs) return false;
      seen.delete(k);
      seen.set(k, t);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next().value as string;
        seen.delete(oldest);
      }
      return true;
    },
    clear(key?: string): void {
      if (key === undefined) seen.clear();
      else seen.delete(keyOf(key));
    },
    get size() {
      return seen.size;
    },
  };
}
