import type { EngineConfig, Journey, Language } from './types';
import { completeWithFallback } from './providers';
import { extractJson } from './util';

/**
 * Missions are generated in ONE language (≈3× faster than writing all three).
 * When the learner flips the language toggle, the mission is translated on
 * demand here — ids, answers and structure untouched, only the words change —
 * and the API caches the result so each language is paid for once.
 */

const TEXT_KEYS = new Set([
  'label', 'narrative', 'prompt', 'runLabel', 'situation', 'consequence', 'successMessage',
  'failureMessage', 'consequenceIfWrong', 'note', 'detail', 'hint', 'fact', 'persona',
  'openingLine', 'suggestedQuestions', 'phraseTiles', 'modelAnswer', 'whatItIs', 'keyPoints',
  'example', 'whyItMatters', 'primer', 'analogy', 'title', 'missionLabel', 'question',
  'meterLabel', 'states', 'knowledge', 'caption', 'subtitle',
]);
const SKIP_KEYS = new Set(['concepts', 'media', 'groundingNotes', 'keywords', 'id', 'sourceRef', 'topic', 'learnerType']);

const RULES: Record<Language, string> = {
  en: 'plain, natural English',
  ur: 'Urdu in PROPER URDU SCRIPT (اردو رسم الخط), never Roman letters. Keep well-known technical terms (React, API, ECG, KYC, CNIC) in English letters inside the Urdu sentence.',
  mix: 'Roman Urdu code-switched with English the way Pakistani professionals speak ("Aap ko pehle form check karna hai"). Latin letters only. Technical terms stay English.',
};

type Slot = { text: string; set: (v: string) => void };

function collect(node: any, key: string, slots: Slot[]) {
  if (node == null || SKIP_KEYS.has(key)) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === 'string') {
        if (TEXT_KEYS.has(key) && v.trim()) slots.push({ text: v, set: (t) => (node[i] = t) });
      } else collect(v, key, slots);
    });
    return;
  }
  if (typeof node !== 'object') return;
  // Localized {en,ur,mix}: one text, written back to all three.
  if (typeof node.en === 'string' && 'ur' in node && 'mix' in node) {
    if (node.en.trim()) slots.push({ text: node.en, set: (t) => { node.en = node.ur = node.mix = t; } });
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (TEXT_KEYS.has(k) && v.trim()) slots.push({ text: v, set: (t) => (node[k] = t) });
    } else collect(v, k, slots);
  }
}

/** Arabic-script share of the letters — tells us whether text is really Urdu script. */
export function urduScriptRatio(s: string): number {
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const arabic = (s.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  return letters ? arabic / letters : 0;
}

async function translateChunk(texts: string[], lang: Language, cfg: EngineConfig, log?: (m: string) => void): Promise<string[] | null> {
  const res = await completeWithFallback(
    {
      system: `You are a professional translator for a learning app. Translate every string into ${RULES[lang]}. Keep meaning, tone and length. Do not add or drop items. Return STRICT JSON only: {"t": ["...", "..."]} with exactly ${texts.length} strings in the same order.`,
      user: JSON.stringify({ strings: texts }),
      json: true,
      // Urdu script costs far more tokens per character than English.
      maxTokens: Math.min(8000, 400 + texts.join(' ').length * (lang === 'ur' ? 3 : 2)),
      temperature: 0.2,
    },
    cfg.providerOrder,
    45000,
    log,
  );
  if (!res) return null;
  try {
    const out = extractJson(res.text)?.t;
    if (Array.isArray(out) && out.length === texts.length) {
      const result = out.map((x: any, i: number) => String(x ?? '') || texts[i]);
      // A "translation" into Urdu that is still Latin script is a failure.
      if (lang === 'ur' && urduScriptRatio(result.join(' ')) < 0.4) {
        log?.('[translate] chunk came back without Urdu script');
        return null;
      }
      return result;
    }
  } catch {
    /* fall through */
  }
  log?.(`[translate] chunk of ${texts.length} came back malformed`);
  return null;
}

export async function translateJourney(
  journey: Journey,
  lang: Language,
  cfg: EngineConfig,
  log?: (m: string) => void,
): Promise<{ journey: Journey; complete: boolean }> {
  const copy: Journey = JSON.parse(JSON.stringify(journey));
  const slots: Slot[] = [];
  collect(copy, '', slots);

  const unique = [...new Set(slots.map((s) => s.text))];
  // Parallel chunks keep each call small and fast.
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  // Small chunks: each finishes well inside the timeout.
  for (const t of unique) {
    if (cur.length && (cur.length >= 14 || size + t.length > 1400)) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.length;
  }
  if (cur.length) chunks.push(cur);

  // Limited concurrency (free tiers rate-limit bursts), one retry per chunk.
  const results: Array<string[] | null> = new Array(chunks.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      results[i] = (await translateChunk(chunks[i], lang, cfg, log)) ?? (await translateChunk(chunks[i], lang, cfg, log));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker));
  const map = new Map<string, string>();
  let complete = true;
  results.forEach((r, i) => {
    if (!r) complete = false;
    chunks[i].forEach((src, j) => map.set(src, r ? r[j] : src));
  });
  for (const s of slots) s.set(map.get(s.text) ?? s.text);

  copy.language = lang;
  return { journey: copy, complete };
}
