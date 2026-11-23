// Find a feed's Podcast Index id with a READ key: podcasts/byguid first, then
// podcasts/byfeedurl. This is the order MSP-2.0's /api/pubnotify uses. The GUID
// is the better key: it survives a move to a new URL.

import { PodcastIndexError, type PodcastIndexCredentials, podcastIndexAuthHeaders } from './auth.js';
import { DEFAULT_USER_AGENT, PI_API_BASE, type RequestOptions, piDescription, readJsonObject, send } from './http.js';
import { normalizeFeedUrl } from './url.js';

/** A feed to look for: its podcast:guid, its URL, or both. */
export interface FeedRef {
  guid?: string;
  url?: string;
}

/**
 * The Podcast Index feed id of a feed, or null when Podcast Index does not hold it
 * (yet). Tries the GUID first, then the URL.
 *
 * Throws a PodcastIndexError when Podcast Index could not answer: a wrong key
 * (`isAuthError`), a network failure, a 5xx. "Not found" is never an error.
 */
export async function lookup(feed: FeedRef, credentials: PodcastIndexCredentials, options: RequestOptions = {}): Promise<number | null> {
  const steps = lookupSteps(feed);
  let firstError: PodcastIndexError | undefined;
  let answered = false;

  for (const path of steps) {
    const result = await lookupOne(path, credentials, options);
    if ('id' in result) {
      if (result.id !== null) return result.id;
      answered = true;
      continue;
    }
    // A wrong key fails the same way on every step: stop at once.
    if (result.error.isAuthError) throw result.error;
    firstError ??= result.error;
  }

  if (!answered && firstError) throw firstError;
  return null;
}

function lookupSteps(feed: FeedRef): string[] {
  const steps: string[] = [];
  const guid = typeof feed?.guid === 'string' ? feed.guid.trim() : '';
  const url = typeof feed?.url === 'string' ? normalizeFeedUrl(feed.url) : '';
  if (guid) steps.push(`/podcasts/byguid?${new URLSearchParams({ guid })}`);
  if (url) steps.push(`/podcasts/byfeedurl?${new URLSearchParams({ url })}`);
  if (steps.length === 0) throw new TypeError('lookup needs a feed guid or a feed url');
  return steps;
}

async function lookupOne(
  path: string,
  credentials: PodcastIndexCredentials,
  options: RequestOptions
): Promise<{ id: number | null } | { error: PodcastIndexError }> {
  const base = options.apiBase ?? PI_API_BASE;
  const { response, error } = await send(
    base + path,
    {
      method: 'GET',
      headers: podcastIndexAuthHeaders(credentials, options.userAgent ?? DEFAULT_USER_AGENT),
      // Keyed request: never follow a redirect with the X-Auth headers.
      redirect: 'manual',
    },
    options
  );
  if (!response) return { error: new PodcastIndexError(`Podcast Index lookup failed: ${error}`) };

  const body = await readJsonObject(response, 256 * 1024);
  if (response.status === 404) return { id: null };
  if (!response.ok) {
    const why = piDescription(body) ?? `HTTP ${response.status}`;
    return { error: new PodcastIndexError(`Podcast Index lookup failed: ${why}`, response.status) };
  }
  return { id: feedIdOf(body?.feed) };
}

/** PI answers `feed: {...}` on a hit and `feed: []` on a miss. */
function feedIdOf(feed: unknown): number | null {
  if (!feed || typeof feed !== 'object' || Array.isArray(feed)) return null;
  const id = (feed as { id?: unknown }).id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}
