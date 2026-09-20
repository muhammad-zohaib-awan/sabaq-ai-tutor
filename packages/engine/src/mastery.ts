import type {
  EngineConfig,
  LearningEvent,
  MasterySignal,
  MasterySignalId,
  MasteryState,
} from './types';
import { clamp } from './util';

const LABELS: Record<MasterySignalId, string> = {
  explain_back_quality: 'Explain-back quality',
  decisions_in_simulation: 'Decisions in the simulation',
  working_without_hints: 'Working without hints',
  self_correction: 'Self-correction',
  confidence_matches_accuracy: 'Confidence matches accuracy',
  recall_after_break: 'Recall after a break',
};

interface Acc {
  sum: number;
  n: number;
  note: string;
}

const empty = (): Acc => ({ sum: 0, n: 0, note: '' });

/**
 * Mastery without a test.
 *
 * Every signal is an independent stream of weak evidence. We never let a single
 * lucky click move the number much: the weighted mean is shrunk toward a 0.5
 * prior by `masteryPriorStrength`, so confidence grows with evidence rather than
 * with optimism. A learner who has done nothing reads "no evidence yet" rather
 * than a fabricated 50%.
 */
export function inferMastery(events: LearningEvent[], cfg: EngineConfig): MasteryState {
  const acc: Record<MasterySignalId, Acc> = {
    explain_back_quality: empty(),
    decisions_in_simulation: empty(),
    working_without_hints: empty(),
    self_correction: empty(),
    confidence_matches_accuracy: empty(),
    recall_after_break: empty(),
  };

  let hintsTaken = 0;
  let simRuns = 0;
  let questionsAsked = 0;
  const calibration: Array<{ stated: number; actual: number }> = [];

  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const e of sorted) {
    const p: any = e.payload ?? {};
    switch (e.type) {
      case 'explain_submitted': {
        const score = clamp(Number(p.score ?? 0));
        acc.explain_back_quality.sum += score;
        acc.explain_back_quality.n += 1;
        if (p.confidenceLanguage) {
          const stated =
            p.confidenceLanguage === 'overconfident' ? 0.9 : p.confidenceLanguage === 'hedged' ? 0.35 : 0.6;
          calibration.push({ stated, actual: score });
        }
        break;
      }
      case 'sim_run': {
        simRuns += 1;
        const correctRatio = clamp(Number(p.correctRatio ?? 0));
        const firstAttempt = p.attempt === 1;
        // A first-attempt success is worth full weight; later successes count less.
        const weighted = firstAttempt ? correctRatio : correctRatio * 0.6;
        acc.decisions_in_simulation.sum += weighted;
        acc.decisions_in_simulation.n += 1;
        if (typeof p.statedConfidence === 'number') {
          calibration.push({ stated: clamp(Number(p.statedConfidence)), actual: correctRatio });
        }
        break;
      }
      case 'hint_used':
        hintsTaken += 1;
        break;
      case 'question_asked':
        questionsAsked += 1;
        break;
      case 'self_corrected':
        acc.self_correction.sum += 1;
        acc.self_correction.n += 1;
        break;
      case 'step_completed': {
        // Recall after a break: correct work resumed more than 20 minutes after
        // the previous event on the same journey.
        const gap = Number(p.gapMinutesSincePrevious ?? 0);
        if (gap >= 20 && typeof p.score === 'number') {
          acc.recall_after_break.sum += clamp(Number(p.score));
          acc.recall_after_break.n += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  if (simRuns > 0 || questionsAsked > 0) {
    const opportunities = simRuns + questionsAsked;
    acc.working_without_hints.sum = clamp(1 - hintsTaken / Math.max(1, opportunities));
    acc.working_without_hints.n = opportunities;
    acc.working_without_hints.note = `${hintsTaken} hint(s) over ${opportunities} opportunit${opportunities === 1 ? 'y' : 'ies'}`;
  }

  if (calibration.length) {
    // 1 - mean absolute gap between how sure they sounded and how right they were.
    const err =
      calibration.reduce((a, c) => a + Math.abs(c.stated - c.actual), 0) / calibration.length;
    acc.confidence_matches_accuracy.sum = clamp(1 - err);
    acc.confidence_matches_accuracy.n = calibration.length;
  }

  if (acc.self_correction.n === 0 && simRuns >= 2) {
    // No self-correction observed despite multiple attempts is weak negative evidence.
    acc.self_correction.sum = 0.35;
    acc.self_correction.n = 1;
    acc.self_correction.note = 'no self-correction observed yet';
  }

  const signals: MasterySignal[] = (Object.keys(LABELS) as MasterySignalId[]).map((id) => {
    const a = acc[id];
    const value = a.n > 0 ? clamp(a.sum / a.n) : 0;
    return {
      id,
      label: LABELS[id],
      value,
      evidence: a.n,
      weight: cfg.masteryWeights[id] ?? 0,
      note: a.note || (a.n === 0 ? 'no evidence' : `${a.n} observation${a.n === 1 ? '' : 's'}`),
    };
  });

  const withEvidence = signals.filter((s) => s.evidence > 0 && s.weight > 0);
  const k = cfg.masteryPriorStrength;
  const weightSum = withEvidence.reduce((a, s) => a + s.weight * Math.min(s.evidence, 8), 0);
  const valueSum = withEvidence.reduce((a, s) => a + s.weight * Math.min(s.evidence, 8) * s.value, 0);

  const overall = weightSum > 0 ? (0.5 * k + valueSum) / (k + weightSum) : 0;
  const confidence = clamp(weightSum / (weightSum + k * 2));

  const rationale: string[] = [];
  if (!withEvidence.length) {
    rationale.push('No evidence has been collected yet. Nothing is inferred from an empty session.');
  } else {
    for (const s of withEvidence.sort((a, b) => b.weight * b.evidence - a.weight * a.evidence).slice(0, 4)) {
      rationale.push(
        `${s.label}: ${Math.round(s.value * 100)}% over ${s.evidence} observation${s.evidence === 1 ? '' : 's'} (weight ${s.weight}).`,
      );
    }
    rationale.push(
      `Shrunk toward a 50% prior with strength ${k}, so early sessions stay honest about how little is known.`,
    );
  }

  return {
    overall: Number(overall.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    signals,
    rationale,
    hasEvidence: withEvidence.length > 0,
  };
}

/**
 * Local, model-free scoring of an explanation. Used as a floor under the model's
 * judgement (and as the whole score when every provider is down).
 */
export function scoreExplanationLocally(
  answer: string,
  rubric: Array<{ id: string; label: string; keywords: string[]; weight: number }>,
): { overall: number; rubricScores: Array<{ id: string; score: number }> } {
  const text = (answer || '').toLowerCase();
  const rubricScores = rubric.map((r) => {
    if (!r.keywords.length) return { id: r.id, score: text.length > 40 ? 0.5 : 0.2 };
    const hits = r.keywords.filter((k) => text.includes(String(k).toLowerCase())).length;
    return { id: r.id, score: clamp(hits / Math.max(1, Math.min(3, r.keywords.length))) };
  });
  const lengthFactor = clamp(text.split(/\s+/).filter(Boolean).length / 35);
  const weighted = rubric.reduce(
    (a, r, i) => a + r.weight * (rubricScores[i]?.score ?? 0),
    0,
  );
  return { overall: clamp(weighted * (0.6 + 0.4 * lengthFactor)), rubricScores };
}
