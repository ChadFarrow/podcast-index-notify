// Podcast Index keyed-request headers.
//
// The key and the secret go ONLY into these headers. This library never puts
// them in a URL, a log line or an error message, and it never sends them to
// hub/pubnotify (which needs no key).

import { sha1Hex } from './sha1.js';

/** A Podcast Index API key pair. Get one at https://api.podcastindex.org. */
export interface PodcastIndexCredentials {
  key: string;
  secret: string;
}

/**
 * The four headers Podcast Index wants on a keyed request:
 * X-Auth-Key, X-Auth-Date (unix seconds), Authorization = sha1(key + secret + date)
 * as hex, and User-Agent.
 */
export function podcastIndexAuthHeaders(
  credentials: PodcastIndexCredentials,
  userAgent: string,
  nowMs: number = Date.now()
): Record<string, string> {
  assertCredentials(credentials);
  const date = Math.floor(nowMs / 1000).toString();
  return {
    'X-Auth-Key': credentials.key,
    'X-Auth-Date': date,
    Authorization: sha1Hex(credentials.key + credentials.secret + date),
    'User-Agent': userAgent,
  };
}

/** Throws a TypeError that names the missing part, never its value. */
export function assertCredentials(credentials: unknown): asserts credentials is PodcastIndexCredentials {
  const c = credentials as Partial<PodcastIndexCredentials> | null | undefined;
  if (!c || typeof c.key !== 'string' || !c.key || typeof c.secret !== 'string' || !c.secret) {
    throw new TypeError('Podcast Index credentials need a non-empty key and secret');
  }
}

/**
 * A keyed Podcast Index call failed. `httpStatus` is set when PI answered.
 * The message holds PI's description or the network error, never a key.
 */
export class PodcastIndexError extends Error {
  readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'PodcastIndexError';
    this.httpStatus = httpStatus;
  }

  /** 401 or 403: the key pair is wrong, or lacks the permission. Trying again will not help. */
  get isAuthError(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403;
  }
}
