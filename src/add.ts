// OPTIONAL. add/byfeedurl, for callers that HAVE a Podcast Index key with the
// WRITE permission. Nothing in this library calls it unless you ask.
//
// You do not need it to get a new feed into Podcast Index: a keyless pubnotify
// does that (it can take up to about 15 minutes). A read-only key gets HTTP 401
// here. add/byfeedurl only queues the URL; Podcast Index makes the record after
// its crawler reads the feed, so a new feed often comes back with no id yet.
//
// Do not call it for a feed with <itunes:block>yes or <podcast:block>yes: that
// feed asks not to be listed. notifyNewOrChangedFeed skips it for such a feed.

import { type PodcastIndexCredentials, podcastIndexAuthHeaders } from './auth.js';
import { DEFAULT_USER_AGENT, PI_API_BASE, type RequestOptions, errorMessage, piDescription, piStatusIsFalse, readJsonObject, send } from './http.js';
import { validateFeedUrl } from './url.js';

export interface AddResult {
  /** True when Podcast Index accepted the URL (HTTP 2xx or 302, and not `status: "false"`). */
  ok: boolean;
  /** The feed id, when Podcast Index gave one. A new feed often has none yet. */
  feedId?: number;
  /** True when the feed was already in the index. */
  existed?: boolean;
  httpStatus?: number;
  description?: string;
  /** Why it failed. A 401 means the key has no write permission (or is wrong). */
  error?: string;
}

/**
 * OPTIONAL: register a feed URL with Podcast Index. Needs a key with the WRITE
 * permission. Never throws; a refusal comes back as `ok: false` with PI's reason.
 */
export async function addByFeedUrl(feedUrl: string, writeCredentials: PodcastIndexCredentials, options: RequestOptions = {}): Promise<AddResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return { ok: false, error: checked.error };

  let headers: Record<string, string>;
  try {
    headers = podcastIndexAuthHeaders(writeCredentials, options.userAgent ?? DEFAULT_USER_AGENT);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }

  const base = options.apiBase ?? PI_API_BASE;
  const { response, error } = await send(
    `${base}/add/byfeedurl?${new URLSearchParams({ url: checked.url })}`,
    {
      method: 'POST',
      headers,
      // PI documents a 302 answer with the same JSON body. Read it; never follow
      // a redirect with the X-Auth headers.
      redirect: 'manual',
    },
    options
  );
  if (!response) return { ok: false, error };

  const body = await readJsonObject(response);
  const description = piDescription(body);
  const accepted = (response.ok || response.status === 302) && !piStatusIsFalse(body);
  const feedId = positiveInt(body?.feedId) ?? positiveInt((body?.feed as { id?: unknown } | undefined)?.id);
  const existed = body?.existed === 'true' || body?.existed === true;

  return {
    ok: accepted,
    httpStatus: response.status,
    ...(feedId ? { feedId } : {}),
    ...(accepted ? { existed } : {}),
    ...(description ? { description } : {}),
    ...(accepted
      ? {}
      : {
          error:
            response.status === 401
              ? 'Podcast Index refused the key (HTTP 401): add/byfeedurl needs a key with the write permission'
              : (description ?? `Podcast Index answered HTTP ${response.status}`),
        }),
  };
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
