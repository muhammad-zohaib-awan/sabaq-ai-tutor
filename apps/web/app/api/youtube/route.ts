import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Finds one YouTube video for a search phrase.
 *
 * This is a proxy on our origin, so it is rate limited and length capped:
 * without that it is an open relay anyone can point at YouTube using our IP.
 * The query is our own generated search phrase, never raw learner input, and
 * only a video id — 11 characters of [A-Za-z0-9_-] — is ever returned, so
 * nothing from the fetched page can reach the browser.
 */
const hits = new Map<string, { n: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimited(req: Request): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now > row.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  row.n += 1;
  return row.n > MAX_PER_WINDOW;
}

export async function GET(request: Request) {
  if (rateLimited(request)) {
    return NextResponse.json({ videoId: null, reason: 'rate_limited' }, { status: 429 });
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 120);
  if (!q) return NextResponse.json({ videoId: null, reason: 'no_query' }, { status: 400 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    );
    clearTimeout(timer);
    if (!res.ok) return NextResponse.json({ videoId: null, reason: 'upstream' }, { status: 502 });

    const html = await res.text();
    // Take the first id that is a well-formed video id, not just any match.
    const match = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    return NextResponse.json({ videoId: match?.[1] ?? null });
  } catch {
    return NextResponse.json({ videoId: null, reason: 'unreachable' }, { status: 502 });
  }
}
