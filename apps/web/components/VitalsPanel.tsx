'use client';

import { useState } from 'react';
import { sfxHeartbeat } from '@/lib/sound';

const TONE: Record<string, string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-slate-200',
};

/** One ECG complex (P, QRS, T) as a polyline, repeated across the panel width. */
function ecgPath(width: number, height: number, beats: number): string {
  const mid = height / 2;
  const beatW = width / beats;
  const pts: string[] = [];
  for (let b = 0; b < beats; b++) {
    const x = b * beatW;
    const s = (f: number) => x + beatW * f;
    pts.push(
      `${s(0)},${mid}`,
      `${s(0.12)},${mid}`,
      `${s(0.16)},${mid - height * 0.07}`, // P
      `${s(0.2)},${mid}`,
      `${s(0.3)},${mid}`,
      `${s(0.33)},${mid + height * 0.09}`, // Q
      `${s(0.36)},${mid - height * 0.42}`, // R
      `${s(0.39)},${mid + height * 0.16}`, // S
      `${s(0.43)},${mid}`,
      `${s(0.6)},${mid}`,
      `${s(0.67)},${mid - height * 0.14}`, // T
      `${s(0.74)},${mid}`,
      `${s(1)},${mid}`,
    );
  }
  return pts.join(' ');
}

/** Phonocardiogram: S1, a systolic murmur smear, then S2. */
function pcgPath(width: number, height: number, beats: number, murmur: boolean): string {
  const mid = height / 2;
  const beatW = width / beats;
  const pts: string[] = [];
  for (let b = 0; b < beats; b++) {
    const x = b * beatW;
    const s = (f: number) => x + beatW * f;
    pts.push(`${s(0)},${mid}`, `${s(0.3)},${mid}`);
    // S1 burst
    for (let i = 0; i < 6; i++) {
      pts.push(`${s(0.32 + i * 0.012)},${mid + (i % 2 ? -1 : 1) * height * (0.3 - i * 0.03)}`);
    }
    pts.push(`${s(0.4)},${mid}`);
    if (murmur) {
      for (let i = 0; i < 14; i++) {
        const f = 0.42 + i * 0.013;
        const amp = height * 0.1 * Math.sin((Math.PI * i) / 14);
        pts.push(`${s(f)},${mid + (i % 2 ? -amp : amp)}`);
      }
    }
    pts.push(`${s(0.62)},${mid}`);
    for (let i = 0; i < 5; i++) {
      pts.push(`${s(0.64 + i * 0.011)},${mid + (i % 2 ? -1 : 1) * height * (0.22 - i * 0.03)}`);
    }
    pts.push(`${s(0.72)},${mid}`, `${s(1)},${mid}`);
  }
  return pts.join(' ');
}

export function VitalsPanel({ panel, lang }: { panel: any; lang: string }) {
  const [playing, setPlaying] = useState(false);
  if (!panel) return null;

  const W = 900;
  const H = 150;
  const beats = 6;
  const showWave = panel.waveform && panel.waveform !== 'none';

  function playCue() {
    setPlaying(true);
    sfxHeartbeat(panel.audioCue?.kind === 'heartbeat', 3);
    setTimeout(() => setPlaying(false), 2400);
  }

  return (
    <section className="panel p-4 sm:p-5" aria-label={panel.title}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-200">{panel.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{panel.subtitle}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        {showWave ? (
          <div className="overflow-hidden rounded-xl border border-white/5 bg-ink-900/70 p-2">
            <svg viewBox={`0 0 ${W} ${H * 2 + 10}`} className="h-[210px] w-full" role="img" aria-label="Waveform trace">
              <defs>
                <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M30 0H0V30" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={W} height={H * 2 + 10} fill="url(#grid)" />

              <text x="8" y="16" className="fill-slate-500" fontSize="11">
                ECG II
              </text>
              <polyline
                points={ecgPath(W, H, beats)}
                fill="none"
                stroke="#34d399"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              <text x="8" y={H + 24} className="fill-slate-500" fontSize="11">
                PCG
              </text>
              <g transform={`translate(0 ${H + 10})`}>
                <polyline
                  points={pcgPath(W, H, beats, true)}
                  fill="none"
                  stroke="#93b4dd"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </g>

              {playing && (
                <rect x="0" y="0" width={W} height={H * 2 + 10} fill="none">
                  <animate attributeName="x" from="0" to={W} dur="2.4s" />
                </rect>
              )}
            </svg>
          </div>
        ) : (
          <div className="rounded-xl border border-white/5 bg-ink-900/70 p-4 text-sm text-slate-400">
            Waveform hidden for this operating constraint. The caption below carries the same
            information in text.
          </div>
        )}

        <div className="flex flex-row flex-wrap gap-4 lg:flex-col lg:gap-3">
          {(panel.metrics ?? []).map((m: any) => (
            <div key={m.label} className="min-w-[110px]">
              <p className="text-xs text-slate-400">{m.label}</p>
              <p className={`text-3xl font-extrabold tabular-nums ${TONE[m.tone] ?? TONE.neutral}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">{panel.caption}</p>
        {panel.audioCue?.kind !== 'none' && (
          <button className="btn-primary" onClick={playCue} disabled={playing}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            {panel.audioCue?.label ?? 'Play cue'}
          </button>
        )}
      </footer>
    </section>
  );
}
