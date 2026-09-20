'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';
import { canListen, listen, type Listener } from '@/lib/speech';
import type { Lang } from '@/lib/i18n';

const LEARNER_TYPES = [
  'Nursing trainee',
  'Bank branch officer',
  'Call centre agent',
  'New joiner (any role)',
  'School student',
  'Compliance analyst',
  'Software engineer',
];

const CONSTRAINTS: Array<{ id: string; label: string; help: string }> = [
  { id: 'standard', label: 'Standard', help: 'No special constraint.' },
  { id: 'low_bandwidth', label: 'Low bandwidth', help: 'Short text, no waveform, minimal visuals.' },
  { id: 'voice_only', label: 'Voice only', help: 'Everything must make sense read aloud.' },
  { id: 'accessibility', label: 'Accessibility', help: 'Screen-reader first, no colour-only meaning.' },
  { id: 'offline_first', label: 'Offline first', help: 'Self-contained, no external references.' },
];

/**
 * The panel's live test lands here: drop unseen content, change the learner type,
 * the language or the operating constraint, and rebuild the journey in place.
 */
export function LiveTestModal({ onClose }: { onClose: () => void }) {
  const { setJourney, refreshState, toast, lang, setLang } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [learnerType, setLearnerType] = useState(LEARNER_TYPES[0]);
  const [constraint, setConstraint] = useState('standard');
  const [difficulty, setDifficulty] = useState(3);
  const [buildLang, setBuildLang] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<Listener | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      recRef.current?.stop();
    };
  }, [busy, onClose]);

  function accept(f: File | null | undefined) {
    if (!f) return;
    const ok = /\.(pdf|txt|md|docx)$/i.test(f.name);
    if (!ok) return toast('error', 'Upload a PDF, DOCX, TXT or MD file.');
    if (f.size > 25 * 1024 * 1024) return toast('error', 'That file is over 25 MB.');
    setFile(f);
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    setListening(true);
    recRef.current = listen(buildLang, {
      onPartial: (p) => setText(p),
      onFinal: (f) => setText(f),
      onError: (m) => {
        toast('error', m);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!recRef.current) setListening(false);
  }

  async function build() {
    if (!file && !text.trim()) {
      return toast('error', 'Drop a file, or paste some text or a topic first.');
    }
    setBusy(true);
    const started = Date.now();
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
        const looksLikeTopic = text.trim().length < 140 && !text.includes('\n');
        res = await api.build({
          [looksLikeTopic ? 'topic' : 'text']: text.trim(),
          topic: looksLikeTopic ? text.trim() : '',
          text: looksLikeTopic ? '' : text.trim(),
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
          ? `Built in ${secs}s using the offline builder — no model was reachable.`
          : `Built in ${secs}s via ${journey.provider}. ${journey.conceptCount} concepts extracted.`,
      );
      onClose();
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not build that journey.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/80 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="livetest-title"
        className="animate-riseFade max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-ink-800 p-6 shadow-2xl"
      >
        <h2 id="livetest-title" className="text-xl font-bold">
          Live test: new content
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Drop unseen content, change the learner or the constraint, and rebuild the journey.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files?.[0]);
          }}
          className={`mt-5 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging ? 'border-accent bg-accent/10' : 'border-white/15 hover:border-white/30'
          }`}
        >
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.txt,.md,.docx"
            onChange={(e) => accept(e.target.files?.[0])}
          />
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="mt-2 font-semibold">
            {file ? file.name : 'Drop a PDF or text file, or click to browse'}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {file ? `${(file.size / 1024).toFixed(0)} KB · click to replace` : 'PDF, TXT, DOCX, MD · up to 25 MB'}
          </span>
        </label>

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">Or paste text or a topic</span>
            {canListen() && (
              <button
                onClick={toggleVoice}
                type="button"
                className={`chip border ${
                  listening ? 'border-red-400/40 bg-red-500/20 text-red-200' : 'border-white/10 bg-white/5 text-slate-300'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${listening ? 'animate-pulse bg-red-400' : 'bg-slate-400'}`} />
                {listening ? 'Listening…' : 'Voice typing'}
              </button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="field resize-y"
            placeholder="e.g. Know Your Customer checks for new accounts"
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Learner type</span>
            <select value={learnerType} onChange={(e) => setLearnerType(e.target.value)} className="field">
              {LEARNER_TYPES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">Operating constraint</span>
            <select value={constraint} onChange={(e) => setConstraint(e.target.value)} className="field">
              {CONSTRAINTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {CONSTRAINTS.find((c) => c.id === constraint)?.help}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="label">Language</span>
            <div className="flex overflow-hidden rounded-xl border border-white/10">
              {(['en', 'ur', 'mix'] as Lang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setBuildLang(l)}
                  className={`flex-1 px-3 py-2 text-xs font-semibold transition ${
                    buildLang === l ? 'bg-white text-ink-900' : 'text-slate-300 hover:bg-white/5'
                  } ${l === 'ur' ? 'urdu' : ''}`}
                >
                  {l === 'en' ? 'English' : l === 'ur' ? 'اردو' : 'Mix'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Starting difficulty · {difficulty}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className="mt-2 w-full accent-accent"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              The engine adapts from here based on what the learner does.
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary min-w-[150px]" onClick={build} disabled={busy}>
            {busy ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Building…
              </>
            ) : (
              'Build journey'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
