'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';
import { canListen, listen, type Listener } from '@/lib/speech';
import { sfxTap } from '@/lib/sound';
import type { Lang } from '@/lib/i18n';

/**
 * The learner's first screen.
 *
 * This is the product: a person arrives with a topic in their head, a document
 * in their hand, or a question on their lips, and the engine turns it into an
 * experience. Nothing is preloaded — there is no default subject, because the
 * whole point is that the subject comes from the learner.
 */

const EXAMPLES = [
  { label: 'How kidneys filter blood', hint: 'Biology' },
  { label: 'The cardiac cycle and heart sounds', hint: 'Clinical' },
  { label: 'Know Your Customer checks for new accounts', hint: 'Banking' },
  { label: 'Handling a customer complaint at the counter', hint: 'Service' },
  { label: 'How a car engine turns fuel into motion', hint: 'Engineering' },
  { label: 'Photosynthesis', hint: 'School' },
];

const LEARNER_SUGGESTIONS = [
  'Nursing trainee',
  'New branch teller',
  'Call centre agent',
  'Class 9 student',
  'Compliance analyst',
  'New joiner, first week',
];

const CONSTRAINTS = [
  { id: 'standard', label: 'Standard' },
  { id: 'low_bandwidth', label: 'Low bandwidth' },
  { id: 'voice_only', label: 'Voice only' },
  { id: 'accessibility', label: 'Accessibility first' },
  { id: 'offline_first', label: 'Offline first' },
];

