import type { Concept } from './types';
import { bm25, keywords, tokens, uid } from './util';

export interface ExtractedSource {
  text: string;
  sourceName: string;
  topic: string;
  concepts: Concept[];
  conceptCount: number;
  chunks: string[];
}

/** A line that looks like a heading: short, no terminal punctuation, or numbered. */
function isHeading(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 80) return false;
  if (/^(#{1,6}\s|\d+(\.\d+)*\s+\S)/.test(l)) return true;
  if (/[.!?۔,;:]$/.test(l)) return false;
  // ALL CAPS or Title Case with few words reads as a section title.
  return l === l.toUpperCase() || l.split(/\s+/).length <= 8;
}

/**
 * Chunking with two things naive splitting lacks:
 *
 *  - **contextual headers**: the section heading a passage sits under is
 *    prepended to it, so a chunk that says "this must be escalated" still
 *    retrieves for "politically exposed person" when that was the heading.
 *  - **overlap**: the last sentence of each chunk starts the next one, so a
 *    fact that straddles a boundary is not lost to both sides.
 */
export function chunk(text: string, size = 900, overlapChars = 180): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ heading: string; body: string }> = [];
  let heading = '';
  let body = '';

  const flush = () => {
    if (body.trim()) blocks.push({ heading, body: body.trim() });
    body = '';
  };

  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      heading = line.replace(/^#{1,6}\s*/, '').trim();
    } else if (!line.trim()) {
      flush();
    } else {
      body += (body ? '\n' : '') + line;
    }
  }
  flush();

  const out: string[] = [];
  let buf = '';
  let bufHeading = '';

  const push = () => {
    if (!buf.trim()) return;
    out.push(bufHeading ? `[${bufHeading}]\n${buf.trim()}` : buf.trim());
  };

  for (const b of blocks) {
    const piece = b.body;
    if (buf && (buf.length + piece.length + 2 > size || b.heading !== bufHeading)) {
      push();
      // Carry the tail of the previous chunk forward so nothing falls in the gap.
      const tail = buf.slice(-overlapChars);
      const cut = tail.search(/[.!?۔]\s/);
      buf = cut >= 0 ? tail.slice(cut + 2) : '';
      bufHeading = b.heading;
      buf = buf ? `${buf}\n${piece}` : piece;
    } else {
      bufHeading = bufHeading || b.heading;
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  push();

  return out.length ? out : [text.slice(0, size)];
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?۔])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

/**
 * Deterministic concept extraction. Runs before any model call so that:
 *  - we always have a grounded concept list even when every provider is down,
 *  - the model's output can be checked against real source spans (grounding),
 *  - "47 concepts extracted" in the UI is a real number, not decoration.
 */
export function extractSource(rawText: string, sourceName: string, topicHint?: string): ExtractedSource {
  const text = (rawText || '').replace(/\r/g, '').trim();
  const chunks = chunk(text);
  const sents = sentences(text);

  // Score sentences by keyword density, then keep the densest as concept seeds.
  const globalKeys = new Set(keywords(text, 60));
  const scored = sents.map((s) => {
    const tk = tokens(s);
    const hits = tk.filter((t) => globalKeys.has(t)).length;
    return { s, score: hits / Math.max(6, tk.length) + Math.min(tk.length, 30) / 300 };
  });
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const concepts: Concept[] = [];
  for (const { s } of scored) {
    const key = keywords(s, 3).join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const idx = text.indexOf(s.slice(0, 40));
    const approxPage = idx >= 0 ? Math.max(1, Math.round(idx / 1800) + 1) : 1;
    concepts.push({
      id: uid('c'),
      label: titleCase(keywords(s, 4).join(' ')) || s.slice(0, 40),
      summary: s.length > 240 ? s.slice(0, 237) + '...' : s,
      sourceRef: `${sourceName}, p.${approxPage}`,
    });
    if (concepts.length >= 60) break;
  }

  const topic = topicHint?.trim() || deriveTopic(text, sourceName);

  return {
    text,
    sourceName,
    topic,
    concepts,
    conceptCount: concepts.length,
    chunks,
  };
}

export function titleCase(s: string): string {
  return (s || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * BM25 retrieval over the chunk set.
 *
 * The previous scoring counted raw keyword overlap, which meant a common word
 * like "account" carried the same weight as "regurgitation" — so a question
 * about the rare term retrieved the wrong passage. BM25 weights each term by how
 * rare it is across the document and normalises for chunk length, which is the
 * single cheapest retrieval upgrade available and needs no dependency, no
 * embeddings and no extra API call.
 */
export function retrieve(src: ExtractedSource, query: string, k = 3): string[] {
  return bm25(src.chunks, query, k).map((h) => src.chunks[h.index]);
}

/** Words that dominate frequency counts without naming the subject. */
const TOPIC_NOISE = new Set([
  'step', 'steps', 'first', 'second', 'third', 'then', 'next', 'finally', 'lastly',
  'one', 'two', 'three', 'four', 'five', 'must', 'should', 'always', 'never',
  'before', 'after', 'above', 'below', 'against', 'into', 'each', 'every',
  'new', 'also', 'system', 'using', 'used', 'following', 'required', 'require',
]);

/**
 * A readable topic label. Whole-document keyword frequency produces salad
 * ("Step Account Against"), so we lead with the opening sentences — which is
 * where a document almost always names its own subject — and fall back to a
 * cleaned filename before we fall back to keywords.
 */
export function deriveTopic(text: string, sourceName: string): string {
  const firstSentence = text.replace(/\s+/g, ' ').split(/(?<=[.!?۔])\s+/)[0] ?? '';

  // Words in the order the author wrote them, not by frequency: a document's
  // opening words name its subject, and "Account Opening Procedure" beats
  // "Account Branch Cnic" every time.
  const inOrder = tokens(firstSentence)
    .filter((w) => w.length > 3 && !TOPIC_NOISE.has(w))
    .slice(0, 3);
  if (inOrder.length >= 2) return titleCase(inOrder.join(' '));
  if (inOrder.length === 1 && inOrder[0].length >= 8) return titleCase(inOrder[0]);

  const pick = (src: string, n: number) =>
    keywords(src, 10).filter((w) => w.length > 3 && !TOPIC_NOISE.has(w)).slice(0, n);

  const fileLabel = titleCase(
    sourceName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim(),
  );
  if (fileLabel && !/^(pasted text|topic|upload)$/i.test(fileLabel)) return fileLabel;

  const fromAll = pick(text, 3);
  return fromAll.length ? titleCase(fromAll.join(' ')) : 'This Material';
}
