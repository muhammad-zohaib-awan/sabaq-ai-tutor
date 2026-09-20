import type {
  BuildJourneyInput,
  EngineConfig,
  Journey,
  JourneyStep,
  Localized,
  StepKind,
} from './types';
import { extractSource, type ExtractedSource } from './extract';
import { buildJourneyPrompt, JOURNEY_SYSTEM, type PriorSignals } from './prompts';
import { completeWithFallback, providerStatus, type ChainAttempt } from './providers';
import { buildOfflineJourney } from './offline';
import { checkGrounding } from './grounding';
import { extractJson, now, sanitizeUserText, uid, clamp } from './util';

export interface BuildResult {
  journey: Journey;
  attempts: ChainAttempt[];
}

/**
 * Raised when there is nothing to build a grounded mission from: a bare topic
 * with no model reachable. The offline builder works from sentences in the
 * source, and a one-line topic has none — inventing facts to fill the gap is
 * exactly what the grounding rules exist to prevent, so we say so instead.
 */
export class InsufficientSourceError extends Error {
  readonly code = 'INSUFFICIENT_SOURCE';
  /** Why each provider failed. Surfaced so nobody debugs this blind. */
  readonly attempts: ChainAttempt[];
  constructor(message: string, attempts: ChainAttempt[] = []) {
    super(message);
    this.name = 'InsufficientSourceError';
    this.attempts = attempts;
  }
}

const STEP_ORDER: StepKind[] = ['simulate', 'inquire', 'explain'];

function loc(v: any, fallback: string): Localized {
  if (v && typeof v === 'object') {
    const en = String(v.en ?? fallback).trim() || fallback;
    return {
      en,
      ur: String(v.ur ?? '').trim() || en,
      mix: String(v.mix ?? '').trim() || en,
    };
  }
  const s = String(v ?? fallback).trim() || fallback;
  return { en: s, ur: s, mix: s };
}

/**
 * Model output is never trusted directly. Everything is coerced into the schema,
 * clamped, and back-filled from the deterministic offline build if a whole beat
 * is missing. A malformed model response degrades the mission, it never 500s it.
 */
