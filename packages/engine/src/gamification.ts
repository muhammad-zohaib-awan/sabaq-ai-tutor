import type {
  AdaptationState,
  Badge,
  EngineConfig,
  LearnerProgress,
  LearningEvent,
  MasteryState,
} from './types';
import { clamp } from './util';

export function progressFromXp(xp: number, cfg: EngineConfig): LearnerProgress {
  const per = Math.max(1, cfg.xpPerLevel);
  const level = Math.floor(xp / per) + 1;
  return {
    xp,
    level,
    xpIntoLevel: xp % per,
    xpForLevel: per,
    badges: [],
    streakDays: 0,
  };
}

export interface AwardOutcome {
  xpAwarded: number;
  totalXp: number;
  progress: LearnerProgress;
  leveledUp: boolean;
  newBadges: Badge[];
}

/**
 * XP is awarded per completed step (30 / 30 / 40 by default, admin-editable),
 * minus a hint penalty. Badges are evaluated against the whole event stream, so
 * they can never be farmed by replaying the same click.
 */
export function award(args: {
  currentXp: number;
  earnedBadges: string[];
  stepIndex: number;
  hintsUsedInStep: number;
  events: LearningEvent[];
  mastery: MasteryState;
  cfg: EngineConfig;
}): AwardOutcome {
  const { cfg } = args;
  const base = cfg.xpPerStep[args.stepIndex] ?? 0;
  const penalty = args.hintsUsedInStep * cfg.hintPenaltyXp;
  const xpAwarded = Math.max(0, base - penalty);
  const totalXp = args.currentXp + xpAwarded;

  const before = progressFromXp(args.currentXp, cfg);
  const progress = progressFromXp(totalXp, cfg);
  const leveledUp = progress.level > before.level;

  const have = new Set(args.earnedBadges);
  const newBadges = evaluateBadges({
    events: args.events,
    mastery: args.mastery,
    stepIndex: args.stepIndex,
    hintsUsedInStep: args.hintsUsedInStep,
    leveledUp,
    cfg,
  }).filter((b) => !have.has(b.id));

  progress.badges = [...args.earnedBadges, ...newBadges.map((b) => b.id)];

  return { xpAwarded, totalXp, progress, leveledUp, newBadges };
}

export function evaluateBadges(args: {
  events: LearningEvent[];
  mastery: MasteryState;
  stepIndex: number;
  hintsUsedInStep: number;
  leveledUp: boolean;
  cfg: EngineConfig;
}): Badge[] {
  const byId = new Map(args.cfg.badges.map((b) => [b.id, b]));
  const out: Badge[] = [];
  const push = (id: string) => {
    const b = byId.get(id);
    if (b && !out.some((x) => x.id === id)) out.push(b);
  };

  const count = (t: string) => args.events.filter((e) => e.type === t).length;
  const langs = new Set(
    args.events.map((e) => String((e.payload as any)?.language ?? '')).filter(Boolean),
  );

  if (count('step_completed') >= 1 || args.stepIndex === 0) push('first_steps');
  if (args.stepIndex === 0 && args.hintsUsedInStep === 0) push('unaided');
  if (count('question_asked') >= 3) push('curious');
  if (count('self_corrected') >= 1) push('self_corrector');

  const explains = args.events.filter((e) => e.type === 'explain_submitted');
  if (explains.some((e) => Number((e.payload as any)?.score ?? 0) >= 0.7)) push('explainer');

  if (args.leveledUp) push('mission_clear');
  if (langs.size >= 2) push('bilingual');

  return out;
}

/* ---------------------------------------------------------- adaptation */

/**
 * Real-time adaptation policy. Deliberately explainable: every change the learner
 * feels has a reason string attached, and the admin can see exactly why the
 * difficulty moved. Opaque adaptation is indistinguishable from a bug.
 */
export function adapt(args: {
  mastery: MasteryState;
  events: LearningEvent[];
  currentDifficulty: number;
  cfg: EngineConfig;
}): AdaptationState {
  const { mastery, events, cfg } = args;
  const s = (id: string) => mastery.signals.find((x) => x.id === id);
  const reasons: string[] = [];
  let delta = 0;

  const hints = s('working_without_hints');
  const decisions = s('decisions_in_simulation');
  const explain = s('explain_back_quality');
  const calib = s('confidence_matches_accuracy');

  if (decisions && decisions.evidence > 0) {
    if (decisions.value >= 0.85) {
      delta += 1;
      reasons.push('Simulation decisions are consistently right on the first try.');
    } else if (decisions.value <= 0.4) {
      delta -= 1;
      reasons.push('Simulation decisions are missing more often than not.');
    }
  }
  if (hints && hints.evidence > 0 && hints.value <= 0.5) {
    delta -= 1;
    reasons.push('Hints are being used on most attempts.');
  }
  if (explain && explain.evidence > 0) {
    if (explain.value >= 0.8) {
      delta += 1;
      reasons.push('Explanations are accurate and in their own words.');
    } else if (explain.value <= 0.45) {
      delta -= 1;
      reasons.push('Explain-back is missing key parts of the idea.');
    }
  }
  if (calib && calib.evidence > 0 && calib.value <= 0.5) {
    reasons.push('Confidence and accuracy are out of step — hints will get more Socratic.');
  }

  // Pace signal: very fast completions with low accuracy means skimming.
  const completions = events.filter((e) => e.type === 'step_completed');
  const avgSeconds =
    completions.length > 0
      ? completions.reduce((a, e) => a + Number((e.payload as any)?.seconds ?? 0), 0) / completions.length
      : 0;

  let pace: AdaptationState['pace'] = 'steady';
  if (avgSeconds > 0 && avgSeconds < 25 && (decisions?.value ?? 1) < 0.6) {
    pace = 'slower';
    reasons.push('Moving very fast with low accuracy — slowing the pace down.');
  } else if (avgSeconds > 0 && avgSeconds < 45 && (decisions?.value ?? 0) > 0.8) {
    pace = 'faster';
    reasons.push('Fast and accurate — pace increased.');
  }

  const scaled = delta * (0.5 + cfg.adaptationSensitivity);
  const difficulty = Math.round(clamp(args.currentDifficulty + scaled, 1, 5) * 10) / 10;

  const magnitude = Math.abs(scaled);
  const level: AdaptationState['level'] = magnitude >= 1.2 ? 'high' : magnitude >= 0.4 ? 'medium' : 'low';

  const hintStyle: AdaptationState['hintStyle'] =
    (calib?.value ?? 1) <= 0.5 ? 'socratic' : (hints?.value ?? 0) >= 0.8 ? 'minimal' : 'direct';

  if (!reasons.length) {
    reasons.push('Watching pace, hints and confidence. Nothing has moved yet.');
  }

  return {
    level,
    difficulty,
    hintStyle,
    pace,
    summary:
      mastery.hasEvidence
        ? `Difficulty ${difficulty.toFixed(1)}/5, ${hintStyle} hints, ${pace} pace.`
        : 'Watching pace, hints and confidence. Difficulty and hint style adjust as you go.',
    reasons,
  };
}
