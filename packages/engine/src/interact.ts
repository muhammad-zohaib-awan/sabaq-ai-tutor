import type { EngineConfig, Journey, JourneyStep, Language, Localized } from './types';
import { buildExplainPrompt, buildInquirePrompt, EXPLAIN_SYSTEM, INQUIRE_SYSTEM } from './prompts';
import { completeWithFallback } from './providers';
import { scoreExplanationLocally } from './mastery';
import { bm25, clamp, coverage, extractJson, sanitizeUserText } from './util';

/* ------------------------------------------------------- step 2: inquire */

export interface InquireResult {
  answer: string;
  grounded: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  factsSurfaced: string[];
  degraded: boolean;
}

/**
 * The retrieval step for the role-play chat, scored with BM25 so a question
 * about a rare term ("regurgitation") finds the passage that actually covers it
 * instead of whichever passage repeats a common word most often.
 */
function contextFor(journey: Journey, question: string, k = 3): string[] {
  const corpus = journey.concepts.map((c) => `${c.label} ${c.summary}`);
  return bm25(corpus, question, k).map((h) => {
    const c = journey.concepts[h.index];
    return `${c.summary}  [${c.sourceRef}]`;
  });
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
  const ctx = contextFor(args.journey, question);
  const fallbackCtx = ctx.length ? ctx : args.journey.concepts.slice(0, 3).map((c) => c.summary);

  const factsSurfaced = (spec?.mustSurfaceFacts ?? [])
    .filter((f) => coverage(f.keywords, question) > 0)
    .map((f) => f.id);

  const chain = await completeWithFallback(
    {
      system: INQUIRE_SYSTEM,
      user: buildInquirePrompt({
        persona: spec?.persona ?? 'a colleague who knows this material',
        question,
        context: fallbackCtx,
        language: args.language,
        tone: args.journey.tone,
        history: args.history,
      }),
      json: false,
      maxTokens: 500,
      temperature: 0.75,
    },
    args.cfg.providerOrder,
    args.cfg.aiTimeoutMs,
    args.log,
  );

  if (!chain) {
    // Model-free answer: hand back the most relevant source passage in character.
    const passage = fallbackCtx[0] ?? 'I do not have that in front of me.';
    return {
      answer:
        ctx.length > 0
          ? `From what I have here: ${passage}`
          : `That is not something the notes cover. What I can tell you is this: ${passage}`,
      grounded: ctx.length > 0,
      provider: 'offline',
      model: 'retrieval-only',
      latencyMs: 0,
      factsSurfaced,
      degraded: true,
    };
  }

  const raw = chain.text.trim();
  const groundedLine = raw.match(/GROUNDED:\s*(yes|no)/i);
  const answer = raw.replace(/GROUNDED:\s*(yes|no)\s*$/i, '').trim();

  return {
    answer: answer || raw,
    grounded: groundedLine ? /yes/i.test(groundedLine[1]) : ctx.length > 0,
    provider: chain.provider,
    model: chain.model,
    latencyMs: chain.latencyMs,
    factsSurfaced,
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
          ? 'Solid explanation — you named the mechanism and the timing. Tighten it by saying what you would check next.'
          : 'You are part of the way there. Go back to the timing of the sound and say explicitly which part is open and which is shut.',
      ur:
        local.overall >= 0.7
          ? 'اچھی وضاحت — آپ نے میکانزم اور وقت دونوں بتائے۔ اب یہ بھی بتائیں کہ اگلا قدم کیا ہوگا۔'
          : 'آپ کچھ حد تک درست ہیں۔ آواز کے وقت پر دوبارہ غور کریں اور واضح کریں کہ کون سا حصہ کھلا اور کون سا بند ہے۔',
      mix:
        local.overall >= 0.7
          ? 'Achi explanation — mechanism aur timing dono bataye. Ab ye bhi batayen ke agla step kya hoga.'
          : 'Aap kuch had tak sahi hain. Awaaz ki timing par dobara sochein aur clearly batayen kaun sa hissa khula aur kaun sa band hai.',
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
