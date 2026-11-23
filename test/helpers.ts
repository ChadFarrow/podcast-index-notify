// A recording fake fetch. No test in this folder reaches the internet.

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
  cache?: RequestCache;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export interface FakeFetch {
  fetch: typeof fetch;
  calls: Call[];
}

export function fakeFetch(handler: Handler): FakeFetch {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: Call = {
      url: String(input),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      redirect: init.redirect,
      cache: init.cache,
    };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return handler(call);
  };
  return { fetch: fn as typeof fetch, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function text(body: string, status = 200, contentType = 'application/rss+xml'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

/** The query parameters of a recorded call. */
export function query(call: Call): URLSearchParams {
  return new URL(call.url).searchParams;
}

export const FEED = 'https://example.com/feeds/album.xml';
export const CREDS = { key: 'KEYSENTINEL123', secret: 'SECRETSENTINEL456' };
export const TOKEN = 'TOKENSENTINEL789';

export const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
<title>Test</title>
<podcast:guid>917393e3-1b1e-5cef-ace4-edaa54e1f810</podcast:guid>
<podcast:medium>music</podcast:medium>
</channel>
</rss>`;

export function rssWith(extra: string): string {
  return RSS.replace('<title>Test</title>', `<title>Test</title>\n${extra}`);
}
