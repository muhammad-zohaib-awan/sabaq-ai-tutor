'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { pick, t, type Lang } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { canListen, listen, speak, stopSpeaking, type Listener } from '@/lib/speech';
import { sfxCorrect, sfxTap } from '@/lib/sound';

function VoiceButton({ lang, onText, disabled }: { lang: Lang; onText: (s: string) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  const ref = useRef<Listener | null>(null);
  const { toast } = useApp();

  useEffect(() => () => ref.current?.stop(), []);
  if (!canListen()) return null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (on) return ref.current?.stop();
        setOn(true);
        void api.event({ type: 'voice_used', payload: { mode: 'input', language: lang } });
        ref.current = listen(lang, {
          onPartial: onText,
          onFinal: onText,
          onError: (m) => {
            toast('error', m);
            setOn(false);
          },
          onEnd: () => setOn(false),
        });
        if (!ref.current) setOn(false);
      }}
      className={`btn ${on ? 'bg-red-500/20 text-red-200' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
      aria-pressed={on}
      aria-label={on ? t('listening', lang) : t('speak', lang)}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" />
        <path d="M19 12a7 7 0 0 1-14 0M12 19v3" strokeLinecap="round" />
      </svg>
      {on ? t('listening', lang) : t('speak', lang)}
    </button>
  );
}

/* ------------------------------------------------------- step 2: inquire */

export function InquireStep({
  journey,
  step,
  onProgress,
}: {
  journey: any;
  step: any;
  onProgress: (facts: number, total: number) => void;
}) {
  const { lang, toast } = useApp();
  const spec = step.inquire;
  const [messages, setMessages] = useState<Array<{ role: 'learner' | 'persona'; text: string; grounded?: boolean }>>([
    { role: 'persona', text: spec?.openingLine ?? '' },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const total = spec?.mustSurfaceFacts?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    onProgress(found.size, total);
  }, [found, total, onProgress]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'learner', text: q }]);
    setBusy(true);
    try {
      const res = await api.ask(journey.id, {
        stepId: step.id,
        question: q,
        language: lang,
        history: messages.slice(-6),
      });
      setMessages((m) => [...m, { role: 'persona', text: res.answer, grounded: res.grounded }]);
      if (res.factsSurfaced?.length) {
        setFound((f) => {
          const next = new Set(f);
          let fresh = false;
          for (const id of res.factsSurfaced) {
            if (!next.has(id)) fresh = true;
            next.add(id);
          }
          if (fresh) sfxCorrect();
          return next;
        });
      }
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not reach the case right now.');
      setMessages((m) => m.slice(0, -1));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Talking to <span className="font-semibold text-slate-200">{spec?.persona}</span>
        </p>
        <span className="chip bg-white/5 text-slate-300 tabular-nums">
          {found.size} / {total} key points surfaced
        </span>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-white/5 bg-ink-900/50 p-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'learner' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'learner' ? 'bg-accent text-white' : 'bg-ink-700 text-slate-100'
              } ${lang === 'ur' ? 'urdu' : ''}`}
            >
              {m.text}
              {m.role === 'persona' && m.grounded === false && (
                <span className="mt-1.5 block text-[11px] text-amber-300/80">
                  Not covered by the source — treated as unknown rather than guessed.
                </span>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-2xl bg-ink-700 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {spec?.suggestedQuestions?.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('suggested', lang)}
          </p>
          <div className="flex flex-wrap gap-2">
            {spec.suggestedQuestions.map((q: string) => (
              <button
                key={q}
                onClick={() => {
                  sfxTap();
                  void send(q);
                }}
                disabled={busy}
                className="chip border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={2}
          className={`field flex-1 resize-none ${lang === 'ur' ? 'urdu' : ''}`}
          dir={lang === 'ur' ? 'rtl' : 'ltr'}
          placeholder={t('askPlaceholder', lang)}
          disabled={busy}
        />
        <VoiceButton lang={lang} onText={setDraft} disabled={busy} />
        <button className="btn-primary" disabled={busy || !draft.trim()}>
          {t('send', lang)}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------- step 3: explain */

export function ExplainStep({
  journey,
  step,
  onScored,
}: {
  journey: any;
  step: any;
  onScored: (score: number) => void;
}) {
  const { lang, toast } = useApp();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [speaking, setSpeaking] = useState(false);
  const startedAt = useRef(Date.now());

  const words = answer.trim().split(/\s+/).filter(Boolean).length;

  async function submit() {
    if (words < 8) return toast('error', 'Give it a few more words — three or four sentences works best.');
    setBusy(true);
    try {
      const res = await api.explain(journey.id, {
        stepId: step.id,
        answer,
        language: lang,
        seconds: Math.round((Date.now() - startedAt.current) / 1000),
      });
      setResult(res);
      onScored(res.overall);
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not grade that right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-ink-900/50 p-4">
        <p className={`text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
          {step.explain?.prompt}
        </p>
      </div>

      <div>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={6}
          disabled={busy || Boolean(result)}
          dir={lang === 'ur' ? 'rtl' : 'ltr'}
          className={`field resize-y ${lang === 'ur' ? 'urdu' : ''}`}
          placeholder={t('explainPlaceholder', lang)}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">{words} words</span>
          <div className="flex gap-2">
            <VoiceButton lang={lang} onText={setAnswer} disabled={busy || Boolean(result)} />
            <button className="btn-primary" onClick={submit} disabled={busy || Boolean(result) || words < 8}>
              {busy ? 'Assessing…' : t('submit', lang)}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="animate-riseFade space-y-3 rounded-2xl border border-white/10 bg-ink-700/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Understanding shown</p>
              <p className="text-3xl font-extrabold tabular-nums text-accent-soft">
                {Math.round(result.overall * 100)}%
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="chip bg-white/5 text-slate-300">
                sounded {result.confidenceLanguage}
              </span>
              <span className="chip bg-white/5 text-slate-400">via {result.provider}</span>
            </div>
          </div>

          <p className={`text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
            {pick(result.feedback, lang)}
          </p>

          {result.strength && (
            <p className="text-sm text-emerald-300">
              <span className="font-semibold">Strongest part:</span> {result.strength}
            </p>
          )}
          {result.misconception && (
            <p className="text-sm text-amber-300">
              <span className="font-semibold">Worth fixing:</span> {result.misconception}
            </p>
          )}

          <ul className="grid gap-2 sm:grid-cols-2">
            {(step.explain?.rubric ?? []).map((r: any) => {
              const s = result.rubricScores?.find((x: any) => x.id === r.id)?.score ?? 0;
              return (
                <li key={r.id} className="rounded-xl bg-ink-900/60 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-300">{r.label}</span>
                    <span className="text-xs font-semibold tabular-nums text-slate-400">
                      {Math.round(s * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${s >= 0.7 ? 'bg-good' : s >= 0.4 ? 'bg-warn' : 'bg-bad'}`}
                      style={{ width: `${Math.round(s * 100)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className="btn-ghost"
              onClick={() => {
                if (speaking) {
                  stopSpeaking();
                  setSpeaking(false);
                  return;
                }
                setSpeaking(true);
                void api.event({ type: 'voice_used', journeyId: journey.id, payload: { mode: 'output' } });
                speak(step.explain?.modelAnswer ?? '', lang, () => setSpeaking(false));
              }}
            >
              {speaking ? t('stop', lang) : 'Hear a strong answer'}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setResult(null);
                startedAt.current = Date.now();
              }}
            >
              Try again in your own words
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