function normalise(
  raw: any,
  src: ExtractedSource,
  input: BuildJourneyInput,
  cfg: EngineConfig,
  meta: { provider: string; model: string; latencyMs: number },
): Journey {
  const skeleton = buildOfflineJourney(src, input, cfg);
  const rawSteps: any[] = Array.isArray(raw?.steps) ? raw.steps : [];

  const steps: JourneyStep[] = STEP_ORDER.map((kind, i) => {
    const r = rawSteps.find((s) => String(s?.kind).toLowerCase() === kind) ?? rawSteps[i];
    const base = skeleton.steps[i];
    if (!r) return base;

    const step: JourneyStep = {
      id: uid('s'),
      kind,
      label: loc(r.label, base.label.en),
      xp: cfg.xpPerStep[i] ?? base.xp,
      narrative: loc(r.narrative, base.narrative.en),
    };

    if (kind === 'simulate') {
      // Try the mechanic the model chose. Every one of these validators can say
      // no, and when it does we fall through to 'sort', which works on anything.
      const wanted = String(r.mechanic ?? '').toLowerCase();

      if (wanted === 'order') {
        const items = (Array.isArray(r.order?.items) ? r.order.items : [])
          .slice(0, 6)
          .map((it: any, i: number) => ({
            id: String(it?.id ?? `i${i + 1}`).slice(0, 40),
            label: String(it?.label ?? '').slice(0, 160),
            note: String(it?.note ?? '').slice(0, 200),
          }))
          .filter((it: any) => it.label);
        const ids = items.map((i: any) => i.id);
        const correct = (Array.isArray(r.order?.correctOrder) ? r.order.correctOrder : []).map(String);
        const validOrder =
          items.length >= 3 &&
          correct.length === items.length &&
          new Set(correct).size === correct.length &&
          correct.every((id: string) => ids.includes(id));

        if (validOrder) {
          step.mechanic = 'order';
          step.order = {
            prompt: String(r.order?.prompt ?? 'Put these in the order they actually happen.').slice(0, 220),
            runLabel: String(r.order?.runLabel ?? 'Check the order').slice(0, 40),
            items,
            correctOrder: correct,
            consequenceIfWrong: String(
              r.order?.consequenceIfWrong ?? 'Out of order, the later steps act on information that does not exist yet.',
            ).slice(0, 260),
            successMessage: String(r.order?.successMessage ?? 'That is the real sequence.').slice(0, 220),
          };
          return step;
        }
      }

      if (wanted === 'decide') {
        const meters = (Array.isArray(r.decide?.meters) ? r.decide.meters : [])
          .slice(0, 4)
          .map((m: any, i: number) => ({
            id: String(m?.id ?? `m${i + 1}`).slice(0, 30),
            label: String(m?.label ?? `Meter ${i + 1}`).slice(0, 40),
            value: clamp(Number(m?.value) || 0, 0, 100),
            max: Math.max(1, Math.min(100, Number(m?.max) || 100)),
            goodDirection: m?.goodDirection === 'up' ? ('up' as const) : ('down' as const),
          }))
          .filter((m: any) => m.label);
        const meterIds = meters.map((m: any) => m.id);
        const options = (Array.isArray(r.decide?.options) ? r.decide.options : [])
          .slice(0, 4)
          .map((o: any, i: number) => ({
            id: String(o?.id ?? `o${i + 1}`).slice(0, 30),
            label: String(o?.label ?? '').slice(0, 200),
            quality: ['best', 'defensible', 'risky'].includes(o?.quality) ? o.quality : 'defensible',
            consequence: String(o?.consequence ?? '').slice(0, 300),
            // Deltas are integers the model wrote down, never expressions we evaluate.
            deltas: (Array.isArray(o?.deltas) ? o.deltas : [])
              .slice(0, 4)
              .map((d: any) => ({
                meterId: String(d?.meterId ?? ''),
                delta: Math.round(clamp(Number(d?.delta) || 0, -40, 40)),
              }))
              .filter((d: any) => meterIds.includes(d.meterId)),
          }))
          .filter((o: any) => o.label && o.consequence);

        const best = options.filter((o: any) => o.quality === 'best');
        if (meters.length >= 1 && options.length >= 3 && best.length === 1) {
          step.mechanic = 'decide';
          step.decide = {
            prompt: String(r.decide?.prompt ?? 'What do you do?').slice(0, 220),
            situation: String(r.decide?.situation ?? base.narrative.en).slice(0, 600),
            meters,
            options,
            successMessage: String(r.decide?.successMessage ?? 'That is the defensible call.').slice(0, 220),
          };
          return step;
        }
      }

      if (wanted === 'trace') {
        const nodes = (Array.isArray(r.trace?.nodes) ? r.trace.nodes : [])
          .slice(0, 6)
          .map((n: any, i: number) => ({
            id: String(n?.id ?? `n${i + 1}`).slice(0, 30),
            label: String(n?.label ?? '').slice(0, 60),
            detail: String(n?.detail ?? '').slice(0, 220),
          }))
          .filter((n: any) => n.label);
        const nodeIds = nodes.map((n: any) => n.id);
        const edges = (Array.isArray(r.trace?.edges) ? r.trace.edges : [])
          .slice(0, 10)
          .map((e: any) => [String(e?.[0] ?? ''), String(e?.[1] ?? '')] as [string, string])
          .filter((e: [string, string]) => nodeIds.includes(e[0]) && nodeIds.includes(e[1]) && e[0] !== e[1]);
        const correctNode = String(r.trace?.correctNodeId ?? '');
        const riseNode = String(r.trace?.meterRisesAtNodeId ?? correctNode);

        if (nodes.length >= 3 && edges.length >= nodes.length - 1 && nodeIds.includes(correctNode)) {
          step.mechanic = 'trace';
          step.trace = {
            prompt: String(r.trace?.prompt ?? 'Before you follow it through, commit to an answer.').slice(0, 220),
            runLabel: String(r.trace?.runLabel ?? 'Follow it through').slice(0, 40),
            nodes,
            edges,
            question: String(r.trace?.question ?? 'Which step does the real work?').slice(0, 200),
            correctNodeId: correctNode,
            meterLabel: String(r.trace?.meterLabel ?? 'Progress').slice(0, 50),
            meterRisesAtNodeId: nodeIds.includes(riseNode) ? riseNode : correctNode,
            successMessage: String(r.trace?.successMessage ?? 'That is where the work happens.').slice(0, 220),
            failureMessage: String(
              r.trace?.failureMessage ?? 'Not there — watch where the quantity actually moves.',
            ).slice(0, 220),
          };
          return step;
        }
      }

      step.mechanic = 'sort';
      // The skeleton may itself be an 'order' step, so it cannot be relied on
      // for sim defaults. Build a minimal sort board from the concepts instead.
      const fallbackSim = base.sim ?? {
        prompt: 'Decide where each statement belongs, then run the check.',
        runLabel: 'Run the check',
        visual: 'board' as const,
        elements: src.concepts.slice(0, 3).map((c, i) => ({
          id: `e${i + 1}`,
          label: c.summary.slice(0, 110),
          states: ['holds up', 'does not hold up'] as [string, string],
          correct: 0 as 0 | 1,
          hint: `Look again at "${c.label}" in the source.`,
          group: 'left' as const,
        })),
        successMessage: 'You separated what the source supports from what it does not.',
        failureMessage: 'At least one of those does not survive a look at the source.',
        legend: [],
      };
      const els = Array.isArray(r.sim?.elements) ? r.sim.elements : [];
      const elements = els
        .slice(0, 6)
        .map((e: any, idx: number) => ({
          id: String(e?.id ?? `e${idx + 1}`).slice(0, 40),
          label: String(e?.label ?? `Element ${idx + 1}`).slice(0, 140),
          states: [
            String(e?.states?.[0] ?? 'state A').slice(0, 30),
            String(e?.states?.[1] ?? 'state B').slice(0, 30),
          ] as [string, string],
          correct: (Number(e?.correct) === 1 ? 1 : 0) as 0 | 1,
          hint: String(e?.hint ?? 'Think about what the source said about this.').slice(0, 200),
          group: e?.group === 'left' ? ('left' as const) : ('right' as const),
        }))
        .filter((e: any) => e.label);

      step.sim =
        elements.length >= 2
          ? {
              prompt: String(r.sim?.prompt ?? fallbackSim.prompt).slice(0, 220),
              runLabel: String(r.sim?.runLabel ?? fallbackSim.runLabel).slice(0, 40),
              visual: r.sim?.visual === 'heart' ? 'heart' : 'board',
              elements,
              successMessage: String(r.sim?.successMessage ?? fallbackSim.successMessage).slice(0, 220),
              failureMessage: String(r.sim?.failureMessage ?? fallbackSim.failureMessage).slice(0, 220),
              legend: Array.isArray(r.sim?.legend)
                ? r.sim.legend.slice(0, 4).map((l: any) => ({
                    label: String(l?.label ?? '').slice(0, 40),
                    color: /^#[0-9a-f]{6}$/i.test(String(l?.color)) ? String(l.color) : '#64748b',
                  }))
                : fallbackSim.legend,
            }
          : fallbackSim;
    }

    if (kind === 'inquire') {
      step.inquire = {
        persona: String(r.inquire?.persona ?? base.inquire!.persona).slice(0, 120),
        openingLine: String(r.inquire?.openingLine ?? base.inquire!.openingLine).slice(0, 400),
        suggestedQuestions: (Array.isArray(r.inquire?.suggestedQuestions)
          ? r.inquire.suggestedQuestions
          : base.inquire!.suggestedQuestions
        )
          .slice(0, 5)
          .map((q: any) => String(q).slice(0, 160)),
        mustSurfaceFacts: (Array.isArray(r.inquire?.mustSurfaceFacts)
          ? r.inquire.mustSurfaceFacts
          : base.inquire!.mustSurfaceFacts
        )
          .slice(0, 6)
          .map((f: any, idx: number) => ({
            id: String(f?.id ?? `f${idx + 1}`),
            fact: String(f?.fact ?? '').slice(0, 300),
            keywords: (Array.isArray(f?.keywords) ? f.keywords : []).slice(0, 8).map((k: any) => String(k)),
          }))
          .filter((f: any) => f.fact),
      };
      if (!step.inquire.mustSurfaceFacts.length) step.inquire.mustSurfaceFacts = base.inquire!.mustSurfaceFacts;
    }

    if (kind === 'explain') {
      const rubric = (Array.isArray(r.explain?.rubric) ? r.explain.rubric : [])
        .slice(0, 6)
        .map((x: any, idx: number) => ({
          id: String(x?.id ?? `r${idx + 1}`),
          label: String(x?.label ?? `Criterion ${idx + 1}`).slice(0, 160),
          keywords: (Array.isArray(x?.keywords) ? x.keywords : []).slice(0, 10).map((k: any) => String(k)),
          weight: clamp(Number(x?.weight) || 0, 0, 1),
        }));
      const total = rubric.reduce((a: number, b: any) => a + b.weight, 0);
      if (total > 0) rubric.forEach((x: any) => (x.weight = Number((x.weight / total).toFixed(3))));

      step.explain = {
        prompt: String(r.explain?.prompt ?? base.explain!.prompt).slice(0, 300),
        rubric: rubric.length ? rubric : base.explain!.rubric,
        modelAnswer: String(r.explain?.modelAnswer ?? base.explain!.modelAnswer).slice(0, 1200),
      };
    }

    return step;
  });

  const cp = raw?.contextPanel ?? {};
  const metrics = (Array.isArray(cp.metrics) ? cp.metrics : [])
    .slice(0, 4)
    .map((m: any) => ({
      label: String(m?.label ?? '').slice(0, 30),
      value: String(m?.value ?? '').slice(0, 16),
      tone: ['good', 'warn', 'bad', 'neutral'].includes(m?.tone) ? m.tone : 'neutral',
    }))
    .filter((m: any) => m.label && m.value);

  const validRef = src.concepts.find((c) => c.sourceRef === raw?.sourceRef)?.sourceRef;

  return {
    id: uid('j'),
    createdAt: now(),
    mode: raw?.mode === 'explain' ? 'explain' : 'scenario',
    analogy: loc(raw?.analogy, skeleton.analogy.en),
    media: {
      imagePrompt: String(raw?.media?.imagePrompt ?? skeleton.media.imagePrompt).slice(0, 300),
      videoSearchQuery: String(raw?.media?.videoSearchQuery ?? skeleton.media.videoSearchQuery).slice(0, 120),
    },
    title: loc(raw?.title, skeleton.title.en),
    missionLabel: loc(raw?.missionLabel, skeleton.missionLabel.en),
    topic: src.topic,
    sourceName: src.sourceName,
    sourceRef: validRef ?? skeleton.sourceRef,
    concepts: src.concepts,
    conceptCount: src.conceptCount,
    learnerType: input.learnerType,
    tone: input.tone ?? cfg.defaultTone,
    difficulty: input.difficulty ?? cfg.defaultDifficulty,
    language: input.language,
    constraint: input.constraint,
    contextPanel: {
      title: String(cp.title ?? skeleton.contextPanel.title).slice(0, 80),
      subtitle: String(cp.subtitle ?? skeleton.contextPanel.subtitle).slice(0, 80),
      metrics: metrics.length ? metrics : skeleton.contextPanel.metrics,
      waveform: ['ecg', 'wave', 'none'].includes(cp.waveform) ? cp.waveform : skeleton.contextPanel.waveform,
      caption: String(cp.caption ?? skeleton.contextPanel.caption).slice(0, 160),
      audioCue: cp.audioCue?.label
        ? {
            label: String(cp.audioCue.label).slice(0, 40),
            kind: ['heartbeat', 'tone', 'none'].includes(cp.audioCue.kind) ? cp.audioCue.kind : 'tone',
          }
        : skeleton.contextPanel.audioCue,
    },
    steps,
    provider: meta.provider,
    model: meta.model,
    latencyMs: meta.latencyMs,
    grounded: true,
    groundingNotes: [],
    degraded: false,
  };
}

