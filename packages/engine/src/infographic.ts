import type { EngineConfig, Journey } from './types';
import { completeWithFallback } from './providers';
import { extractJson } from './util';

/**
 * Infographics.
 *
 * The old path asked the model to hand-write a 900×600 SVG: thousands of
 * output tokens, 15-30 s, and it regularly ran out of tokens mid-tag and came
 * back empty. Now the model only supplies a tiny JSON outline (fast, ~1-3 s)
 * and the drawing is done here in code. If the model is slow or down, the
 * outline comes from the lesson itself — so the diagram never fails.
 */

export interface InfoSection {
  heading: string;
  points: string[];
}
export interface InfoOutline {
  title: string;
  isProcess: boolean;
  sections: InfoSection[];
}

const HEAD: Record<string, [string, string, string, string, string, string]> = {
  en: ['What it is', 'Key ideas', 'More key ideas', 'Example', 'Why it matters', 'Think of it like'],
  ur: ['یہ کیا ہے', 'اہم نکات', 'مزید نکات', 'مثال', 'یہ کیوں اہم ہے', 'اسے یوں سمجھیں'],
  mix: ['Ye kya hai', 'Key points', 'Mazeed points', 'Example', 'Ye kyun zaroori hai', 'Isay yun samjhein'],
};

export function outlineFromLesson(j: Journey): InfoOutline {
  const h = HEAD[j.language] ?? HEAD.en;
  const l = j.lesson;
  const kp = l?.keyPoints ?? [];
  const pick = (loc: any) => (typeof loc === 'string' ? loc : loc?.[j.language] ?? loc?.en ?? '');
  const sections: InfoSection[] = [
    { heading: h[0], points: [l?.whatItIs || pick(j.primer)] },
    { heading: h[1], points: kp.slice(0, 3) },
    { heading: h[2], points: kp.slice(3, 6) },
    { heading: h[3], points: [l?.example ?? ''] },
    { heading: h[4], points: [l?.whyItMatters ?? ''] },
    { heading: h[5], points: [pick(j.analogy)] },
  ]
    .map((s) => ({ ...s, points: s.points.map((p) => String(p ?? '').trim()).filter(Boolean) }))
    .filter((s) => s.points.length);
  return { title: j.topic, isProcess: false, sections };
}

export async function outlineWithModel(j: Journey, cfg: EngineConfig, log?: (m: string) => void): Promise<InfoOutline | null> {
  const langRule =
    j.language === 'ur' ? 'Urdu script' : j.language === 'mix' ? 'Roman Urdu mixed with English' : 'English';
  const lesson = j.lesson ? [j.lesson.whatItIs, ...(j.lesson.keyPoints ?? [])].join(' ') : '';
  const res = await completeWithFallback(
    {
      system: `You design educational infographics. Return STRICT JSON only:
{"title":"short title","isProcess":true|false,"sections":[{"heading":"2-4 words","points":["short fact, max 70 characters"]}]}
4 to 6 sections, 2 or 3 points each. isProcess=true only if the sections are sequential stages. Write in ${langRule}. Accurate, no invented statistics.`,
      user: `Topic: ${j.topic.slice(0, 200)}\nLearner: ${j.learnerType.slice(0, 80)}\nLesson: ${lesson.slice(0, 1500)}`,
      json: true,
      maxTokens: 900,
      temperature: 0.3,
    },
    cfg.providerOrder,
    12000,
    log,
  );
  if (!res) return null;
  try {
    const p = extractJson(res.text);
    const sections: InfoSection[] = (Array.isArray(p.sections) ? p.sections : [])
      .slice(0, 6)
      .map((s: any) => ({
        heading: String(s?.heading ?? '').slice(0, 40),
        points: (Array.isArray(s?.points) ? s.points : []).slice(0, 3).map((x: any) => String(x ?? '').slice(0, 110)).filter(Boolean),
      }))
      .filter((s: InfoSection) => s.heading && s.points.length);
    if (sections.length < 3) return null;
    return { title: String(p.title ?? j.topic).slice(0, 70), isProcess: Boolean(p.isProcess), sections };
  } catch {
    return null;
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

const COLORS = ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#f43f5e', '#22c55e'];

/** Deterministic SVG. All text is escaped; nothing executable can appear. */
export function renderInfographic(o: InfoOutline, rtl = false): string {
  const W = 900;
  const pad = 30;
  const gap = 18;
  const n = o.sections.length;
  const cols = n <= 4 ? 2 : 3;
  const cardW = (W - pad * 2 - gap * (cols - 1)) / cols;
  // Urdu glyphs are wider; wrap earlier so nothing spills out of a card.
  const maxChars = Math.floor(cardW / (rtl ? 9.2 : 7.6)) - 3;
  const font = rtl ? "'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif" : 'system-ui,Segoe UI,sans-serif';
  const lineH = rtl ? 27 : 19;

  const titleLines = wrap(o.title, rtl ? 40 : 52).slice(0, 2);
  let y = 40 + titleLines.length * 34;

  const cards = o.sections.map((s) => {
    // In RTL the bullet belongs on the right, i.e. at the end of the string.
    const lines = s.points.flatMap((p) =>
      wrap(p, maxChars).map((l, i) => (i === 0 ? (rtl ? `${l} •` : `• ${l}`) : l)),
    );
    return { s, lines, h: 58 + lines.length * lineH + 14 };
  });

  const parts: string[] = [];
  for (let r = 0; r < Math.ceil(n / cols); r++) {
    const row = cards.slice(r * cols, r * cols + cols);
    const rowH = Math.max(...row.map((c) => c.h));
    row.forEach((c, i) => {
      const idx = r * cols + i;
      const col = rtl ? cols - 1 - i : i;
      const x = pad + col * (cardW + gap);
      const color = COLORS[idx % COLORS.length];
      const tx = rtl ? x + cardW - 18 : x + 18;
      const anchor = rtl ? 'end' : 'start';
      parts.push(
        `<rect x="${x}" y="${y}" width="${cardW}" height="${rowH}" rx="16" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-opacity="0.45"/>`,
        `<rect x="${rtl ? x + cardW - 6 : x}" y="${y + 16}" width="6" height="26" rx="3" fill="${color}"/>`,
      );
      const head = o.isProcess ? `${idx + 1}. ${c.s.heading}` : c.s.heading;
      parts.push(
        `<text x="${tx}" y="${y + 36}" font-size="17" font-weight="700" fill="#f8fafc" text-anchor="${anchor}">${esc(head)}</text>`,
      );
      c.lines.forEach((l, li) => {
        parts.push(
          `<text x="${tx}" y="${y + 64 + li * lineH}" font-size="13.5" fill="#cbd5e1" text-anchor="${anchor}">${esc(l)}</text>`,
        );
      });
      if (o.isProcess && idx < n - 1 && i < row.length - 1) {
        const ax = rtl ? x - gap / 2 : x + cardW + gap / 2;
        parts.push(`<text x="${ax}" y="${y + rowH / 2}" font-size="18" fill="#94a3b8" text-anchor="middle">${rtl ? '←' : '→'}</text>`);
      }
    });
    y += rowH + gap;
  }
  const H = Math.ceil(y + 12);

  const title = titleLines
    .map(
      (t, i) =>
        `<text x="${rtl ? W - pad : pad}" y="${48 + i * 34}" font-size="28" font-weight="800" fill="#ffffff" text-anchor="${rtl ? 'end' : 'start'}">${esc(t)}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}"><rect width="${W}" height="${H}" rx="18" fill="#0f172a"/>${title}${parts.join('')}</svg>`;
}
