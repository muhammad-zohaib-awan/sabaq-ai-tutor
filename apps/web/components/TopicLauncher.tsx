'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';
import { canListen, listen, type Listener } from '@/lib/speech';
import { sfxTap } from '@/lib/sound';
import type { Lang } from '@/lib/i18n';
import { LearnerFields, defaultLearnerValue, resolveLearner, type LearnerValue } from './LearnerFields';

/**
 * The learner's first screen is one sentence: "I want to learn X as a Y".
 * The topic and the learner are the two inputs that shape everything the
 * engine writes, so the headline itself is the form.
 */

const EXAMPLES: Array<{ topic: string; as: string }> = [
  { topic: 'React.js', as: 'software developer' },
  { topic: 'the cardiac cycle', as: 'student' },
  { topic: 'KYC checks for new accounts', as: 'new bank teller' },
  { topic: 'handling an angry customer', as: 'call centre agent' },
  { topic: 'how a car engine works', as: 'curious beginner' },
  { topic: 'photosynthesis', as: 'class 9 student' },
];

const AS_SUGGESTIONS = [
  'software developer',
  'student',
  'medical student',
  'nursing trainee',
  'new bank teller',
  'call centre agent',
  'manager',
  'curious beginner',
];

/**
 * Pulls { topic, as } out of a typed or SPOKEN sentence.
 *
 * Works on half-finished speech too (interim results): "I want to",
 * "I want to learn React as", "mujhe React seekhna hai bataur developer",
 * "مجھے ری ایکٹ سیکھنا ہے بطور ڈویلپر". The sentence frame — "I want to
 * learn", "as a" — never lands in the inputs; only the topic and the career.
 */
