import type { EngineConfig, Journey, JourneyStep, Language, Localized } from './types';
import { buildExplainPrompt, buildInquirePrompt, EXPLAIN_SYSTEM, INQUIRE_SYSTEM } from './prompts';
import { completeWithFallback } from './providers';
import { scoreExplanationLocally } from './mastery';
import { bm25, clamp, coverage, extractJson, keywords, sanitizeUserText } from './util';


/* ------------------------------------------------------- step 2: inquire */

export interface InquireResult {
  answer: string;
  grounded: boolean;
  /** Where the answer came from — lets the UI be honest without scaring the learner. */
  basis: 'source' | 'general' | 'offtopic';
  provider: string;
  model: string;
  latencyMs: number;
  factsSurfaced: string[];
  degraded: boolean;
}

/**
 * Everything the persona is allowed to draw on, most relevant first.
 *
 * The old version only used `journey.concepts` — which, for a one-line topic,
 * is a single sentence (the topic itself). The persona therefore had nothing to
 * answer from and refused almost every question ("I can't speak on that").
 * Now it gets the lesson, the model-written knowledge base, the mission facts
 * and any source passages, ranked by BM25 against the question.
 */
function knowledgeFor(journey: Journey, spec: JourneyStep['inquire'], question: string): string[] {
  const pool: string[] = [];
  const add = (s?: string) => {
    const t = String(s ?? '').trim();
    if (t && !pool.includes(t)) pool.push(t);
  };
  const l = journey.lesson;
  add(l?.whatItIs);
  (l?.keyPoints ?? []).forEach(add);
  add(l?.example);
  add(journey.primer?.en);
  (journey.knowledge ?? []).forEach(add);
  (spec?.mustSurfaceFacts ?? []).forEach((f) => add(f.fact));
  for (const c of journey.concepts ?? []) add(`${c.label}: ${c.summary}  [${c.sourceRef}]`);

  const ranked = bm25(pool, question, 8).map((h) => pool[h.index]);
  return [...new Set([...ranked, ...pool])].slice(0, 18);
}

function situationFor(journey: Journey, step: JourneyStep): string {
  const sim = journey.steps.find((s) => s.kind === 'simulate');
  return [
    sim?.narrative?.en,
    sim?.decide?.situation,
    step.narrative?.en,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1400);
}

/** Close an answer that ran out of tokens mid-sentence rather than show "…if". */
function tidyEnding(s: string): string {
  const t = s.trim();
  if (!t || /[.!?۔؟)"'”]$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('۔ '));
  return cut > t.length * 0.4 ? t.slice(0, cut + 1) : `${t}.`;
}

export async function answerQuestion(args: {
  journey: Journey;
  step: JourneyStep;
  question: string;
  language: Language;
  history: Array<{ role: 'learner' | 'persona'; text: string }>;
  cfg: EngineConfig;
  log?: (m: string) => void;
}): Promise<InquireResult> {
  const question = sanitizeUserText(args.question, 1200);
  const spec = args.step.inquire;
  const context = knowledgeFor(args.journey, spec, question);
  const history = (args.history ?? []).map((h) => ({
    role: h.role === 'learner' ? ('learner' as const) : ('persona' as const),
    text: sanitizeUserText(String(h.text ?? ''), 600),
  }));

  const chain = await completeWithFallback(
    {
      system: INQUIRE_SYSTEM,
      user: buildInquirePrompt({
        persona: spec?.persona ?? 'a colleague who knows this material',
        question,
        context,
        language: args.language,
        tone: args.journey.tone,
        history,
        topic: args.journey.topic,
        learnerType: args.journey.learnerType,
        situation: situationFor(args.journey, args.step),
        sourceKind: args.journey.sourceKind,
      }),
      json: false,
      maxTokens: 1024,
      temperature: 0.6,
    },
    args.cfg.providerOrder,
    args.cfg.aiTimeoutMs,
    args.log,
  );

  // A fact counts as surfaced when it shows up in the exchange — the question
  // OR the persona's answer — not only when the learner happens to type its keyword.
  // Lenient on purpose: a fact counts once the exchange clearly covers it —
  // one distinctive keyword for short keyword lists, or half the fact's own
  // key terms. Also matches simple word forms (stoma / stomata, absorb / absorbs).
  const stem = (w: string) => w.toLowerCase().replace(/(ies|es|s|ing|ed|ata|a)$/i, '').slice(0, 7);
  const surfaced = (text: string) => {
    const words = new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2)
        .map(stem),
    );
    const hit = (term: string) =>
      term
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2)
        .some((w) => words.has(stem(w)));
    return (spec?.mustSurfaceFacts ?? [])
      .filter((f) => {
        const kw = f.keywords?.length ? f.keywords : [];
        const kwHits = kw.filter(hit).length;
        if (kw.length && kwHits >= (kw.length >= 4 ? 2 : 1)) return true;
        const factTerms = keywords(f.fact ?? '', 6);
        return factTerms.length > 0 && factTerms.filter(hit).length / factTerms.length >= 0.5;
      })
      .map((f) => f.id);
  };

  if (!chain) {
    const passage = context[0] ?? 'I do not have that in front of me.';
    return {
      answer: `From what I have here: ${passage}`,
      grounded: true,
      basis: 'source',
      provider: 'offline',
      model: 'retrieval-only',
      latencyMs: 0,
      factsSurfaced: surfaced(`${question} ${passage}`),
      degraded: true,
    };
  }

  const raw = chain.text.trim();
  const basisMatch = raw.match(/BASIS:\s*(source|general|offtopic)/i) ?? raw.match(/GROUNDED:\s*(yes|no)/i);
  const answer = tidyEnding(
    raw
      .replace(/\n?\s*BASIS:\s*\w+\s*$/i, '')
      .replace(/\n?\s*GROUNDED:\s*\w+\s*$/i, '')
      .trim(),
  );
  const tag = (basisMatch?.[1] ?? 'source').toLowerCase();
  const basis: InquireResult['basis'] =
    tag === 'offtopic' || tag === 'no' ? 'offtopic' : tag === 'general' ? 'general' : 'source';

  return {
    answer: answer || raw,
    grounded: basis !== 'offtopic',
    basis,
    provider: chain.provider,
    model: chain.model,
    latencyMs: chain.latencyMs,
    factsSurfaced: basis === 'offtopic' ? surfaced(question) : surfaced(`${question} ${answer}`),
    degraded: false,
  };
}

