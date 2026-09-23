import type { EngineConfig } from './types';

/**
 * Every number the panel might ask "can you change that without a rebuild?" about
 * lives here. The API persists overrides in Postgres and merges them at request
 * time, so the Configure screen edits behaviour live.
 */
export const DEFAULT_CONFIG: EngineConfig = {
  xpPerStep: [30, 30, 40],
  xpPerLevel: 100,
  hintPenaltyXp: 5,
  masteryUnlockThreshold: 0.7,
  masteryWeights: {
    explain_back_quality: 0.3,
    decisions_in_simulation: 0.25,
    working_without_hints: 0.15,
    self_correction: 0.12,
    confidence_matches_accuracy: 0.1,
    recall_after_break: 0.08,
  },
  masteryPriorStrength: 2,
  adaptationSensitivity: 0.5,
  defaultLanguage: 'en',
  defaultTone: 'coaching',
  defaultDifficulty: 3,
  defaultLearnerType: 'Curious learner',
  providerOrder: ['gemini', 'groq', 'openrouter', 'cerebras', 'github', 'mistral', 'offline'],
  aiTimeoutMs: 20000,
  maxSourceChars: 24000,
  requireGrounding: true,
  gamificationEnabled: true,
  learnerTypes: [
    'Nursing trainee',
    'Bank branch officer',
    'Call centre agent',
    'New joiner (any role)',
    'School student',
    'Compliance analyst',
    'Software engineer',
  ],
  constraints: [
    'standard',
    'low_bandwidth',
    'voice_only',
    'accessibility',
    'offline_first',
  ],
  badges: [
    {
      id: 'first_steps',
      label: 'First Steps',
      description: 'Completed your first step of a mission.',
      icon: 'spark',
      emoji: '🚀',
    },
    {
      id: 'unaided',
      label: 'Unaided',
      description: 'Finished a simulation without taking a hint.',
      icon: 'shield',
      emoji: '💪',
    },
    {
      id: 'curious',
      label: 'Curious Mind',
      description: 'Asked three or more questions of the case.',
      icon: 'question',
      emoji: '🤔',
    },
    {
      id: 'self_corrector',
      label: 'Self Corrector',
      description: 'Caught and fixed your own mistake before being told.',
      icon: 'loop',
      emoji: '🔁',
    },
    {
      id: 'explainer',
      label: 'Explainer',
      description: 'Explained the concept back in your own words at 70%+.',
      icon: 'voice',
      emoji: '🎤',
    },
    {
      id: 'mission_clear',
      label: 'Mission Clear',
      description: 'Completed a full mission and levelled up.',
      icon: 'trophy',
      emoji: '🏆',
    },
    {
      id: 'bilingual',
      label: 'Bilingual',
      description: 'Learned the same concept in both English and Urdu.',
      icon: 'globe',
      emoji: '🌍',
    },
  ],
};

export function mergeConfig(
  base: EngineConfig,
  patch: Partial<EngineConfig> | null | undefined,
): EngineConfig {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    masteryWeights: { ...base.masteryWeights, ...(patch.masteryWeights ?? {}) },
    badges: patch.badges ?? base.badges,
    xpPerStep: (patch.xpPerStep ?? base.xpPerStep) as [number, number, number],
  };
}

/** Guardrails so a bad admin edit cannot brick the learner experience. */
export function sanitizeConfig(cfg: EngineConfig): EngineConfig {
  const clamp = (n: number, lo: number, hi: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  return {
    ...cfg,
    xpPerStep: [
      clamp(cfg.xpPerStep?.[0] ?? 30, 0, 500),
      clamp(cfg.xpPerStep?.[1] ?? 30, 0, 500),
      clamp(cfg.xpPerStep?.[2] ?? 40, 0, 500),
    ],
    xpPerLevel: clamp(cfg.xpPerLevel, 10, 10000),
    hintPenaltyXp: clamp(cfg.hintPenaltyXp, 0, 100),
    masteryUnlockThreshold: clamp(cfg.masteryUnlockThreshold, 0.1, 0.99),
    masteryPriorStrength: clamp(cfg.masteryPriorStrength, 0.1, 20),
    adaptationSensitivity: clamp(cfg.adaptationSensitivity, 0, 1),
    defaultDifficulty: clamp(cfg.defaultDifficulty, 1, 5),
    aiTimeoutMs: clamp(cfg.aiTimeoutMs, 2000, 60000),
    maxSourceChars: clamp(cfg.maxSourceChars, 500, 200000),
  };
}
