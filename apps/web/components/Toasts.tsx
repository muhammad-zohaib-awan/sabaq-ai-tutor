'use client';

import { useApp } from '@/lib/state';

export function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) =>
        t.kind === 'xp' ? (
          <div
            key={t.id}
            className="animate-xpFloat rounded-full bg-accent px-5 py-2 text-lg font-extrabold text-white shadow-lg shadow-accent/30"
          >
            {t.text}
          </div>
        ) : (
          <div
            key={t.id}
            className={`animate-riseFade rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.kind === 'error'
                ? 'border-red-400/30 bg-red-500/15 text-red-100'
                : t.kind === 'success'
                  ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100'
                  : 'border-white/10 bg-ink-700 text-slate-100'
            }`}
          >
            {t.text}
          </div>
        ),
      )}
    </div>
  );
}
