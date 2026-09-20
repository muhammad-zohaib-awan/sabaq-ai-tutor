'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';

export function OnboardingModal({ onDone }: { onDone: () => void }) {
  const { user, setUser } = useApp();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.event({
        type: 'learner_profile_set',
        payload: { name: name.trim(), age: age ? Number(age) : null },
      });
      if (user) {
        const updated = { ...user, name: name.trim() };
        setUser(updated);
        try { localStorage.setItem('sabaq.user', JSON.stringify(updated)); } catch {}
      }
    } catch {
      /* non-blocking */
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/80 p-4 backdrop-blur-sm">
      <div className="animate-riseFade w-full max-w-md rounded-3xl border border-white/10 bg-ink-800 p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent/20 text-accent">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-2xl font-extrabold">Welcome to Sabaq!</h2>
          <p className="mt-1 text-sm text-slate-400">
            Tell us a bit about yourself so the AI can personalize your experience.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="onb-name">Your name</label>
            <input
              id="onb-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ahmed"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void save(); }}
            />
          </div>
          <div>
            <label className="label" htmlFor="onb-age">
              Your age <span className="font-normal text-slate-500">(optional — helps AI set the right level)</span>
            </label>
            <input
              id="onb-age"
              type="number"
              min={8}
              max={99}
              className="field"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 25"
            />
          </div>

          <button
            className="btn-primary mt-2 w-full"
            onClick={save}
            disabled={!name.trim() || busy}
          >
            {busy ? 'Saving…' : 'Start Learning →'}
          </button>
        </div>
      </div>
    </div>
  );
}
