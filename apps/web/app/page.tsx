'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { pick, t } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { sfxCorrect, sfxTap, sfxWrong } from '@/lib/sound';
import { speak, stopSpeaking } from '@/lib/speech';
import { VitalsPanel } from '@/components/VitalsPanel';
import { HeartSim } from '@/components/HeartSim';
import { BoardSim } from '@/components/BoardSim';
import { InquireStep, ExplainStep } from '@/components/Steps';
import { DecideWidget, OrderWidget, TraceWidget } from '@/components/Mechanics';
import { AnalogyCard } from '@/components/AnalogyCard';
import { TopicLauncher } from '@/components/TopicLauncher';
import { AdaptationCard, LevelCard, MasteryPanel } from '@/components/SidePanels';

export default function LearnPage() {
  const {
    ready,
    user,
    lang,
    journey,
    setJourney,
    learnState,
    refreshState,
    toast,
    celebrateXp,
    pushBadges,
  } = useApp();

  const [stepIndex, setStepIndex] = useState(0);
  const [simStates, setSimStates] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState(1);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintText, setHintText] = useState('');
  const [simResult, setSimResult] = useState<any>(null);
  const [orderValue, setOrderValue] = useState<string[]>([]);
  const [decideChoice, setDecideChoice] = useState<string | null>(null);
  const [traceChoice, setTraceChoice] = useState<string | null>(null);
  const [flow, setFlow] = useState<'idle' | 'running' | 'good' | 'bad'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stepDone, setStepDone] = useState<Record<string, boolean>>({});
  const [inquireProgress, setInquireProgress] = useState({ found: 0, total: 0 });
  const [explainScore, setExplainScore] = useState<number | null>(null);
  const stepStart = useRef(Date.now());

  /* ------------------------------------------------------------ loading */

  // Nothing is preloaded. The learner's own input is what creates a mission,
  // so until they give one this page is the launcher, not a sample subject.
  useEffect(() => {
    if (!ready) return;
    setLoading(false);
    if (user) void refreshState(journey?.id);
  }, [ready, user, journey?.id, refreshState]);

  // A newly built journey resets the run.
  useEffect(() => {
    if (!journey) return;
    setStepIndex(0);
    setSimStates(
      Object.fromEntries(
        (journey.steps?.[0]?.sim?.elements ?? []).map((e: any) => [e.id, e.correct === 0 ? 1 : 0]),
      ),
    );
    setAttempt(1);
    setHintsUsed(0);
    setHintText('');
    setSimResult(null);
    setFlow('idle');
    setStepDone({});
    resetMechanic(journey.steps?.[0]);
    setExplainScore(null);
    setInquireProgress({ found: 0, total: 0 });
    stepStart.current = Date.now();
    setLoading(false);
  }, [journey?.id]);

  /** Puts a step's interaction back to its starting position. */
  function resetMechanic(s: any) {
    if (!s) return;
    setSimStates(
      Object.fromEntries((s.sim?.elements ?? []).map((e: any) => [e.id, e.correct === 0 ? 1 : 0])),
    );
    // Shuffled deterministically off the ids, so the starting order is never the answer.
    setOrderValue(
      [...(s.order?.items ?? [])]
        .map((i: any) => i.id)
        .sort((a: string, b: string) => (a + s.id).localeCompare(b + s.id)),
    );
    setDecideChoice(null);
    setTraceChoice(null);
  }

  const onInquireProgress = useCallback(
    (found: number, total: number) => setInquireProgress({ found, total }),
    [],
  );

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          Loading…
        </div>
      </div>
    );
  }

  if (!journey) return <TopicLauncher />;

  const step = journey.steps[stepIndex];
  const mechanic: string = step.mechanic ?? 'sort';
  const mastery = learnState?.mastery;
  const adaptation = learnState?.adaptation;
  const progress = learnState?.progress;
  const cfg = learnState?.config;
  const isUr = lang === 'ur';

  /* ------------------------------------------------------------ actions */

  async function completeStep(score?: number) {
    try {
      const res = await api.complete(journey.id, {
        stepId: step.id,
        hintsUsed,
        seconds: Math.round((Date.now() - stepStart.current) / 1000),
        score,
      });
      setStepDone((d) => ({ ...d, [step.id]: true }));
      if (res.xpAwarded > 0) celebrateXp(res.xpAwarded);
      if (res.newBadges?.length) {
        pushBadges(res.newBadges.map((b: any) => ({ ...b })));
      }
      if (res.leveledUp) {
        pushBadges([
          {
            id: `level_${res.progress.level}`,
            label: `Level ${res.progress.level}`,
            description: `${res.totalXp} XP earned. The next mission unlocks at ${Math.round(
              res.unlockThreshold * 100,
            )}% inferred mastery.`,
            icon: 'trophy',
            levelUp: res.progress.level,
          },
        ]);
      }
      await refreshState(journey.id);
      return res;
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not save that step.');
      return null;
    }
  }

  async function runSim() {
    setFlow('running');
    try {
      const res = await api.sim(journey.id, {
        stepId: step.id,
        ...(mechanic === 'order'
          ? { order: orderValue }
          : mechanic === 'decide'
            ? { optionId: decideChoice }
            : mechanic === 'trace'
              ? { nodeId: traceChoice }
              : { states: simStates }),
        attempt,
        hintsUsed,
        seconds: Math.round((Date.now() - stepStart.current) / 1000),
      });
      setSimResult(res);
      setFlow(res.passed ? 'good' : 'bad');
      if (res.passed) {
        sfxCorrect();
        await completeStep(res.correctRatio);
      } else {
        sfxWrong();
        setAttempt((a) => a + 1);
      }
    } catch (e: any) {
      setFlow('idle');
      toast('error', e?.message ?? 'Could not run that.');
    }
  }

  async function takeHint() {
    const el = step.sim?.elements?.[Math.min(hintsUsed, (step.sim?.elements?.length ?? 1) - 1)];
    try {
      const res = await api.hint(journey.id, step.id, el?.id ?? '');
      setHintText(res.hint);
      setHintsUsed((h) => h + 1);
      toast('info', `Hint taken · −${res.xpCost} XP from this step`);
    } catch {
      setHintText(el?.hint ?? '');
      setHintsUsed((h) => h + 1);
    }
  }

  async function markSelfCorrected() {
    await api.selfCorrect(journey.id, step.id, 'learner flagged their own mistake before running');
    toast('success', 'Noted — catching your own mistake counts toward mastery.');
    await refreshState(journey.id);
  }

  function goToStep(i: number) {
    if (i < 0 || i >= journey.steps.length) return;
    stopSpeaking();
    setSpeaking(false);
    setStepIndex(i);
    setHintText('');
    setHintsUsed(0);
    setSimResult(null);
    setFlow('idle');
    resetMechanic(journey.steps[i]);
    stepStart.current = Date.now();
    void api.event({ type: 'step_started', journeyId: journey.id, stepId: journey.steps[i].id, payload: { language: lang } });
  }

  const readyToRun =
    mechanic === 'order'
      ? orderValue.length > 0
      : mechanic === 'decide'
        ? Boolean(decideChoice)
        : mechanic === 'trace'
          ? Boolean(traceChoice)
          : true;

  const canAdvance =
    step.kind === 'simulate'
      ? Boolean(simResult?.passed)
      : step.kind === 'inquire'
        ? inquireProgress.found > 0 || stepDone[step.id]
        : explainScore !== null;

  /* -------------------------------------------------------------- view */

  return (
    <div className="space-y-5" dir={isUr ? 'rtl' : 'ltr'}>
      {/* content bar */}
      <section className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
        <span className="chip bg-accent/15 text-accent-soft">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 3v5h5M7 3h8l5 5v13H7z" strokeLinejoin="round" />
          </svg>
          {journey.sourceName}
        </span>
        <span className="text-slate-400">
          {journey.conceptCount} {t('conceptsExtracted', lang)}
        </span>
        <span className="text-slate-500">
          {t('learnerLabel', lang)}: <b className="text-slate-200">{journey.learnerType}</b>
        </span>
        <span className="text-slate-500">
          {t('tone', lang)}: <b className="capitalize text-slate-200">{journey.tone}</b>
        </span>
        <span className="text-slate-500">
          {t('difficulty', lang)}:{' '}
          <b className="text-slate-200">
            Adaptive, level {adaptation?.difficulty ?? journey.difficulty}
          </b>
        </span>
        <span className="text-slate-500">
          {t('constraint', lang)}: <b className="capitalize text-slate-200">{String(journey.constraint).replace(/_/g, ' ')}</b>
        </span>
        <button
          className="btn-ghost px-2.5 py-1 text-xs"
          onClick={() => {
            stopSpeaking();
            setJourney(null);
          }}
        >
          {t('changeContent', lang)}
        </button>
        <span className="ms-auto flex items-center gap-2">
          {journey.degraded && (
            <span className="chip bg-amber-400/15 text-amber-200">offline builder</span>
          )}
          {!journey.grounded && (
            <span className="chip bg-red-400/15 text-red-200" title={journey.groundingNotes?.join(' ')}>
              check grounding
            </span>
          )}
          <span className="chip bg-white/5 text-slate-400">
            {journey.provider} · {journey.latencyMs ? `${(journey.latencyMs / 1000).toFixed(1)}s` : 'instant'}
          </span>
        </span>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {/* mission header */}
          <section>
            <p className="text-sm text-slate-400">{pick(journey.missionLabel, lang)}</p>
            <div className="mt-1 flex flex-wrap items-start justify-between gap-5">
              <h1 className={`text-4xl font-extrabold tracking-tight ${isUr ? 'urdu' : ''}`}>
                {pick(journey.title, lang)}
              </h1>

              <ol className="flex flex-1 items-start justify-between gap-2 sm:max-w-md">
                {journey.steps.map((s: any, i: number) => {
                  const done = stepDone[s.id];
                  const current = i === stepIndex;
                  return (
                    <li key={s.id} className="flex flex-1 flex-col items-center text-center">
                      <div className="flex w-full items-center">
                        {i > 0 && <span className={`h-0.5 flex-1 ${done || current ? 'bg-accent' : 'bg-white/15'}`} />}
                        <button
                          onClick={() => goToStep(i)}
                          aria-current={current ? 'step' : undefined}
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition ${
                            done
                              ? 'border-good bg-good'
                              : current
                                ? 'border-accent bg-accent'
                                : 'border-white/30 bg-transparent hover:border-white/60'
                          }`}
                          title={pick(s.label, lang)}
                        />
                        {i < journey.steps.length - 1 && (
                          <span className={`h-0.5 flex-1 ${stepDone[s.id] ? 'bg-accent' : 'bg-white/15'}`} />
                        )}
                      </div>
                      <span
                        className={`mt-2 text-xs font-semibold ${current ? 'text-slate-100' : 'text-slate-500'} ${
                          isUr ? 'urdu' : ''
                        }`}
                      >
                        {pick(s.label, lang)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>

          {/* narrative */}
          <section className="panel p-5">
            <p className={`text-lg leading-relaxed text-slate-100 ${isUr ? 'urdu text-xl' : ''}`}>
              {pick(step.narrative, lang)}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
              <button
                className="btn-ghost"
                onClick={() => {
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                    return;
                  }
                  setSpeaking(true);
                  void api.event({ type: 'voice_used', journeyId: journey.id, payload: { mode: 'output', language: lang } });
                  const ok = speak(pick(step.narrative, lang), lang, () => setSpeaking(false));
                  if (!ok) {
                    setSpeaking(false);
                    toast('error', 'Speech is not available in this browser.');
                  }
                }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                  <path d="M16 9a4 4 0 0 1 0 6" strokeLinecap="round" />
                </svg>
                {speaking ? t('stop', lang) : t('listen', lang)}
              </button>
              <span className="chip bg-white/5 text-slate-400">
                {t('source', lang)}: {journey.sourceRef}
              </span>
            </div>
          </section>

          {/* analogy + optional free visual aids */}
          {stepIndex === 0 && <AnalogyCard journey={journey} lang={lang} />}

          {/* context panel */}
          {stepIndex === 0 && <VitalsPanel panel={journey.contextPanel} lang={lang} />}

          {/* step body */}
          <section className="panel p-5">
            {step.kind === 'simulate' && (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className={`text-lg font-semibold ${isUr ? 'urdu' : ''}`}>
                    {step.sim?.prompt ?? step.order?.prompt ?? step.decide?.prompt ?? step.trace?.prompt}
                  </p>
                  <span className="chip bg-white/5 capitalize text-slate-400" title="Interaction mechanic chosen for this content">
                    {mechanic === 'order'
                      ? 'sequence'
                      : mechanic === 'decide'
                        ? 'decision'
                        : mechanic === 'trace'
                          ? 'trace the system'
                          : 'sort into states'}
                  </span>
                </div>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    {mechanic === 'sort' && step.sim && step.sim.visual === 'heart' && (
                      <HeartSim
                        elements={step.sim.elements}
                        states={simStates}
                        onToggle={(id) => {
                          sfxTap();
                          setSimStates((st) => ({ ...st, [id]: st[id] === 1 ? 0 : 1 }));
                          setSimResult(null);
                          setFlow('idle');
                        }}
                        legend={step.sim.legend}
                        flow={flow}
                        disabled={Boolean(simResult?.passed)}
                      />
                    )}

                    {mechanic === 'sort' && step.sim && step.sim.visual !== 'heart' && (
                      <BoardSim
                        elements={step.sim.elements}
                        states={simStates}
                        onToggle={(id) => {
                          sfxTap();
                          setSimStates((st) => ({ ...st, [id]: st[id] === 1 ? 0 : 1 }));
                          setSimResult(null);
                          setFlow('idle');
                        }}
                        legend={step.sim.legend}
                        disabled={Boolean(simResult?.passed)}
                        lang={lang}
                      />
                    )}

                    {mechanic === 'order' && step.order && (
                      <OrderWidget
                        spec={step.order}
                        value={orderValue}
                        onChange={(next) => {
                          setOrderValue(next);
                          setSimResult(null);
                        }}
                        disabled={Boolean(simResult?.passed)}
                        lang={lang}
                      />
                    )}

                    {mechanic === 'decide' && step.decide && (
                      <DecideWidget
                        spec={step.decide}
                        chosen={decideChoice}
                        onChoose={(id) => {
                          sfxTap();
                          setDecideChoice(id);
                        }}
                        result={simResult}
                        lang={lang}
                      />
                    )}

                    {mechanic === 'trace' && step.trace && (
                      <TraceWidget
                        spec={step.trace}
                        picked={traceChoice}
                        onPick={(id) => {
                          sfxTap();
                          setTraceChoice(id);
                        }}
                        result={simResult}
                        lang={lang}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-3 lg:w-56">
                    <button
                      className="btn-primary"
                      onClick={runSim}
                      disabled={Boolean(simResult?.passed) || !readyToRun}
                    >
                      {step.sim?.runLabel ?? step.order?.runLabel ?? step.trace?.runLabel ?? 'Commit'}
                    </button>

                    {mechanic === 'sort' && (
                      <button className="btn-ghost" onClick={takeHint} disabled={Boolean(simResult?.passed)}>
                        {t('hint', lang)}
                        <span className="text-xs text-slate-400">−{cfg?.hintPenaltyXp ?? 5} XP</span>
                      </button>
                    )}

                    <button className="btn-ghost text-xs" onClick={markSelfCorrected}>
                      {t('iWasWrong', lang)}
                    </button>

                    {hintText && (
                      <p className="animate-riseFade rounded-xl border border-white/10 bg-ink-900/70 p-3 text-xs leading-relaxed text-slate-300">
                        {hintText}
                      </p>
                    )}

                    {simResult && mechanic !== 'decide' && (
                      <div
                        className={`animate-riseFade rounded-xl border p-3 text-sm leading-relaxed ${
                          simResult.passed
                            ? 'border-good/30 bg-good/10 text-emerald-100'
                            : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                        }`}
                      >
                        <p>{simResult.message}</p>
                        {!simResult.passed && (
                          <p className="mt-1.5 text-xs opacity-80">
                            {mechanic === 'order'
                              ? `${simResult.misplaced ?? 0} out of place. Attempt ${attempt}.`
                              : mechanic === 'trace'
                                ? `Watch the meter — it tells you where the work happened. Attempt ${attempt}.`
                                : `${simResult.wrongCount} of ${step.sim?.elements?.length ?? 0} are not where they should be. Attempt ${attempt}.`}
                          </p>
                        )}
                      </div>
                    )}

                    {simResult && !simResult.passed && (
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => {
                          setSimResult(null);
                          setDecideChoice(null);
                          setTraceChoice(null);
                          setFlow('idle');
                        }}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {step.kind === 'inquire' && (
              <InquireStep journey={journey} step={step} onProgress={onInquireProgress} />
            )}

            {step.kind === 'explain' && (
              <ExplainStep
                journey={journey}
                step={step}
                onScored={async (score) => {
                  setExplainScore(score);
                  await completeStep(score);
                }}
              />
            )}
          </section>

          {/* step nav */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button className="btn-ghost" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0}>
              ← Previous
            </button>
            {stepIndex < journey.steps.length - 1 ? (
              <button
                className="btn-primary"
                onClick={async () => {
                  if (step.kind === 'inquire' && !stepDone[step.id]) await completeStep();
                  goToStep(stepIndex + 1);
                }}
                disabled={!canAdvance}
              >
                {t('nextStep', lang)} →
              </button>
            ) : (
              <span className="chip bg-white/5 text-slate-400">
                {explainScore !== null ? t('missionComplete', lang) : 'Finish the explain-back to complete'}
              </span>
            )}
          </div>
        </div>

        {/* right rail */}
        <aside className="space-y-5">
          <MasteryPanel mastery={mastery} lang={lang} />
          <AdaptationCard adaptation={adaptation} lang={lang} />
          <LevelCard
            progress={progress}
            badges={cfg?.badges ?? []}
            threshold={cfg?.masteryUnlockThreshold ?? 0.7}
            mastery={mastery}
            lang={lang}
          />
        </aside>
      </div>
    </div>
  );
}