/* ------------------------------------------------------- step 3: explain */

export interface ExplainResult {
  overall: number;
  rubricScores: Array<{ id: string; score: number }>;
  misconception: string;
  strength: string;
  feedback: Localized;
  confidenceLanguage: 'hedged' | 'neutral' | 'overconfident';
  provider: string;
  model: string;
  latencyMs: number;
  degraded: boolean;
}

const HEDGES = /\b(i think|maybe|not sure|shayad|lagta hai|possibly|might be|i guess)\b/i;
const CERTAINS = /\b(definitely|obviously|certainly|100%|yaqeenan|bilkul|of course)\b/i;

function localConfidence(text: string): 'hedged' | 'neutral' | 'overconfident' {
  if (HEDGES.test(text)) return 'hedged';
  if (CERTAINS.test(text)) return 'overconfident';
  return 'neutral';
}

export async function gradeExplanation(args: {
  step: JourneyStep;
  answer: string;
  language: Language;
  cfg: EngineConfig;
  log?: (m: string) => void;
}): Promise<ExplainResult> {
  const answer = sanitizeUserText(args.answer, 3000);
  const spec = args.step.explain!;
  const local = scoreExplanationLocally(answer, spec.rubric);

  const offline = (): ExplainResult => ({
    overall: local.overall,
    rubricScores: local.rubricScores,
    misconception: '',
    strength: local.overall > 0.6 ? 'You covered the main parts of the idea.' : '',
    feedback: {
      en:
        local.overall >= 0.7
          ? 'Solid explanation — you covered the main idea. Tighten it with one concrete example from your own work.'
          : 'You are part of the way there. Go back to the lesson key points and say, step by step, what happens and why.',
      ur:
        local.overall >= 0.7
          ? 'اچھی وضاحت — آپ نے بنیادی خیال بیان کر دیا۔ اب اپنے کام سے ایک مثال بھی دیں۔'
          : 'آپ کچھ حد تک درست ہیں۔ سبق کے اہم نکات دوبارہ دیکھیں اور قدم بہ قدم بتائیں کہ کیا ہوتا ہے اور کیوں۔',
      mix:
        local.overall >= 0.7
          ? 'Achi explanation — main idea cover ho gaya. Ab apne kaam se ek example bhi dein.'
          : 'Aap kuch had tak sahi hain. Lesson ke key points dobara dekhein aur step by step batayen kya hota hai aur kyun.',
    },
    confidenceLanguage: localConfidence(answer),
    provider: 'offline',
    model: 'rubric-keyword-v1',
    latencyMs: 0,
    degraded: true,
  });

  if (answer.trim().length < 15) {
    const r = offline();
    r.overall = 0.05;
    r.feedback.en = 'That is too short to tell whether you have got it. Give it three or four sentences.';
    return r;
  }

  const chain = await completeWithFallback(
    {
      system: EXPLAIN_SYSTEM,
      user: buildExplainPrompt({
        task: spec.prompt,
        rubric: spec.rubric,
        modelAnswer: spec.modelAnswer,
        learnerAnswer: answer,
        language: args.language,
      }),
      json: true,
      maxTokens: 900,
      temperature: 0.2,
    },
    args.cfg.providerOrder,
    args.cfg.aiTimeoutMs,
    args.log,
  );

  if (!chain) return offline();

  try {
    const p = extractJson(chain.text);
    const rubricScores = (Array.isArray(p.rubricScores) ? p.rubricScores : []).map((x: any) => ({
      id: String(x?.id ?? ''),
      score: clamp(Number(x?.score) || 0),
    }));
    const modelOverall = clamp(Number(p.overall) || 0);
    // Blend model judgement with the deterministic rubric match so a single odd
    // model call cannot swing a learner's record.
    const overall = clamp(modelOverall * 0.75 + local.overall * 0.25);

    const fb = p.feedback ?? {};
    const en = String(fb.en ?? p.feedback ?? '').trim() || offline().feedback.en;

    return {
      overall: Number(overall.toFixed(3)),
      rubricScores: rubricScores.length ? rubricScores : local.rubricScores,
      misconception: String(p.misconception ?? '').slice(0, 300),
      strength: String(p.strength ?? '').slice(0, 300),
      feedback: {
        en,
        ur: String(fb.ur ?? '').trim() || en,
        mix: String(fb.mix ?? '').trim() || en,
      },
      confidenceLanguage: ['hedged', 'neutral', 'overconfident'].includes(p.confidenceLanguage)
        ? p.confidenceLanguage
        : localConfidence(answer),
      provider: chain.provider,
      model: chain.model,
      latencyMs: chain.latencyMs,
      degraded: false,
    };
  } catch {
    return offline();
  }
}
