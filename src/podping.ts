// Podping through a podping-hivepinger style pusher that YOU run (for example
// ChadFarrow/msp-podping-service). This library holds no Hive key: it asks the
// pusher to send, exactly as MSP-2.0's notifyPodping does:
//
//   GET {endpoint}?url=<feed>&reason=<reason>&medium=<medium>
//   Authorization: Bearer <token>
//
// The token goes only into that header. It is never put in a URL or an error, and
// the request uses `redirect: 'error'`, so a redirect cannot carry the token to
// another host. The endpoint must be https (plain http only on localhost).
//
// `medium` matters. The pusher names the Hive op `pp_<medium>_<reason>`, and a
// reader may watch only some media: the msp-podping-service consumer reads only
// `pp_music_*`. With no medium the op is `pp_podcast_*`. Pass the feed's
// <podcast:medium> value ("music", "musicL", "podcast", ...).
//
// A podping is written to the Hive blockchain: it is public and permanent.

import { DEFAULT_USER_AGENT, type RequestOptions, readJsonObject, send } from './http.js';
import { validateFeedUrl } from './url.js';

/** The podping reasons. `update` is the usual one. */
export type PodpingReason = 'update' | 'live' | 'liveEnd' | (string & {});

/** Where to send podpings, and the bearer token the pusher wants. */
export interface PodpingTarget {
  /** The pusher's URL, for example `https://my-pusher.example/`. https only (http on localhost). */
  endpoint: string;
  /** The pusher's bearer token. Only ever sent in the Authorization header. */
  token: string;
}

export interface PodpingOptions extends RequestOptions {
  /** Default `update`. */
  reason?: PodpingReason;
  /** The feed's medium, for example `music` or `musicL`. See the note above. */
  medium?: string;
}

export interface PodpingResult {
  /** True when the pusher answered 2xx. "duplicate" is a success: the pusher already queued it. */
  ok: boolean;
  httpStatus?: number;
  /** The pusher's one-word answer, for example "enqueued" or "duplicate". */
  message?: string;
  error?: string;
}

/** Ask your podping pusher to announce a feed change on Hive. Never throws. */
export async function podping(feedUrl: string, target: PodpingTarget, options: PodpingOptions = {}): Promise<PodpingResult> {
  const checked = validateFeedUrl(feedUrl);
  if (!checked.ok) return { ok: false, error: checked.error };
  if (!target || typeof target.token !== 'string' || !target.token) {
    return { ok: false, error: 'podping needs a pusher token' };
  }

  const requestUrl = podpingRequestUrl(target.endpoint, checked.url, options);
  if ('error' in requestUrl) return { ok: false, error: requestUrl.error };

  const { response, error } = await send(
    requestUrl.url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
      },
      redirect: 'error',
    },
    options
  );
  if (!response) return { ok: false, error };

  const body = await readJsonObject(response, 16 * 1024);
  const raw = body?.message ?? body?.error;
  const message = typeof raw === 'string' && raw ? raw.slice(0, 120) : undefined;
  return {
    ok: response.ok,
    httpStatus: response.status,
    ...(message ? { message } : {}),
    ...(response.ok ? {} : { error: message ?? `podping pusher answered HTTP ${response.status}` }),
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The pusher request URL, or why the endpoint is refused. Exported for tests. */
export function podpingRequestUrl(
  endpoint: string,
  feedUrl: string,
  options: Pick<PodpingOptions, 'reason' | 'medium'> = {}
): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { error: 'podping endpoint is not a valid URL' };
  }
  const local = parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) {
    return { error: 'podping endpoint must use https (http only on localhost)' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'podping endpoint must not contain a user name or password; pass the token instead' };
  }
  parsed.searchParams.set('url', feedUrl);
  parsed.searchParams.set('reason', options.reason ?? 'update');
  if (options.medium) parsed.searchParams.set('medium', options.medium);
  return { url: parsed.toString() };
}
