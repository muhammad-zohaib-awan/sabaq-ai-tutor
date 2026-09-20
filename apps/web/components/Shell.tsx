'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, session } from '@/lib/api';
import { t, langName, type Lang } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { isMuted, setMuted } from '@/lib/sound';
import { LiveTestModal } from './LiveTestModal';
import { BadgeUnlock } from './BadgeUnlock';
import { Toasts } from './Toasts';

const LANGS: Lang[] = ['en', 'ur', 'mix'];

export function Shell({ children }: { children: React.ReactNode }) {
  const { ready, user, setUser, lang, setLang, learnState, degraded } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [liveTest, setLiveTest] = useState(false);
  const [muted, setMutedState] = useState(false);

  useEffect(() => setMutedState(isMuted()), []);

  useEffect(() => {
    if (!ready) return;
    if (!user && pathname !== '/login') router.replace('/login');
  }, [ready, user, pathname, router]);

  if (pathname === '/login') return <>{children}</>;

  const progress = learnState?.progress;
  const xpPct = progress ? Math.min(100, (progress.xpIntoLevel / Math.max(1, progress.xpForLevel)) * 100) : 0;
  const isAdmin = user?.role === 'admin';

  const nav = [
    { href: '/', label: t('learn', lang) },
    ...(isAdmin
      ? [
          { href: '/configure', label: t('configure', lang) },
          { href: '/insights', label: t('insights', lang) },
        ]
      : []),
  ];

  async function switchRole(role: 'admin' | 'learner') {
    try {
      const res = await api.demoLogin(role);
      session.set(res.token, res.user);
      setUser(res.user);
      router.replace(role === 'admin' ? '/' : '/');
      router.refresh();
    } catch {
      /* the toast layer reports failures from the calling page */
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/20 text-accent">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h3l2-5 3 10 2.5-7 1.8 4H21" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">Sabaq</span>
              <span className="block text-[10px] uppercase tracking-wider text-slate-400">
                AI Learning Experience Engine
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
                  pathname === n.href ? 'bg-accent/20 text-accent-soft' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span className="font-semibold">Lv {progress?.level ?? 1}</span>
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-accent transition-all duration-700"
                  style={{ width: `${xpPct}%` }}
                />
              </span>
              <span className="tabular-nums font-semibold">{progress?.xp ?? 0} XP</span>
            </div>

            <div className="flex overflow-hidden rounded-xl border border-white/10">
              {LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-3 py-1.5 text-xs font-semibold transition ${
                    lang === l ? 'bg-white text-ink-900' : 'text-slate-300 hover:bg-white/5'
                  } ${l === 'ur' ? 'urdu text-sm' : ''}`}
                >
                  {langName(l)}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className="hidden sm:inline">{t('viewingAs', lang)}</span>
              <select
                value={user?.role ?? 'learner'}
                onChange={(e) => switchRole(e.target.value as 'admin' | 'learner')}
                className="rounded-xl border border-white/10 bg-ink-800 px-2.5 py-1.5 text-xs font-semibold text-slate-100"
              >
                <option value="admin">{t('admin', lang)}</option>
                <option value="learner">{t('learner', lang)}</option>
              </select>
            </label>

            <button
              onClick={() => {
                const v = !muted;
                setMuted(v);
                setMutedState(v);
              }}
              title={muted ? 'Unmute sounds' : 'Mute sounds'}
              className="rounded-xl border border-white/10 p-2 text-slate-300 hover:bg-white/5"
            >
              {muted ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                  <path d="m17 9 4 6m0-6-4 6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
                  <path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" strokeLinecap="round" />
                </svg>
              )}
            </button>

            <button className="btn-primary" onClick={() => setLiveTest(true)}>
              {t('liveTest', lang)}
            </button>
          </div>
        </div>

        {degraded && (
          <div className="border-t border-amber-400/20 bg-amber-400/10 px-4 py-1.5 text-center text-xs text-amber-200">
            {t('degraded', lang)}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>

      {liveTest && <LiveTestModal onClose={() => setLiveTest(false)} />}
      <BadgeUnlock />
      <Toasts />
    </div>
  );
}