const LEAD =
  /^\s*(?:(?:so|okay|ok|um+|uh+|hmm+|hello|hi)[,\s]+)*(?:i(?:\s+(?:want|wanna|would\s+like|'d\s+like|need|am\s+trying))?(?:\s+to)?(?:\s+(?:learn|understand|study|know))?(?:\s+about)?|teach\s+me(?:\s+about)?|help\s+me\s+(?:learn|understand)|mujhe|mujhay|main|mein|مجھے|میں)\b[\s,]*/i;
const TAIL_URDU = /\s+(?:seekhna|sikhna|samajhna|seekhni|sikhni)\s*(?:hai|he|hain|chahta|chahti|chahta\s+hoon|chahti\s+hoon)?(?:\s+hoon|\s+hun)?\s*$|\s*(?:سیکھنا|سمجھنا)\s*(?:ہے|چاہتا|چاہتی)?\s*(?:ہوں)?\s*$/i;
const AS_SPLIT =
  /^(.*?)\s+(?:as\s+(?:an?\s+|the\s+)?|bataur\s+|ba\s*taur\s+|ke\s+taur\s+(?:par|pe)\s+|kay\s+taur\s+par\s+|بطور\s+|کے\s+طور\s+پر\s+)(.*)$/i;
const AS_TRAIL = /\s+(?:as(?:\s+an?|\s+the)?|bataur|ke\s+taur(?:\s+(?:par|pe))?|بطور|کے\s+طور(?:\s+پر)?)\s*$/i;

export function parseSentence(raw: string): { topic: string; as?: string } {
  // Keep dots inside words (React.js, Node.js); drop sentence punctuation.
  let s = raw.replace(/[!?۔،]+/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  // A lone "I", "I want", "I want to" while still speaking is just the frame.
  if (/^(?:i|i\s+want|i\s+want\s+to|i\s+want\s+to\s+learn|i\s+wanna|mujhe|مجھے)$/i.test(s)) return { topic: '' };
  s = s.replace(LEAD, '').trim();

  const m = s.match(AS_SPLIT);
  if (m) {
    const who = m[2].replace(TAIL_URDU, '').replace(/^(?:an?|the)(?:\s+|$)/i, '').trim();
    return { topic: m[1].replace(TAIL_URDU, '').trim(), as: who };
  }
  return { topic: s.replace(AS_TRAIL, '').replace(TAIL_URDU, '').trim() };
}

export function TopicLauncher() {
  const { lang, setLang, setJourney, refreshState, toast } = useApp();

  const [topic, setTopic] = useState('');
  const [as, setAs] = useState('');
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [learner, setLearner] = useState<LearnerValue>(defaultLearnerValue());
  const [difficulty, setDifficulty] = useState(3);
  const [buildLang, setBuildLang] = useState<Lang>(lang);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [listening, setListening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState<any>(null);
  const recRef = useRef<Listener | null>(null);
  const autoBuild = useRef<any>(null);

  useEffect(() => {
    api.ready().then(setReady).catch(() => setReady(null));
  }, []);

  useEffect(
    () => () => {
      recRef.current?.stop();
      clearTimeout(autoBuild.current);
    },
    [],
  );

  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(pdf|txt|md|docx)$/i.test(f.name)) return toast('error', 'Upload a PDF, DOCX, TXT or MD file.');
    if (f.size > 25 * 1024 * 1024) return toast('error', 'That file is over 25 MB.');
    setFile(f);
    setShowPaste(false);
  }

  /** Typing the whole sentence into the topic box also works. */
  function onTopicChange(v: string) {
    // Only rewrite when they clearly typed the whole sentence; normal typing is untouched.
    if (/^\s*(i\s+want\s+to\s+learn|teach\s+me|mujhe)\s/i.test(v) || /\s(as\s+an?|bataur)\s+\S/i.test(v)) {
      const p = parseSentence(v);
      setTopic(p.topic);
      if (p.as) setAs(p.as);
    } else setTopic(v);
  }

  function toggleVoice() {
    if (listening) return recRef.current?.stop();
    setListening(true);
    void api.event({ type: 'voice_used', payload: { mode: 'input', surface: 'launcher', language: buildLang } });
    recRef.current = listen(buildLang, {
      onPartial: (text) => {
        clearTimeout(autoBuild.current);
        const p = parseSentence(text);
        setTopic(p.topic);
        if (p.as !== undefined) setAs(p.as);
      },
      onFinal: (f) => {
        const p = parseSentence(f);
        setTopic(p.topic);
        if (p.as) setAs(p.as);
        if (!p.topic) return;
        clearTimeout(autoBuild.current);
        autoBuild.current = setTimeout(() => void build(p.topic, p.as), 1800);
      },
      onError: (m) => {
        toast('error', m);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!recRef.current) setListening(false);
  }

  async function build(topicOverride?: string, asOverride?: string) {
    const t = (topicOverride ?? topic).trim();
    const text = pasted.trim();
    if (!file && !t && !text) return toast('error', 'Tell me what you want to learn, or attach a document.');

    const who = (asOverride ?? as).trim() || 'curious beginner';
    const { constraint, constraintNote } = resolveLearner(learner);

    setBusy(true);
    const started = Date.now();
    const timers = [
      setTimeout(() => setStage('Reading what you want to learn…'), 200),
      setTimeout(() => setStage(`Writing a lesson for a ${who}…`), 2200),
      setTimeout(() => setStage('Designing your scenario…'), 5500),
      setTimeout(() => setStage('Almost there…'), 9000),
    ];

    try {
      let res: any;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        if (t) fd.append('topic', t);
        fd.append('learnerType', who);
        fd.append('language', buildLang);
        fd.append('constraint', constraint);
        if (constraintNote) fd.append('constraintNote', constraintNote);
        fd.append('difficulty', String(difficulty));
        res = await api.build(fd);
      } else {
        res = await api.build({
          topic: t,
          text,
          learnerType: who,
          language: buildLang,
          constraint,
          constraintNote,
          difficulty,
        });
      }

      const journey = res.journey ?? res;
      setJourney(journey);
      setLang(buildLang);
      await refreshState(journey.id);

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      toast(
        'success',
        res.cached
          ? `⚡ Ready in ${secs}s (from cache).`
          : journey.degraded
            ? `Built in ${secs}s without a model — the offline builder handled it.`
            : `Built in ${secs}s via ${journey.provider}.`,
      );
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not build that. Try rephrasing it.');
    } finally {
      timers.forEach(clearTimeout);
      setStage('');
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="grid min-h-[70vh] place-items-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="relative mx-auto mb-7 grid h-20 w-20 place-items-center">
            <span className="absolute inset-0 animate-shimmer rounded-full bg-accent/20 blur-xl" />
            <span className="relative h-12 w-12 animate-spin rounded-full border-[3px] border-white/10 border-t-accent" />
          </div>
          <p className="text-lg font-semibold">{stage || 'Starting…'}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            You will get a short lesson first, then a situation to work through.
          </p>
        </div>
      </div>
    );
  }

  const inputCls =
    'min-w-0 border-b-2 border-white/15 bg-transparent px-1 pb-1 font-extrabold text-accent-soft placeholder:font-bold placeholder:text-slate-600 focus:border-accent focus:outline-none';

  return (
    <div
      className="mx-auto max-w-3xl px-1 py-8 sm:py-14"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        acceptFile(e.dataTransfer.files?.[0]);
      }}
    >
      {ready && ready.aiProvidersConfigured?.length === 0 && (
        <div className="mb-8 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold">No AI key is configured on the server.</p>
          <p className="mt-1 text-amber-100/80">
            Uploaded documents still work offline. A topic needs a model — add{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">GEMINI_API_KEY</code> to{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">apps/api/.env</code>.
          </p>
        </div>
      )}

      {/* the sentence is the form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void build();
        }}
        className={`rounded-3xl border-2 p-2 transition ${dragging ? 'border-dashed border-accent bg-accent/5' : 'border-transparent'}`}
      >
        <h1 className="text-3xl font-bold leading-[1.35] tracking-tight text-slate-300 sm:text-5xl sm:leading-[1.3]">
          <span>I want to learn </span>
          {file ? (
            <span className="font-extrabold text-accent-soft" title={file.name}>
              from “{(() => {
                const n = file.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ');
                return n.length > 26 ? `${n.slice(0, 24)}…` : n;
              })()}”
            </span>
          ) : (
            <input
              aria-label="What do you want to learn?"
              value={topic}
              onChange={(e) => onTopicChange(e.target.value)}
              placeholder="React.js"
              maxLength={300}
              autoFocus
              className={`${inputCls} w-full sm:w-auto sm:max-w-full`}
              size={Math.max(9, Math.min(28, topic.length + 1))}
            />
          )}
          <span> as a </span>
          <input
            aria-label="Who are you?"
            value={as}
            onChange={(e) => setAs(e.target.value)}
            list="as-suggestions"
            placeholder="software developer"
            maxLength={80}
            className={`${inputCls} w-full sm:w-auto`}
            size={Math.max(19, Math.min(28, as.length + 1))}
          />
          <datalist id="as-suggestions">
            {AS_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </h1>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {AS_SUGGESTIONS.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAs(s)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                as === s ? 'border-accent bg-accent/15 text-slate-50' : 'border-white/10 text-slate-400 hover:border-white/25'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary px-6 py-3 text-base" disabled={!topic.trim() && !file && !pasted.trim()}>
            🚀 Start learning
          </button>

          {canListen() && (
            <button
              type="button"
              onClick={toggleVoice}
              className={`btn ${listening ? 'bg-red-500/20 text-red-200' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${listening ? 'animate-pulse bg-red-400' : 'bg-slate-400'}`} />
              {listening ? 'Listening…' : '🎤 Say it'}
            </button>
          )}

          {file ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => setFile(null)}>
              ✕ Remove file
            </button>
          ) : (
            <label className="btn-ghost cursor-pointer text-xs">
              <input type="file" className="sr-only" accept=".pdf,.txt,.md,.docx" onChange={(e) => acceptFile(e.target.files?.[0])} />
              📎 Attach a document
            </label>
          )}

          {!file && (
            <button type="button" className="btn-ghost text-xs" onClick={() => setShowPaste((v) => !v)}>
              {showPaste ? 'Hide pasted text' : 'Paste text'}
            </button>
          )}

          <div className="flex overflow-hidden rounded-xl border border-white/10">
            {(['en', 'ur', 'mix'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setBuildLang(l)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  buildLang === l ? 'bg-white text-ink-900' : 'text-slate-300 hover:bg-white/5'
                } ${l === 'ur' ? 'urdu' : ''}`}
              >
                {l === 'en' ? 'English' : l === 'ur' ? 'اردو' : 'Mix'}
              </button>
            ))}
          </div>

          <button type="button" onClick={() => setAdvanced((a) => !a)} className="btn-ghost text-xs" aria-expanded={advanced}>
            {advanced ? 'Fewer options' : 'More options'}
          </button>
        </div>

        {showPaste && !file && (
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            className="field mt-4 resize-y"
            placeholder="Paste a policy, notes, an article… The lesson will be built from this text."
          />
        )}
      </form>

      {advanced && (
        <div className="animate-riseFade panel mt-4 space-y-5 p-5">
          <LearnerFields value={learner} onChange={setLearner} hideLearner />
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-200">Starting difficulty · {difficulty}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <p className="mt-1 text-[11px] text-slate-500">It adapts from here based on what you actually do.</p>
          </div>
        </div>
      )}

      <section className="mt-12 border-t border-white/5 pt-6">
        <p className="text-sm text-slate-500">Try one of these</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.topic}
              type="button"
              onClick={() => {
                sfxTap();
                setFile(null);
                setTopic(ex.topic);
                setAs(ex.as);
              }}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-slate-300 transition hover:border-accent/40"
            >
              <span className="font-semibold text-slate-100">{ex.topic}</span>
              <span className="text-slate-500"> as a {ex.as}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