export function TopicLauncher() {
  const { lang, setLang, setJourney, refreshState, toast } = useApp();

  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [learnerType, setLearnerType] = useState('New joiner, first week');
  const [constraint, setConstraint] = useState('standard');
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

  // Surfaced in the UI rather than buried in a server log: a missing key is the
  // single most likely reason a fresh checkout will not generate anything.
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
    setInput('');
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    setListening(true);
    void api.event({ type: 'voice_used', payload: { mode: 'input', surface: 'launcher', language: buildLang } });
    recRef.current = listen(buildLang, {
      onPartial: (p) => {
        clearTimeout(autoBuild.current);
        setInput(p);
      },
      onFinal: (f) => {
        setInput(f);
        // Speaking a topic and then waiting is the natural gesture — build for
        // them rather than making them reach for the mouse.
        clearTimeout(autoBuild.current);
        autoBuild.current = setTimeout(() => void build(f), 1800);
      },
      onError: (m) => {
        toast('error', m);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!recRef.current) setListening(false);
  }

  async function build(override?: string) {
    const text = (override ?? input).trim();
    if (!file && !text) return toast('error', 'Tell me what you want to learn, or drop a file.');

    setBusy(true);
    const started = Date.now();
    const timers = [
      setTimeout(() => setStage('Reading your material…'), 200),
      setTimeout(() => setStage('Pulling out the concepts…'), 2200),
      setTimeout(() => setStage('Choosing how to make it interactive…'), 5000),
      setTimeout(() => setStage('Writing your mission…'), 8000),
    ];

    try {
      let res: any;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('learnerType', learnerType);
        fd.append('language', buildLang);
        fd.append('constraint', constraint);
        fd.append('difficulty', String(difficulty));
        res = await api.build(fd);
      } else {
        // A short single line is a topic ("kidneys"); anything longer is source material.
        const isTopic = text.length < 140 && !text.includes('\n');
        res = await api.build({
          topic: isTopic ? text : '',
          text: isTopic ? '' : text,
          learnerType,
          language: buildLang,
          constraint,
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
        journey.degraded
          ? `Built in ${secs}s without a model — the offline builder handled it.`
          : `Built in ${secs}s via ${journey.provider}. ${journey.conceptCount} concepts extracted.`,
      );
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not build that. Try rephrasing it, or paste some text.');
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
            One model call builds the whole mission. After this, everything runs in your browser —
            no waiting between steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-1 py-6 sm:py-12">
      <header className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          What do you want to learn?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-400">
          Type it, say it, or drop a document. You will not get a summary or a quiz — you will get a
          situation you have to work your way through.
        </p>
      </header>

      {ready && ready.aiProvidersConfigured?.length === 0 && (
        <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
          <p className="font-semibold">No AI key is configured on the server yet.</p>
          <p className="mt-1 text-amber-100/80">
            Pasting text or uploading a PDF still works — those are built offline from your own
            material. A one-line topic needs a model. Add{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">GEMINI_API_KEY</code> to{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">apps/api/.env</code> and restart the API.
          </p>
        </div>
      )}

      {/* the one input that matters */}
      <div
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
        className={`mt-8 rounded-3xl border-2 p-2 transition ${
          dragging ? 'border-dashed border-accent bg-accent/5' : 'border-transparent'
        }`}
      >
        <div className="panel p-2">
          {file ? (
            <div className="flex items-center gap-3 p-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 3v5h5M7 3h8l5 5v13H7z" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-100">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setFile(null)}>
                Remove
              </button>
            </div>
          ) : (
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void build();
              }}
              rows={3}
              dir={buildLang === 'ur' ? 'rtl' : 'ltr'}
              className={`w-full resize-none bg-transparent px-4 py-3 text-lg text-slate-100 placeholder:text-slate-600 focus:outline-none ${
                buildLang === 'ur' ? 'urdu' : ''
              }`}
              placeholder="e.g. how kidneys filter blood — or paste a whole policy document"
              autoFocus
            />
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-white/5 p-2">
            <label className="btn-ghost cursor-pointer text-xs">
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.txt,.md,.docx"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
              </svg>
              PDF / DOCX
            </label>

            {canListen() && (
              <button
                onClick={toggleVoice}
                className={`btn text-xs ${
                  listening
                    ? 'bg-red-500/20 text-red-200'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${listening ? 'animate-pulse bg-red-400' : 'bg-slate-400'}`} />
                {listening ? 'Listening — pause when done' : 'Say it'}
              </button>
            )}

            <div className="flex overflow-hidden rounded-xl border border-white/10">
              {(['en', 'ur', 'mix'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setBuildLang(l)}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    buildLang === l ? 'bg-white text-ink-900' : 'text-slate-300 hover:bg-white/5'
                  } ${l === 'ur' ? 'urdu' : ''}`}
                >
                  {l === 'en' ? 'English' : l === 'ur' ? 'اردو' : 'Mix'}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAdvanced((a) => !a)}
              className="btn-ghost text-xs"
              aria-expanded={advanced}
            >
              {advanced ? 'Hide options' : 'Who is learning?'}
            </button>

            <button className="btn-primary ms-auto" onClick={() => void build()} disabled={!input.trim() && !file}>
              Build my mission
            </button>
          </div>
        </div>
      </div>

      {advanced && (
        <div className="animate-riseFade panel mt-3 grid gap-4 p-5 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <span className="label">I am a…</span>
            <input
              className="field"
              list="learner-suggestions"
              value={learnerType}
              onChange={(e) => setLearnerType(e.target.value)}
              placeholder="anything — 'new teller', 'class 9 student', 'ICU nurse'"
            />
            <datalist id="learner-suggestions">
              {LEARNER_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-slate-500">
              Free text. The scenario is written for whoever you say you are.
            </p>
          </div>

          <div>
            <span className="label">Constraint</span>
            <select className="field" value={constraint} onChange={(e) => setConstraint(e.target.value)}>
              {CONSTRAINTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <span className="label">Starting difficulty · {difficulty}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="w-full accent-accent"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              It adapts from here based on what you actually do.
            </p>
          </div>
        </div>
      )}

      {/* examples — these go through the same pipeline, nothing is preloaded */}
      <section className="mt-9">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
          Or start from one of these
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              onClick={() => {
                sfxTap();
                setFile(null);
                setInput(ex.label);
              }}
              className="chip border border-white/10 bg-white/5 text-slate-300 transition hover:border-accent/40 hover:bg-accent/10"
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{ex.hint}</span>
              {ex.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-slate-600">
          These are ordinary inputs, not canned demos — each one is generated fresh, the same way
          anything you type is.
        </p>
      </section>
    </div>
  );
}
