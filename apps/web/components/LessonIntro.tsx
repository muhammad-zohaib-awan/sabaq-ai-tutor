'use client';

import { useState } from 'react';
import { pick, type Lang } from '@/lib/i18n';
import { speak, stopSpeaking } from '@/lib/speech';
import { TopicBrief } from './TopicBrief';

/**
 * Teach first. Before any scenario the learner reads, in plain sentences,
 * what the thing is, the few ideas that matter, and one worked example from
 * their own world. The scenario then USES this instead of testing cold.
 */
export function LessonIntro({
  journey,
  lang,
  onStart,
  review = false,
}: {
  journey: any;
  lang: Lang;
  onStart: () => void;
  review?: boolean;
}) {
  const [speaking, setSpeaking] = useState(false);
  const l = journey.lesson ?? {};
  const whatItIs: string = l.whatItIs || pick(journey.primer, lang);
  const keyPoints: string[] = Array.isArray(l.keyPoints) ? l.keyPoints : [];
  const analogy = pick(journey.analogy, lang);
  const isUr = (journey.language ?? lang) === 'ur';
  const ur = isUr ? 'urdu' : '';

  const readAloud = [whatItIs, ...keyPoints, l.example, analogy].filter(Boolean).join('. ');

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2" dir={isUr ? 'rtl' : 'ltr'}>
      <header>
        <p className="text-sm text-slate-400">
          Lesson for a <span className="font-semibold text-slate-200">{journey.learnerType}</span>
        </p>
        <h1 className={`mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl ${ur}`}>{journey.topic}</h1>
      </header>

      <section className="panel p-6">
        <h2 className="text-sm font-semibold text-accent-soft">📘 What it is</h2>
        <p className={`mt-2 text-lg leading-relaxed text-slate-100 ${ur}`}>{whatItIs}</p>
      </section>

      {keyPoints.length > 0 && (
        <section className="panel p-6">
          <h2 className="text-sm font-semibold text-accent-soft">🧠 The ideas that matter</h2>
          <ol className="mt-3 space-y-3">
            {keyPoints.map((k, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-bold text-accent-soft">
                  {i + 1}
                </span>
                <p className={`leading-relaxed text-slate-200 ${ur}`}>{k}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(l.example || analogy) && (
        <section className="grid gap-4 sm:grid-cols-2">
          {l.example && (
            <div className="rounded-2xl border border-good/20 bg-good/5 p-5">
              <h2 className="text-sm font-semibold text-emerald-300">🧪 Example from your world</h2>
              <p className={`mt-2 text-sm leading-relaxed text-slate-200 ${ur}`}>{l.example}</p>
            </div>
          )}
          {analogy && (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
              <h2 className="text-sm font-semibold text-amber-200">💡 Think of it like this</h2>
              <p className={`mt-2 text-sm leading-relaxed text-slate-200 ${ur}`}>{analogy}</p>
            </div>
          )}
        </section>
      )}

      {l.whyItMatters && (
        <p className={`rounded-2xl border border-white/5 bg-ink-800/60 px-5 py-4 text-sm leading-relaxed text-slate-300 ${ur}`}>
          🎯 <span className="font-semibold text-slate-100">Why it matters to you: </span>
          {l.whyItMatters}
        </p>
      )}

      <div className="panel p-4">
        <TopicBrief journey={journey} lang={lang} mediaOnly />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary px-6 py-3 text-base" onClick={() => { stopSpeaking(); onStart(); }}>
          {review ? '↩ Back to the mission' : '🚀 Got it — start the scenario'}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            if (speaking) {
              stopSpeaking();
              setSpeaking(false);
              return;
            }
            setSpeaking(speak(readAloud, lang, () => setSpeaking(false)));
          }}
        >
          {speaking ? '⏹ Stop' : '🔊 Read the lesson to me'}
        </button>
      </div>
    </div>
  );
}
