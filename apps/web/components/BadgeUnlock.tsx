'use client';

import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import { useApp } from '@/lib/state';
import { confetti } from '@/lib/sound';

/** Emoji per badge icon. A badge can also carry its own `emoji`. */
export const BADGE_EMOJI: Record<string, string> = {
  spark: '🚀',
  shield: '💪',
  question: '🤔',
  loop: '🔁',
  voice: '🎤',
  trophy: '🏆',
  globe: '🌍',
  step: '🎯',
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

  const isLevel = Boolean(badge.levelUp) || badge.kind === 'level';
  const isStep = badge.kind === 'step';
  const emoji = badge.emoji ?? (isLevel ? '🎉' : BADGE_EMOJI[badge.icon] ?? '✨');
  const title = (badge.label || '').trim() || (isStep ? 'Step cleared!' : isLevel ? `Level ${badge.levelUp}` : 'New badge');
  const header = isLevel ? t('levelUp', lang) : isStep ? '🎯 Step cleared' : `🏅 ${t('badgeUnlocked', lang)}`;

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
          {header}
        </p>

        <div className="relative mx-auto my-6 grid h-28 w-28 place-items-center">
          <span className="absolute inset-0 animate-shimmer rounded-full bg-accent/20 blur-xl" />
          <span className="relative grid h-24 w-24 place-items-center rounded-full border-2 border-accent/50 bg-ink-900">
            <span className="text-5xl leading-none" role="img" aria-label={title}>
              {emoji}
            </span>
            {isLevel && badge.levelUp && (
              <span className="absolute -bottom-2 rounded-full bg-accent px-2.5 py-0.5 text-xs font-black text-white">
                Lv {badge.levelUp}
              </span>
            )}
          </span>
        </div>

        <h2 className={`text-2xl font-extrabold ${lang === 'ur' ? 'urdu' : ''}`}>{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{badge.description}</p>

        <button className="btn-primary mt-7 w-full" onClick={shiftBadge} autoFocus>
          {t('continue', lang)}
        </button>
      </div>
    </div>
  );
}
