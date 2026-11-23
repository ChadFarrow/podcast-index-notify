// Feed URL rules, taken from MSP-2.0 (api/_utils/urlValidation.ts).
//
// Podcast Index stores a feed under the exact URL it is told. A URL with a space,
// an apostrophe or another character that needs encoding can be stored twice
// (once raw, once encoded) or not fetch at all, so such a URL is refused here
// with a message that tells the person what to fix.

// Zero-width and BOM characters that survive a copy out of a web page, an email
// or a PDF. They are invisible, so they are stripped, not reported.
const INVISIBLE_CODES = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

function isEdgeJunk(char: string): boolean {
  const code = char.charCodeAt(0);
  // C0 controls are what the WHATWG URL parser strips too.
  if (code <= 0x1f || code === 0x7f) return true;
  if (INVISIBLE_CODES.has(code)) return true;
  return /\s/.test(char);
}

/**
 * Trim paste junk (whitespace, control and zero-width characters) from both ends
 * of a feed URL. Interior whitespace stays: getFeedUrlError reports it, because
 * removing it would send a different URL. Idempotent.
 */
export function normalizeFeedUrl(url: string): string {
  let start = 0;
  let end = url.length;
  while (start < end && isEdgeJunk(url[start]!)) start++;
  while (end > start && isEdgeJunk(url[end - 1]!)) end--;
  return url.slice(start, end);
}

function hasNonAscii(url: string): boolean {
  for (let i = 0; i < url.length; i++) {
    if (url.charCodeAt(i) > 127) return true;
  }
  return false;
}

const CHECKS: Array<{ test: (url: string) => boolean; label: string; detail: string }> = [
  {
    // Runs on the normalized URL, so a match is interior whitespace.
    test: (url) => /\s/.test(url),
    label: 'whitespace (spaces, tabs, or line breaks)',
    detail:
      'Spaces, tabs and line breaks are not valid in URLs. Rename the file at your host to remove them, then submit the new URL.',
  },
  {
    // Every apostrophe-shaped character. A pre-encoded %27 is NOT matched: it is
    // the form Podcast Index itself stores, and it fetches fine.
    test: (url) => /['’‘ʼʻ＇]/.test(url),
    label: "apostrophes (' or ’)",
    detail:
      'Podcast Index may encode apostrophes as %27, creating a duplicate feed entry. Rename the file to remove them.',
  },
  {
    test: (url) => /[<>"{}|\\^`]/.test(url),
    label: 'special characters (<, >, ", {, }, |, \\, ^, `)',
    detail: 'These characters require percent-encoding and may cause indexing issues.',
  },
  {
    test: hasNonAscii,
    label: 'non-ASCII characters',
    detail: 'Non-ASCII characters require percent-encoding and may cause indexing issues.',
  },
];

/**
 * A message that says what is wrong with a feed URL for Podcast Index, or null
 * when the characters are fine. It does not check the scheme; validateFeedUrl does.
 */
export function getFeedUrlError(rawUrl: string): string | null {
  const url = normalizeFeedUrl(rawUrl);
  if (!url) return null;

  const found: string[] = [];
  let detail = '';
  for (const { test, label, detail: d } of CHECKS) {
    if (test(url)) {
      found.push(label);
      if (!detail) detail = d;
    }
  }
  if (found.length === 0) return null;
  return `URL contains ${found.join(', ')}. ${detail} Please fix the URL before submitting to Podcast Index.`;
}

export type FeedUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Normalize a feed URL and check that Podcast Index can take it: an absolute
 * http(s) URL, with no user name or password in it, and none of the characters
 * that getFeedUrlError refuses. On success `url` is the normalized URL to send.
 */
export function validateFeedUrl(rawUrl: unknown): FeedUrlCheck {
  if (typeof rawUrl !== 'string') return { ok: false, error: 'Feed URL must be a string' };
  const url = normalizeFeedUrl(rawUrl);
  if (!url) return { ok: false, error: 'Feed URL is empty' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Feed URL is not a valid absolute URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Feed URL must start with http:// or https://' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Feed URL must not contain a user name or password' };
  }

  const charError = getFeedUrlError(url);
  if (charError) return { ok: false, error: charError };
  return { ok: true, url };
}
