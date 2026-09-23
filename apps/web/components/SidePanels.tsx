'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { api } from '@/lib/api';

/** Evidence bar: filled proportion of a dotted track, or nothing at all. */
function EvidenceBar({ value, evidence }: { value: number; evidence: number }) {
  if (!evidence) return <div className="dots h-1.5 w-full rounded-full opacity-50" />;
  const color = value >= 0.7 ? 'bg-good' : value >= 0.45 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="dots h-1.5 w-full overflow-hidden rounded-full">
      <div
        className={`h-full rounded-full ${color} transition-all duration-700`}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

export function MasteryPanel({ mastery, lang }: { mastery: any; lang: any }) {
  const [open, setOpen] = useState(false);
  const has = mastery?.hasEvidence;
  const pct = Math.round((mastery?.overall ?? 0) * 100);

  return (
    <section className="panel p-5">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{t('inferredMastery', lang)}</h2>
        {has ? (
          <span className="chip bg-accent/20 text-accent-soft tabular-nums">
            {pct}% · {Math.round((mastery.confidence ?? 0) * 100)}% conf
          </span>
        ) : (
          <span className="chip bg-amber-400/15 text-amber-200">{t('noEvidence', lang)}</span>
        )}
      </header>

      <div className="mt-4">
        {has ? (
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-good transition-all duration-1000"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <div className="h-2 w-10 rounded-full bg-white/20" />
        )}
      </div>

      <p className="mt-3 text-xs text-slate-400">{t('builtFrom', lang)}</p>

      <ul className="mt-4 space-y-3">
        {(mastery?.signals ?? []).map((s: any) => (
          <li key={s.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-200">{s.label}</span>
              <span className={`text-xs tabular-nums ${s.evidence ? 'text-slate-300' : 'text-slate-500'}`}>
                {s.evidence ? `${Math.round(s.value * 100)}%` : s.id === 'recall_after_break' ? 'later' : 'no evidence'}
              </span>
            </div>
            <div className="mt-1.5">
              <EvidenceBar value={s.value} evidence={s.evidence} />
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-accent-soft hover:underline"
        aria-expanded={open}
      >
        <span className={`transition ${open ? 'rotate-90' : ''}`}>▸</span>
        {t('whyThisNumber', lang)}
      </button>

      {open && (
        <ul className="mt-2 space-y-1.5 rounded-xl bg-ink-900/60 p-3 text-xs leading-relaxed text-slate-400">
          {(mastery?.rationale ?? []).map((r: string, i: number) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdaptationCard({ adaptation, lang }: { adaptation: any; lang: any }) {
  const [open, setOpen] = useState(false);
  const level = adaptation?.level ?? 'low';
  const tone =
    level === 'high' ? 'bg-bad/20 text-bad' : level === 'medium' ? 'bg-warn/20 text-warn' : 'bg-white/10 text-slate-300';

  return (
    <section className="panel p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{t('adaptation', lang)}</h2>
        <span className={`chip capitalize ${tone}`}>{level}</span>
      </header>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{adaptation?.summary}</p>

      {adaptation?.reasons?.length ? (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-3 text-xs font-semibold text-accent-soft hover:underline"
            aria-expanded={open}
          >
            {open ? 'Hide reasons' : 'What moved it?'}
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-400">
              {adaptation.reasons.map((r: string, i: number) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

const BADGE_DOT: Record<string, string> = {
  spark: '🚀',
  shield: '💪',
  question: '🤔',
  loop: '🔁',
  voice: '🎤',
  trophy: '🏆',
  globe: '🌍',
};

export function LevelCard({
  progress,
  badges,
  threshold,
  mastery,
  lang,
}: {
  progress: any;
  badges: any[];
  threshold: number;
  mastery: any;
  lang: any;
}) {
  const earned = new Set(progress?.badges ?? []);
  const pct = progress ? Math.round((progress.xpIntoLevel / Math.max(1, progress.xpForLevel)) * 100) : 0;

  return (
    <section className="panel p-5">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold">
          {t('level', lang)} {progress?.level ?? 1} · {t('trainee', lang)}
        </h2>
        <span className="text-xs tabular-nums text-slate-400">
          {progress?.xpIntoLevel ?? 0} / {progress?.xpForLevel ?? 100} XP
        </span>
      </header>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {badges.map((b) => {
          const has = earned.has(b.id);
          return (
            <li
              key={b.id}
              title={b.description}
              className={`chip border ${
                has
                  ? 'border-accent/40 bg-accent/15 text-accent-soft'
                  : 'border-white/10 bg-white/5 text-slate-500'
              }`}
            >
              <span aria-hidden>{b.emoji ?? BADGE_DOT[b.icon] ?? '✨'}</span>
              {b.label}
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-slate-400">
        {progress?.streakDays ? `${progress.streakDays}-${t('streak', lang)}. ` : ''}
        {t('nextMission', lang)} {Math.round(threshold * 100)}% {t('mastery', lang)}
        {mastery?.hasEvidence ? ` · now ${Math.round(mastery.overall * 100)}%` : ''}.
      </p>
    </section>
  );
}

export function LiveTestPanel({ onBuildClick }: { onBuildClick: () => void }) {
  const { lang, journey, setJourney, refreshState, toast } = useApp();
  const [learnerType, setLearnerType] = useState(journey?.learnerType || 'Nursing trainee');
  const [constraint, setConstraint] = useState(journey?.constraint || 'standard');
  const [busy, setBusy] = useState(false);

  const LEARNER_TYPES = ['Nursing trainee', 'Bank branch officer', 'Call centre agent', 'New joiner (any role)', 'School student', 'Compliance analyst', 'Software engineer'];
  const CONSTRAINTS = [
    { id: 'standard', label: 'Standard' },
    { id: 'low_bandwidth', label: 'Low bandwidth' },
    { id: 'voice_only', label: 'Voice only' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'offline_first', label: 'Offline first' },
  ];

  async function rebuild() {
    if (!journey) return;
    setBusy(true);
    try {
      const res = await api.build({
        topic: journey.topic,
        text: '',
        learnerType,
        language: lang,
        constraint,
        difficulty: journey.difficulty,
      });
      const newJourney = res.journey ?? res;
      setJourney(newJourney);
      await refreshState(newJourney.id);
      toast('success', 'Journey rebuilt with new settings');
    } catch (e: any) {
      toast('error', e?.message || 'Could not rebuild');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Live Test Config</h2>
      </header>

      <div className="mt-4 space-y-3">
        <div>
          <span className="text-xs font-semibold text-slate-400">Content</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-sm truncate max-w-[150px]">{journey?.sourceName || 'Topic'}</span>
            <button onClick={onBuildClick} className="btn-ghost text-xs px-2 py-1">Change content</button>
          </div>
        </div>

        <div>
          <span className="text-xs font-semibold text-slate-400">Learner Type</span>
          <select value={learnerType} onChange={e => setLearnerType(e.target.value)} className="field mt-1 text-sm py-1.5">
            {LEARNER_TYPES.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>

        <div>
          <span className="text-xs font-semibold text-slate-400">Constraint</span>
          <select value={constraint} onChange={e => setConstraint(e.target.value)} className="field mt-1 text-sm py-1.5">
            {CONSTRAINTS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>

        <button 
          onClick={rebuild}
          disabled={busy}
          className="mt-4 w-full btn-primary"
        >
          {busy ? 'Building...' : 'Apply & Rebuild'}
        </button>
      </div>
    </section>
  );
}

/**
 * The learner's own rail.
 *
 * Deliberately NOT the mastery panel. A learner is shown what they have earned
 * and what is left to do; what the engine has inferred about them is reporting,
 * and reporting belongs to the admin. Telling someone mid-mission that they are
 * "at 44% with 12% confidence" is a number they cannot act on and will only
 * play to.
 */
export function LearnerProgress({
  progress,
  badges,
  steps,
  stepDone,
  lang,
}: {
  progress: any;
  badges: any[];
  steps: any[];
  stepDone: Record<string, boolean>;
  lang: any;
}) {
  const earned = new Set(progress?.badges ?? []);
  const pct = progress
    ? Math.round((progress.xpIntoLevel / Math.max(1, progress.xpForLevel)) * 100)
    : 0;
  const done = (steps ?? []).filter((s) => stepDone?.[s.id]).length;
  const total = (steps ?? []).length || 3;

  return (
    <>
      <section className="panel p-5">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">
            {t('level', lang)} {progress?.level ?? 1}
          </h2>
          <span className="text-xs tabular-nums text-slate-400">
            {progress?.xpIntoLevel ?? 0} / {progress?.xpForLevel ?? 100} XP
          </span>
        </header>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-3 text-sm text-slate-300">
          {done} of {total} steps done in this mission.
        </p>
        {progress?.streakDays ? (
          <p className="mt-1 text-xs text-slate-500">{progress.streakDays}-day streak.</p>
        ) : null}
      </section>

      <section className="panel p-5">
        <h2 className="text-lg font-bold">Badges</h2>
        <p className="mt-1 text-xs text-slate-500">
          Earned for how you work, not for turning up.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {badges.map((b) => {
            const has = earned.has(b.id);
            return (
              <li
                key={b.id}
                title={b.description}
                className={`chip border ${
                  has
                    ? 'border-accent/40 bg-accent/15 text-accent-soft'
                    : 'border-white/10 bg-white/5 text-slate-500'
                }`}
              >
                <span aria-hidden>{b.emoji ?? BADGE_DOT[b.icon] ?? '✨'}</span>
                {b.label}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
