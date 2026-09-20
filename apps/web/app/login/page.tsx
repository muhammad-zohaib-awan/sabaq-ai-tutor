'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, session } from '@/lib/api';
import { useApp } from '@/lib/state';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function go(fn: () => Promise<any>, tag: string) {
    setBusy(tag);
    setError('');
    try {
      const res = await fn();
      session.set(res.token, res.user);
      setUser(res.user);
      router.replace('/');
    } catch (e: any) {
      setError(
        e?.message?.includes('fetch')
          ? 'Cannot reach the API — try again in about 30 seconds.'
          : (e?.message ?? 'Sign in failed.'),
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-accent/20 text-accent">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h3l2-5 3 10 2.5-7 1.8 4H21" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight">Sabaq</h1>
          <p className="mt-1 text-sm text-slate-400">AI Learning Experience Engine</p>
        </div>

        <div className="panel p-6">
          {/* BUG 13: One-click demo sign-in — clean, no marketing copy */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="btn-primary"
              disabled={Boolean(busy)}
              onClick={() => go(() => api.demoLogin('learner'), 'learner')}
            >
              {busy === 'learner' ? 'Signing in…' : 'Enter as Learner'}
            </button>
            <button
              className="btn-ghost"
              disabled={Boolean(busy)}
              onClick={() => go(() => api.demoLogin('admin'), 'admin')}
            >
              {busy === 'admin' ? 'Signing in…' : 'Enter as Admin'}
            </button>
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-slate-600">
            <span className="h-px flex-1 bg-white/10" />
            or sign in with a password
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void go(() => api.login(email, password), 'form');
            }}
          >
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@sabaq.app"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button className="btn-primary w-full" disabled={busy === 'form' || !email || !password}>
              {busy === 'form' ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
