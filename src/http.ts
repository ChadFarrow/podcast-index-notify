// Shared plumbing for every request this library sends: one fetch, a timeout,
// the caller's abort signal, and a capped read of the answer.
//
// Nothing here logs. A failure becomes a value the caller can read, and no error
// text is built from request headers, so a key or a token cannot end up in one.

import { VERSION } from './version.js';

/** The Podcast Index API root. */
export const PI_API_BASE = 'https://api.podcastindex.org/api/1.0';

/** This package's public home, named in DEFAULT_USER_AGENT. Not exported from index.ts. */
export const HOMEPAGE_URL = 'https://github.com/ChadFarrow/podcast-index-notify';

/**
 * Sent when the caller gives no User-Agent. Podcast Index asks every client to name
 * itself, so an app should pass its own `options.userAgent`: `<AppName>/<version> (+<link>)`.
 */
export const DEFAULT_USER_AGENT = `podcast-index-notify/${VERSION} (+${HOMEPAGE_URL})`;

/** How long one request may take, unless the caller says otherwise. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Options that every network call in this library accepts. */
export interface RequestOptions {
  /**
   * Names your app to Podcast Index (and to the podping pusher and the feed host).
   * Podcast Index asks for one, for example `"MyApp/1.2 (+https://myapp.example)"`.
   * Default: `podcast-index-notify/<version>`.
   */
  userAgent?: string;
  /** Per-request timeout in milliseconds. Default 10 000. */
  timeoutMs?: number;
  /** Stops the request when it fires. */
  signal?: AbortSignal;
  /** A fetch to use instead of the global one (tests, proxies, custom agents). */
  fetch?: typeof fetch;
  /** The Podcast Index API root. Default `https://api.podcastindex.org/api/1.0`. For tests and mirrors. */
  apiBase?: string;
}

export interface SendResult {
  response?: Response;
  /** Set when no response came back: a network failure, a timeout or an abort. */
  error?: string;
  /** True when the caller's signal (not the timeout) ended the request. */
  aborted?: boolean;
}

/**
 * Send one request and never throw. The timeout and the caller's signal both
 * abort it. AbortSignal.any is Node 20+, so the two are joined by hand.
 */
export async function send(
  url: string,
  init: RequestInit,
  options: Pick<RequestOptions, 'timeoutMs' | 'signal' | 'fetch'>
): Promise<SendResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    return { error: 'no fetch available: use Node 18 or newer, or pass options.fetch' };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const outer = options.signal;
  if (outer?.aborted) return { error: 'aborted', aborted: true };

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    // no-store: Next.js 14 caches a plain GET fetch on the server by default, and
    // a cached pubnotify or lookup never reaches Podcast Index.
    const response = await doFetch(url, { cache: 'no-store', ...init, signal: controller.signal });
    return { response };
  } catch (err) {
    if (timedOut) return { error: `timed out after ${timeoutMs} ms` };
    if (outer?.aborted) return { error: 'aborted', aborted: true };
    // A fetch error names the cause ("fetch failed", "ECONNREFUSED"), never the
    // request headers, so it is safe to pass on.
    return { error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}

/** Read at most `maxBytes` of a body as text, then stop the download. Never throws. */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  try {
    const body = response.body;
    if (!body) return '';
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - bytes;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (bytes >= maxBytes) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return text + decoder.decode();
  } catch {
    return '';
  }
}

/** Podcast Index answers JSON. Read it capped; null when the body is not a JSON object. */
export async function readJsonObject(response: Response, maxBytes = 64 * 1024): Promise<Record<string, unknown> | null> {
  const text = await readCapped(response, maxBytes);
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Podcast Index sends `status` as the STRING "true" or "false". */
export function piStatusIsFalse(body: Record<string, unknown> | null): boolean {
  return body?.status === 'false' || body?.status === false;
}

/** PI's human-readable `description`, cut short. */
export function piDescription(body: Record<string, unknown> | null): string | undefined {
  const d = body?.description;
  return typeof d === 'string' && d ? d.slice(0, 300) : undefined;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolve after `ms`, or at once when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
