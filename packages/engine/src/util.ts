import { randomUUID, createHash } from 'crypto';

export const uid = (prefix = ''): string =>
  prefix ? `${prefix}_${randomUUID().slice(0, 12)}` : randomUUID();

export const now = (): string => new Date().toISOString();

export const clamp = (n: number, lo = 0, hi = 1): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

export const hash = (s: string): string =>
  createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Cheap, dependency-free tokenizer used for grounding + rubric matching. */
export function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

const STOP = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'you',
  'your', 'its', 'has', 'have', 'not', 'but', 'they', 'their', 'what', 'when',
  'which', 'into', 'then', 'than', 'will', 'can', 'all', 'any', 'how', 'why',
  'hai', 'hain', 'kay', 'kee', 'aur', 'main', 'mein', 'per', 'par', 'kar',
]);

export function keywords(s: string, limit = 12): string[] {
  const freq = new Map<string, number>();
  for (const t of tokens(s)) {
    if (STOP.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/** Jaccard-ish coverage of `needles` inside `haystack`. 0..1 */
export function coverage(needles: string[], haystack: string): number {
  if (!needles.length) return 0;
  const hay = new Set(tokens(haystack));
  let hit = 0;
  for (const n of needles) {
    const parts = tokens(n);
    if (!parts.length) continue;
    if (parts.some((p) => hay.has(p))) hit++;
  }
  return clamp(hit / needles.length);
}

/**
 * BM25 over a small in-memory corpus.
 *
 * Rare terms outweigh common ones and long passages are not rewarded for their
 * length. Good enough to make retrieval feel sharp on a single document, with
 * no embeddings, no vector store and no extra API call — which matters when the
 * whole point is that the mission plays with nothing but the browser after the
 * first call.
 */
export function bm25(corpus: string[], query: string, k = 3): Array<{ index: number; score: number }> {
  if (!corpus.length) return [];
  const docs = corpus.map((c) => tokens(c));
  const N = docs.length;
  const avgLen = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, N);

  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const q = [...new Set(tokens(query))];
  const K1 = 1.5;
  const B = 0.75;

  return docs
    .map((d, index) => {
      const freq = new Map<string, number>();
      for (const t of d) freq.set(t, (freq.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of q) {
        const f = freq.get(term) ?? 0;
        if (!f) continue;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / Math.max(1, avgLen))));
      }
      return { index, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0)
    .slice(0, k);
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Models sometimes wrap JSON in prose or fences. Pull the first balanced object out. */
export function extractJson(raw: string): any {
  if (!raw) throw new Error('empty model response');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  if (start === -1) throw new Error('no JSON object in model response');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON in model response');
}

export function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '\n[...truncated for context budget...]';
}

/** Strip anything that looks like an injection attempt out of learner/source text. */
export function sanitizeUserText(s: string, max = 8000): string {
  return truncate(
    (s || '')
      .replace(/\u0000/g, '')
      .replace(/<\s*\/?\s*(script|iframe|object|embed|style)[^>]*>/gi, '')
      .replace(/^\s*(system|assistant|developer)\s*:/gim, 'note:')
      .replace(/ignore (all )?(previous|prior|above) instructions/gi, '[redacted]'),
    max,
  );
}
