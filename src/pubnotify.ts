// hub/pubnotify: "this feed changed, read it now". NO KEY.
//
// Podcast Index documents hub/pubnotify as "No API key needed for this endpoint"
// (security: []). So this module sends a User-Agent and nothing else, on purpose.
// Do not add auth headers here: a key gains nothing, and a key should not travel
// where it is not needed.
//
// What it does (tested 2026-11-23): for a feed that Podcast Index already holds,
// it makes PI read the feed again now, for every medium. For a brand-new feed, PI
// MAY add it, but does not promise to. PI answers 200 "Feed marked for immediate
// update." also for a URL that it does not hold. In the tests one new feed was in
// the index about 70 s after pubnotify and podping; two others were not added
// after pubnotify and podping, and got in only by hand. Why is not known. To add a
// new feed on purpose, use add/byfeedurl with a WRITE key (add.ts) or the form at
// https://podcastindex.org/add.
//
// A pubnotify for a URL that Podcast Index does not hold can add that URL to the
// index, and Podcast Index has no delete. Send it only for a feed you mean to list.

import { DEFAULT_USER_AGENT, PI_API_BASE, type RequestOptions, piDescription, piStatusIsFalse, readJsonObject, send } from './http.js';
import { validateFeedUrl } from './url.js';

/** Name a feed by its URL, or by its Podcast Index feed id. */
export type PubnotifyTarget = string | { url: string } | { id: number };

export interface PubnotifyResult {
  /**
   * True when Podcast Index answered 2xx and did not say `status: "false"`. PI
   * answers so also for a URL that it does not hold: this is not proof that the
   * feed is in the index, or that it will be.
   */
  ok: boolean;
  /** The HTTP status, when Podcast Index answered. */
  httpStatus?: number;
  /** Podcast Index's own words, for example "Feed marked for immediate update." */
  description?: string;
  /** Why the ping did not go out or did not succeed. */
  error?: string;
}

/**
 * Ask Podcast Index to read a feed again now. Keyless: it sends only a User-Agent.
 *
 * Reliable for a feed that Podcast Index already holds. For a brand-new feed, PI
 * may add it, but does not promise to; `ok: true` only means that PI accepted the
 * ping. To add a new feed on purpose, use `addByFeedUrl` (a WRITE key) or the form
 * at https://podcastindex.org/add.
 *
 * Give the URL for a new feed. Give `{ id }` for a feed Podcast Index already
 * holds when your URL may differ from the one it stores: an unknown URL can be
 * added as a second feed. Never throws.
 */
export async function pubnotify(target: PubnotifyTarget, options: RequestOptions = {}): Promise<PubnotifyResult> {
  const query = pubnotifyQuery(target);
  if ('error' in query) return { ok: false, error: query.error };

  const base = options.apiBase ?? PI_API_BASE;
  const { response, error } = await send(
    `${base}/hub/pubnotify?${query.params}`,
    {
      method: 'GET',
      // A User-Agent and nothing else. See the note at the top of this file.
      headers: { 'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT },
    },
    options
  );
  if (!response) return { ok: false, error };

  const body = await readJsonObject(response);
  const description = piDescription(body);
  const ok = response.ok && !piStatusIsFalse(body);
  return {
    ok,
    httpStatus: response.status,
    ...(description ? { description } : {}),
    ...(ok ? {} : { error: description ?? `Podcast Index answered HTTP ${response.status}` }),
  };
}

function pubnotifyQuery(target: PubnotifyTarget): { params: string } | { error: string } {
  if (target && typeof target === 'object' && 'id' in target) {
    const id = target.id;
    if (!Number.isSafeInteger(id) || id <= 0) return { error: 'Podcast Index feed id must be a positive integer' };
    return { params: new URLSearchParams({ id: String(id) }).toString() };
  }
  const raw = typeof target === 'string' ? target : (target as { url?: unknown } | null)?.url;
  const checked = validateFeedUrl(raw);
  if (!checked.ok) return { error: checked.error };
  return { params: new URLSearchParams({ url: checked.url }).toString() };
}
