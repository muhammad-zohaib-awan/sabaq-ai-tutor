'use client';

/**
 * Who is learning, and under what constraint.
 *
 * Shared by the launcher and the admin Live Test so the panel can change the
 * learner type or constraint the same way a learner does. Both lists end in
 * "Other", which opens a free-text field — the engine writes the mission for
 * whatever the person actually types, not only for our presets.
 */

export const LEARNER_PRESETS = [
  'Software developer',
  'Student',
  'Medical student',
  'Nursing trainee',
  'New bank teller',
  'Call centre agent',
  'Compliance analyst',
  'Manager',
];

export const CONSTRAINT_PRESETS: Array<{ id: string; label: string; help: string }> = [
  { id: 'standard', label: 'Standard', help: 'No special constraint.' },
  { id: 'low_bandwidth', label: 'Low bandwidth', help: 'Short text, no heavy visuals.' },
  { id: 'voice_only', label: 'Voice only', help: 'Everything makes sense read aloud.' },
  { id: 'accessibility', label: 'Accessibility first', help: 'Screen-reader friendly, no colour-only meaning.' },
  { id: 'offline_first', label: 'Offline first', help: 'Self-contained, no external links.' },
];

export const OTHER = '__other__';

export interface LearnerValue {
  learnerPreset: string;
  learnerOther: string;
  constraint: string;
  constraintOther: string;
}

export const defaultLearnerValue = (learner = 'Software developer'): LearnerValue => ({
  learnerPreset: LEARNER_PRESETS.includes(learner) ? learner : OTHER,
  learnerOther: LEARNER_PRESETS.includes(learner) ? '' : learner,
  constraint: 'standard',
  constraintOther: '',
});

/** What the API expects. "Other" constraint maps to standard + a free-text note. */
export function resolveLearner(v: LearnerValue) {
  const learnerType = (v.learnerPreset === OTHER ? v.learnerOther : v.learnerPreset).trim() || 'Curious learner';
  const custom = v.constraint === OTHER;
  return {
    learnerType,
    constraint: custom ? 'standard' : v.constraint,
    constraintNote: custom ? v.constraintOther.trim() : '',
  };
}

export function LearnerFields({
  value,
  onChange,
  compact = false,
  hideLearner = false,
}: {
  value: LearnerValue;
  onChange: (v: LearnerValue) => void;
  compact?: boolean;
  /** The launcher asks for the learner inline in its sentence instead. */
  hideLearner?: boolean;
}) {
  const set = (patch: Partial<LearnerValue>) => onChange({ ...value, ...patch });
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
      active
        ? 'border-accent bg-accent/15 text-slate-50'
        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
    }`;

  return (
    <div className={`grid gap-5 ${compact || hideLearner ? '' : 'sm:grid-cols-2'}`}>
      {!hideLearner && (
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-200">Learner type</legend>
        <div className="flex flex-wrap gap-1.5">
          {LEARNER_PRESETS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={value.learnerPreset === l}
              onClick={() => set({ learnerPreset: l })}
              className={chip(value.learnerPreset === l)}
            >
              {l}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={value.learnerPreset === OTHER}
            onClick={() => set({ learnerPreset: OTHER })}
            className={chip(value.learnerPreset === OTHER)}
          >
            Other…
          </button>
        </div>
        {value.learnerPreset === OTHER && (
          <input
            className="field mt-2"
            value={value.learnerOther}
            maxLength={80}
            autoFocus
            onChange={(e) => set({ learnerOther: e.target.value })}
            placeholder="e.g. ICU nurse, class 7 student, first-time founder"
            aria-label="Describe the learner"
          />
        )}
      </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-200">Constraint</legend>
        <div className="flex flex-wrap gap-1.5">
          {CONSTRAINT_PRESETS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.help}
              aria-pressed={value.constraint === c.id}
              onClick={() => set({ constraint: c.id })}
              className={chip(value.constraint === c.id)}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={value.constraint === OTHER}
            onClick={() => set({ constraint: OTHER })}
            className={chip(value.constraint === OTHER)}
          >
            Other…
          </button>
        </div>
        {value.constraint === OTHER ? (
          <input
            className="field mt-2"
            value={value.constraintOther}
            maxLength={160}
            autoFocus
            onChange={(e) => set({ constraintOther: e.target.value })}
            placeholder="e.g. only 5 minutes, on a phone, colour-blind, no jargon"
            aria-label="Describe the constraint"
          />
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">
            {CONSTRAINT_PRESETS.find((c) => c.id === value.constraint)?.help}
          </p>
        )}
      </fieldset>
    </div>
  );
}
