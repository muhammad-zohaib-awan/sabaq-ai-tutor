'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, session } from '@/lib/api';
import { useApp } from '@/lib/state';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoRoles, setDemoRoles] = useState<Array<'admin' | 'learner'>>([]);

  // Only render demo buttons the server actually allows.
  useEffect(() => {
    api.authOptions().then((o) => setDemoRoles(o.demoRoles ?? [])).catch(() => setDemoRoles([]));
  }, []);

  async function go(fn: () => Promise<any>) {
    setBusy(true);
    setError('');
    try {
      const res = await fn();
      session.set(res.token, res.user);
      setUser(res.user);
      router.replace('/');
    } catch (e: any) {
      setError(
        e?.message?.includes('fetch')
          ? 'Cannot reach the API — make sure the server is running.'
          : (e?.message ?? 'Sign in failed. Check your credentials.'),
      );
    } finally {
      setBusy(false);
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

        <div className="panel p-6 space-y-5">
          {/* Primary: email + password login */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void go(() => api.login(email, password));
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
                placeholder="your@email.com"
                disabled={busy}
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
                disabled={busy}
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || !email || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {demoRoles.length > 0 && (
            <div className="border-t border-white/10 pt-4">
              <p className="mb-3 text-center text-xs text-slate-500">Quick demo access</p>
              <div className={`grid gap-2 ${demoRoles.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                {demoRoles.includes('learner') && (
                  <button className="btn-ghost text-sm" disabled={busy} onClick={() => go(() => api.demoLogin('learner'))}>
                    🎓 Demo Learner
                  </button>
                )}
                {demoRoles.includes('admin') && (
                  <button className="btn-ghost text-sm" disabled={busy} onClick={() => go(() => api.demoLogin('admin'))}>
                    🛠️ Demo Admin
                  </button>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
