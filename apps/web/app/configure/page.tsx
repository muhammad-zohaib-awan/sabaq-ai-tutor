'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';

interface Row {
  key: string;
  label: string;
  help: string;
  kind: 'range' | 'number' | 'text' | 'select' | 'bool' | 'xp';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  format?: (v: any) => string;
}

const ROWS: Row[] = [
  {
    key: 'xpPerStep',
    label: 'XP per step',
    kind: 'xp',
    help: 'Awarded on step 1, 2 and 3. A hint costs XP from the step it was used on.',
  },
  { key: 'xpPerLevel', label: 'XP per level', kind: 'number', min: 10, max: 1000, help: 'How much XP a learner needs to level up.' },
  { key: 'hintPenaltyXp', label: 'Hint penalty (XP)', kind: 'number', min: 0, max: 50, help: 'Deducted per hint taken. Set to 0 to make hints free.' },
  {
    key: 'masteryUnlockThreshold',
    label: 'Mastery to unlock the next mission',
    kind: 'range',
    min: 0.1,
    max: 0.99,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
    help: 'Inferred mastery a learner must reach before the next mission opens.',
  },
  {
    key: 'masteryPriorStrength',
    label: 'Mastery prior strength',
    kind: 'range',
    min: 0.5,
    max: 10,
    step: 0.5,
    help: 'How strongly the score is pulled toward 50% when evidence is thin. Higher = more sceptical of early signals.',
  },
  {
    key: 'adaptationSensitivity',
    label: 'Adaptation sensitivity',
    kind: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v) => `${Math.round(v * 100)}%`,
    help: 'How aggressively difficulty moves in response to performance.',
  },
  { key: 'defaultDifficulty', label: 'Starting difficulty', kind: 'range', min: 1, max: 5, step: 1, help: 'Where a new learner begins before any adaptation.' },
  { key: 'defaultTone', label: 'Default tone', kind: 'select', options: ['coaching', 'socratic', 'formal', 'playful', 'mentor'], help: 'Voice the AI adopts when nothing else is specified.' },
  { key: 'defaultLanguage', label: 'Default language', kind: 'select', options: ['en', 'ur', 'mix'], help: 'en = English, ur = Urdu script, mix = Roman Urdu with English terms.' },
  { key: 'defaultLearnerType', label: 'Default learner type', kind: 'text', help: 'Used when a journey is built without a learner type.' },
  { key: 'aiTimeoutMs', label: 'AI timeout (ms)', kind: 'number', min: 2000, max: 60000, help: 'How long one provider gets before the chain falls through to the next.' },
  { key: 'requireGrounding', label: 'Run the grounding check', kind: 'bool', help: 'Verifies generated missions against the source and flags unsupported figures.' },
  {
    key: 'gamificationEnabled',
    label: 'Gamification language',
    kind: 'bool',
    help: 'On: missions can use "unlock" and progress language. Off: the interaction and the decision stay, but the game framing is dropped from generated copy — for audiences where it would not land.',
  },
];

const SIGNAL_LABELS: Record<string, string> = {
  explain_back_quality: 'Explain-back quality',
  decisions_in_simulation: 'Decisions in the simulation',
  working_without_hints: 'Working without hints',
  self_correction: 'Self-correction',
  confidence_matches_accuracy: 'Confidence matches accuracy',
  recall_after_break: 'Recall after a break',
};