export async function buildJourney(
  input: BuildJourneyInput,
  cfg: EngineConfig,
  log?: (m: string) => void,
  prior?: PriorSignals,
): Promise<BuildResult> {
  const rawText = sanitizeUserText(input.text ?? input.topic ?? '', cfg.maxSourceChars);
  const sourceName = (input.sourceName ?? (input.text ? 'Pasted text' : 'Topic')).slice(0, 80);
  const src = extractSource(rawText, sourceName, input.topic);

  const attemptLog: ChainAttempt[] = [];
  const chain = await completeWithFallback(
    {
      system: JOURNEY_SYSTEM,
      user: buildJourneyPrompt(src, input, cfg, prior),
      json: true,
      maxTokens: 6000,
      temperature: 0.8,
    },
    cfg.providerOrder,
    cfg.aiTimeoutMs,
    log,
    attemptLog,
  );

  if (!chain) {
    if (src.concepts.length < 2) {
      // Naming the actual cause matters: "no key configured" and "the key was
      // rejected" need completely different fixes from whoever is running this.
      const noKeys = providerStatus(cfg.providerOrder).every((p) => !p.configured);
      log?.(`[journey] no usable source and ${noKeys ? 'no AI key configured' : 'every provider failed'}`);
      const why = attemptLog
        .filter((a) => !a.ok && a.error)
        .map((a) => `${a.provider}: ${a.error}`)
        .join(' | ');
      throw new InsufficientSourceError(
        noKeys
          ? 'No AI key is configured on the server, so a one-line topic cannot be turned into a mission. Add GEMINI_API_KEY to apps/api/.env and restart the API — or paste a paragraph of text / upload a PDF, which works with no key at all.'
          : `Every AI provider failed. ${why || 'No detail returned.'} — a one-line topic needs a model, but pasting a paragraph or uploading a PDF works without one.`,
        attemptLog,
      );
    }
    log?.('[journey] all providers unavailable - using deterministic offline build');
    return { journey: buildOfflineJourney(src, input, cfg), attempts: [] };
  }

  try {
    const parsed = extractJson(chain.text);
    const journey = normalise(parsed, src, input, cfg, {
      provider: chain.provider,
      model: chain.model,
      latencyMs: chain.latencyMs,
    });

    if (cfg.requireGrounding && src.text.length > 400) {
      const generatedText = [
        ...journey.steps.map((s) => s.narrative.en),
        journey.steps[0]?.sim?.elements.map((e) => e.label).join(' ') ?? '',
        journey.steps[2]?.explain?.modelAnswer ?? '',
      ].join(' ');
      const g = checkGrounding(generatedText, src.text);
      journey.grounded = g.grounded;
      journey.groundingNotes = g.notes;
    } else {
      journey.groundingNotes = ['Source too short for a meaningful grounding check.'];
    }

    return { journey, attempts: chain.attempts };
  } catch (e: any) {
    log?.(`[journey] could not parse model output (${e?.message}) - falling back to offline build`);
    const fallback = buildOfflineJourney(src, input, cfg);
    fallback.groundingNotes = [`Model output was unusable (${String(e?.message).slice(0, 80)}); built from source directly.`];
    return { journey: fallback, attempts: chain.attempts };
  }
}
