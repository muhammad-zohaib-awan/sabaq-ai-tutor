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
  onProgress: (facts: number, total: number, asked: number) => void;
}) {
  const { lang, toast } = useApp();
  const spec = step.inquire;
  const [messages, setMessages] = useState<Array<{ role: 'learner' | 'persona'; text: string; grounded?: boolean; basis?: string }>>([
    { role: 'persona', text: spec?.openingLine ?? '' },
  ]);
  const [askedQuestions, setAskedQuestions] = useState<Set<string>>(new Set());
  const [hintShown, setHintShown] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const total = spec?.mustSurfaceFacts?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    onProgress(found.size, total, messages.filter((m) => m.role === 'learner').length);
  }, [found, total, onProgress, messages]);

  // Available suggested questions = those not yet asked
  const availableSuggestions = (spec?.suggestedQuestions ?? []).filter(
    (q: string) => !askedQuestions.has(q)
  );

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setDraft('');
    setAskedQuestions((prev) => new Set([...prev, q]));
    setMessages((m) => [...m, { role: 'learner', text: q }]);
    setBusy(true);
    try {
      const res = await api.ask(journey.id, {
        stepId: step.id,
        question: q,
        language: lang,
        history: messages.slice(-8).map((m) => ({ role: m.role, text: m.text })),
      });
      setMessages((m) => [...m, { role: 'persona', text: res.answer, grounded: res.grounded, basis: res.basis }]);
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

  // Generate a hint from un-surfaced facts
  const nextHintFact = spec?.mustSurfaceFacts?.find((f: any) => !found.has(f.id));
  const hintText = nextHintFact
    ? `Try this: ${nextHintFact.hint ?? 'ask about the part you are least sure of.'}`
    : null;

  return (
    <div className="space-y-4">
      {/* Walkthrough guide banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3">
        <span className="mt-0.5 text-lg">💡</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-accent-soft">What to do here</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
            Ask <strong className="text-slate-100">{spec?.persona}</strong> questions about the topic. Try to surface all{' '}
            <strong className="text-slate-100">{total} key points</strong>. Use the suggested questions or type your own. Click{' '}
            <strong className="text-slate-100">Get a Hint</strong> if you're stuck.
          </p>
        </div>
        {hintText && (
          <button
            onClick={() => setHintShown((v) => !v)}
            className="shrink-0 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20"
          >
            {hintShown ? 'Hide hint' : '🔍 Get a hint'}
          </button>
        )}
      </div>

      {/* Hint reveal */}
      {hintShown && hintText && (
        <div className="animate-riseFade flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100">
          <span>🔑</span>
          <span>{hintText}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Talking to <span className="font-semibold text-slate-200">{spec?.persona}</span>
        </p>
        <span className={`chip tabular-nums ${found.size >= total && total > 0 ? 'bg-good/20 text-good' : 'bg-white/5 text-slate-300'}`}>
          {found.size} / {total} key points surfaced
          {found.size >= total && total > 0 && ' ✓'}
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
              {m.role === 'persona' && m.basis === 'offtopic' && (
                <span className="mt-1.5 block text-[11px] text-amber-300/80">
                  ↪️ Outside this topic — try one of the suggested questions.
                </span>
              )}
              {m.role === 'persona' && m.basis === 'general' && journey.sourceKind === 'document' && (
                <span className="mt-1.5 block text-[11px] text-sky-300/70">🌐 General knowledge, not from your document.</span>
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

      {/* Suggested questions — filtered to exclude already-asked ones */}
      {availableSuggestions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('suggested', lang)}
          </p>
          <div className="flex flex-wrap gap-2">
            {availableSuggestions.map((q: string) => (
              <button
                key={q}
                onClick={() => { sfxTap(); void send(q); }}
                disabled={busy}
                className="chip border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableSuggestions.length === 0 && found.size < total && (
        <p className="text-xs text-slate-500 text-center">
          All suggested questions used — type your own or click <strong className="text-amber-300">Get a hint</strong> above.
        </p>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void send(draft); }}
        className="flex flex-wrap items-end gap-2"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); }
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
  const [usedTiles, setUsedTiles] = useState<string[]>([]);
  const [guideOpen, setGuideOpen] = useState(true);
  const startedAt = useRef(Date.now());

  const words = answer.trim().split(/\s+/).filter(Boolean).length;

  // Phrase tiles — AI-supplied or auto-generated from rubric
  const tiles: string[] = step.explain?.phraseTiles?.length ? step.explain.phraseTiles : [];

  function addTile(tile: string) {
    if (usedTiles.includes(tile)) return;
    setUsedTiles((prev) => [...prev, tile]);
    setAnswer((prev) => prev ? `${prev.trim()} ${tile}` : tile);
  }

  async function submit() {
    if (words < 5) return toast('error', 'Add a few more words — even a short sentence or two is enough.');
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
      {/* Walkthrough guide */}
      <div className="rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-lg">📝</span>
            <div>
              <p className="text-sm font-semibold text-accent-soft">What to do here</p>
              {guideOpen && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-300">
                  Explain the topic <strong className="text-slate-100">in your own words</strong> — like you're teaching a friend.
                  Click the <strong className="text-slate-100">phrase tiles</strong> below to build your answer, or just type/speak freely.
                  No perfect answer needed — show that you understood the idea.
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setGuideOpen(v => !v)} className="shrink-0 text-xs text-slate-500 hover:text-slate-300">
            {guideOpen ? 'Hide' : 'Show guide'}
          </button>
        </div>
      </div>

      {/* The prompt */}
      <div className="rounded-2xl border border-white/5 bg-ink-900/50 p-4">
        <p className={`text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
          {step.explain?.prompt}
        </p>
      </div>

      {/* Phrase tiles — click to add to answer */}
      {tiles.length > 0 && !result && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            💬 Click a phrase to add it to your answer
          </p>
          <div className="flex flex-wrap gap-2">
            {tiles.map((tile: string) => (
              <button
                key={tile}
                onClick={() => addTile(tile)}
                disabled={usedTiles.includes(tile) || Boolean(result)}
                className={`chip border text-sm transition ${
                  usedTiles.includes(tile)
                    ? 'border-good/40 bg-good/10 text-good line-through'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-accent/40 hover:bg-accent/5'
                }`}
              >
                {tile}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Text area */}
      {!result && (
        <div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            disabled={busy}
            dir={lang === 'ur' ? 'rtl' : 'ltr'}
            className={`field resize-y ${lang === 'ur' ? 'urdu' : ''}`}
            placeholder="Explain it in your own words… (or use the phrase tiles above to get started)"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{words} words{words < 5 && words > 0 ? ' — add a bit more' : ''}</span>
            <div className="flex gap-2">
              <VoiceButton lang={lang} onText={(t) => setAnswer((prev) => prev ? `${prev} ${t}` : t)} disabled={busy} />
              <button
                className="btn-primary"
                onClick={submit}
                disabled={busy || words < 5}
              >
                {busy ? 'Assessing…' : t('submit', lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="animate-riseFade space-y-3 rounded-2xl border border-white/10 bg-ink-700/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Understanding shown</p>
              <p className={`text-3xl font-extrabold tabular-nums ${result.overall >= 0.7 ? 'text-good' : result.overall >= 0.4 ? 'text-amber-300' : 'text-red-400'}`}>
                {Math.round(result.overall * 100)}%
              </p>
            </div>
            <span className={`chip ${result.overall >= 0.7 ? 'bg-good/20 text-good' : result.overall >= 0.4 ? 'bg-amber-400/15 text-amber-200' : 'bg-red-400/15 text-red-200'}`}>
              {result.overall >= 0.7 ? '✓ Great explanation!' : result.overall >= 0.4 ? 'Getting there' : 'Try once more'}
            </span>
          </div>

          <p className={`text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
            {pick(result.feedback, lang)}
          </p>

          {result.strength && (
            <p className="text-sm text-emerald-300">
              <span className="font-semibold">✓ Strongest part: </span>{result.strength}
            </p>
          )}
          {result.misconception && (
            <p className="text-sm text-amber-300">
              <span className="font-semibold">⚠ Worth fixing: </span>{result.misconception}
            </p>
          )}

          <ul className="grid gap-2 sm:grid-cols-2">
            {(step.explain?.rubric ?? []).map((r: any) => {
              const s = result.rubricScores?.find((x: any) => x.id === r.id)?.score ?? 0;
              return (
                <li key={r.id} className="rounded-xl bg-ink-900/60 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-slate-300">{r.label}</span>
                    <span className={`text-xs font-semibold tabular-nums ${s >= 0.7 ? 'text-good' : s >= 0.4 ? 'text-amber-300' : 'text-red-400'}`}>
                      {Math.round(s * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${s >= 0.7 ? 'bg-good' : s >= 0.4 ? 'bg-warn' : 'bg-bad'}`}
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
                if (speaking) { stopSpeaking(); setSpeaking(false); return; }
                setSpeaking(true);
                void api.event({ type: 'voice_used', journeyId: journey.id, payload: { mode: 'output' } });
                speak(result.modelAnswer ?? '', lang, () => setSpeaking(false));
              }}
            >
              {speaking ? t('stop', lang) : '🔊 Hear a strong answer'}
            </button>
            {result.overall < 0.7 && (
              <button
                className="btn-primary"
                onClick={() => {
                  setResult(null);
                  setUsedTiles([]);
                  startedAt.current = Date.now();
                }}
              >
                Try again →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