export default function ConfigurePage() {
  const { toast, user } = useApp();
  const [config, setConfig] = useState<any>(null);
  const [defaults, setDefaults] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [providers, setProviders] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([api.config(), api.providers().catch(() => null)]);
        setConfig(c.config);
        setDefaults(c.defaults);
        setDraft(c.config);
        setProviders(p);
      } catch (e: any) {
        toast('error', e?.message ?? 'Could not load configuration.');
      }
    })();
  }, [toast]);

  if (user && user.role !== 'admin') {
    return <p className="panel p-6 text-slate-300">This screen is for administrators.</p>;
  }
  if (!config) {
    return <p className="p-6 text-slate-400">Loading configuration…</p>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function set(key: string, value: any) {
    setDraft((d: any) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const patch: any = {};
      for (const k of Object.keys(draft)) {
        if (JSON.stringify(draft[k]) !== JSON.stringify(config[k])) patch[k] = draft[k];
      }
      const res = await api.saveConfig(patch);
      setConfig(res.config);
      setDraft(res.config);
      toast('success', 'Saved. Every session picks this up on its next request — no redeploy.');
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const res = await api.resetConfig();
      setConfig(res.config);
      setDraft(res.config);
      toast('info', 'Reset to shipped defaults.');
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not reset.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Configure</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Every number the engine runs on lives here. Changes are validated, written to Postgres and
            read by the next request — nothing is rebuilt or redeployed.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={reset} disabled={saving}>
            Reset to defaults
          </button>
          <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel divide-y divide-white/5">
          {ROWS.map((row) => {
            const value = draft[row.key];
            const changed = JSON.stringify(value) !== JSON.stringify(config[row.key]);
            return (
              <div key={row.key} className="grid gap-3 p-5 sm:grid-cols-[1fr_260px] sm:items-center">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    {row.label}
                    {changed && <span className="chip bg-accent/20 text-accent-soft">changed</span>}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{row.help}</p>
                </div>

                <div>
                  {row.kind === 'xp' && (
                    <div className="flex gap-2">
                      {[0, 1, 2].map((i) => (
                        <input
                          key={i}
                          type="number"
                          min={0}
                          max={500}
                          aria-label={`XP for step ${i + 1}`}
                          className="field text-center"
                          value={value?.[i] ?? 0}
                          onChange={(e) => {
                            const next = [...(value ?? [0, 0, 0])];
                            next[i] = Number(e.target.value);
                            set(row.key, next);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {row.kind === 'range' && (
                    <div>
                      <input
                        type="range"
                        min={row.min}
                        max={row.max}
                        step={row.step}
                        value={value ?? 0}
                        onChange={(e) => set(row.key, Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                      <p className="mt-1 text-right text-sm font-semibold tabular-nums text-slate-200">
                        {row.format ? row.format(value) : value}
                      </p>
                    </div>
                  )}

                  {row.kind === 'number' && (
                    <input
                      type="number"
                      min={row.min}
                      max={row.max}
                      className="field"
                      value={value ?? 0}
                      onChange={(e) => set(row.key, Number(e.target.value))}
                    />
                  )}

                  {row.kind === 'text' && (
                    <input className="field" value={value ?? ''} onChange={(e) => set(row.key, e.target.value)} />
                  )}

                  {row.kind === 'select' && (
                    <select className="field" value={value ?? ''} onChange={(e) => set(row.key, e.target.value)}>
                      {row.options?.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  )}

                  {row.kind === 'bool' && (
                    <button
                      onClick={() => set(row.key, !value)}
                      role="switch"
                      aria-checked={Boolean(value)}
                      className={`flex h-7 w-14 items-center rounded-full p-1 transition ${
                        value ? 'bg-accent' : 'bg-white/15'
                      }`}
                    >
                      <span className={`h-5 w-5 rounded-full bg-white transition ${value ? 'translate-x-7' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* mastery weights */}
          <div className="p-5">
            <p className="text-sm font-semibold text-slate-100">Mastery signal weights</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              How much each behavioural signal contributes to the inferred mastery score. These are the
              knobs that decide what &ldquo;understanding&rdquo; means on this deployment.
            </p>
            <div className="mt-4 space-y-3">
              {Object.entries(draft.masteryWeights ?? {}).map(([k, v]: any) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[1fr_200px] sm:items-center">
                  <span className="text-sm text-slate-300">{SIGNAL_LABELS[k] ?? k}</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={0.6}
                      step={0.01}
                      value={v}
                      onChange={(e) =>
                        set('masteryWeights', { ...draft.masteryWeights, [k]: Number(e.target.value) })
                      }
                      className="w-full accent-accent"
                    />
                    <span className="w-10 text-right text-xs tabular-nums text-slate-400">{Number(v).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Total: {(Object.values(draft.masteryWeights ?? {}) as number[]).reduce((a, b) => a + Number(b), 0).toFixed(2)} ·
              weights are normalised at scoring time, so they do not have to sum to exactly 1.
            </p>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="panel p-5">
            <h2 className="text-lg font-bold">AI provider chain</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Tried in order. The first one that answers within the timeout wins; if every one fails the
              deterministic offline builder takes over so the learner is never blocked.
            </p>
            <ol className="mt-4 space-y-2">
              {(providers?.providers ?? []).map((p: any, i: number) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-white/5 bg-ink-900/60 px-3 py-2"
                >
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-white/10 text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <span className="capitalize text-slate-200">{p.id}</span>
                  </span>
                  <span className={`chip ${p.configured ? 'bg-good/20 text-good' : 'bg-white/5 text-slate-500'}`}>
                    {p.configured ? 'key present' : 'no key'}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between rounded-xl border border-dashed border-white/10 px-3 py-2">
                <span className="text-sm text-slate-300">offline builder</span>
                <span className="chip bg-good/20 text-good">always available</span>
              </li>
            </ol>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
              Keys are read from environment variables on the server and are never sent to the browser.
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="text-lg font-bold">Shipped defaults</h2>
            <p className="mt-1 text-xs text-slate-500">What the engine falls back to if this table is empty.</p>
            <dl className="mt-3 space-y-1.5 text-xs">
              {defaults &&
                ['xpPerStep', 'xpPerLevel', 'hintPenaltyXp', 'masteryUnlockThreshold', 'adaptationSensitivity'].map(
                  (k) => (
                    <div key={k} className="flex justify-between gap-3">
                      <dt className="text-slate-500">{k}</dt>
                      <dd className="tabular-nums text-slate-300">{JSON.stringify(defaults[k])}</dd>
                    </div>
                  ),
                )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
