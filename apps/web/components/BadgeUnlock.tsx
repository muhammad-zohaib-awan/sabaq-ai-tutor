'use client';

import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { confetti } from '@/lib/sound';

const ICONS: Record<string, JSX.Element> = {
  spark: <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m14.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m0-12.0 2.8 2.8m5.4 5.4 2.8 2.8" />,
  shield: <path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6l-7-3Z" />,
  question: <path d="M9.1 9a3 3 0 1 1 4.4 2.6c-.9.5-1.5 1.2-1.5 2.4m0 3.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  loop: <path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2M18 3v4h-4M6 21v-4h4" />,
  voice: <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Zm7 8a7 7 0 0 1-14 0m7 7v3" />,
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0V4Zm-3 1H3v2a3 3 0 0 0 3 3m13-5h2v2a3 3 0 0 1-3 3m-6 4v4m-3 2h6" />,
  globe: <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-18 0h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z" />,
};

export function BadgeUnlock() {
  const { badgeQueue, shiftBadge, lang } = useApp();
  const badge = badgeQueue[0];

  useEffect(() => {
    if (!badge) return;
    confetti(badge.levelUp ? 2200 : 1500);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && shiftBadge();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [badge, shiftBadge]);

  if (!badge) return null;

  const isLevel = Boolean(badge.levelUp);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('badgeUnlocked', lang)}
      onClick={shiftBadge}
    >
      <div
        className="animate-popIn w-full max-w-sm rounded-3xl border border-accent/30 bg-gradient-to-b from-ink-700 to-ink-850 p-8 text-center shadow-2xl shadow-accent/20"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-soft">
          {isLevel ? t('levelUp', lang) : t('badgeUnlocked', lang)}
        </p>

        <div className="relative mx-auto my-6 grid h-28 w-28 place-items-center">
          <span className="absolute inset-0 animate-shimmer rounded-full bg-accent/20 blur-xl" />
          <span className="relative grid h-24 w-24 place-items-center rounded-full border-2 border-accent/50 bg-ink-900">
            {isLevel ? (
              <span className="text-3xl font-black text-accent-soft">{badge.levelUp}</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-11 w-11 text-accent-soft"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[badge.icon] ?? ICONS.spark}
              </svg>
            )}
          </span>
        </div>

        <h2 className={`text-2xl font-extrabold ${lang === 'ur' ? 'urdu' : ''}`}>{badge.label}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{badge.description}</p>

        <button className="btn-primary mt-7 w-full" onClick={shiftBadge} autoFocus>
          {t('continue', lang)}
        </button>
      </div>
    </div>
  );
}
