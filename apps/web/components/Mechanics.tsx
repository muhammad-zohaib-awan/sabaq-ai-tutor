'use client';

import { useEffect, useMemo, useState } from 'react';
import { sfxTap } from '@/lib/sound';

/**
 * The mechanic palette, rendered.
 *
 * Every one of these works on arbitrary source material — the model supplies
 * data, never behaviour. Nothing here is topic-specific, and nothing evaluates
 * a model-authored expression: the only numbers that move are integers the
 * model wrote down explicitly.
 */

/* --------------------------------------------------------------- Order */

export function OrderWidget({
  spec,
  value,
  onChange,
  disabled,
  lang,
}: {
  spec: any;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  lang: string;
}) {
  const items = useMemo(
    () => value.map((id) => spec.items.find((i: any) => i.id === id)).filter(Boolean),
    [value, spec.items],
  );

  function move(from: number, to: number) {
    if (disabled || to < 0 || to >= value.length) return;
    const next = [...value];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    sfxTap();
    onChange(next);
  }

  return (
    <ol className="space-y-2">
      {items.map((item: any, i: number) => (
        <li
          key={item.id}
          draggable={!disabled}
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            move(Number(e.dataTransfer.getData('text/plain')), i);
          }}
          className={`flex items-start gap-3 rounded-2xl border border-white/5 bg-ink-900/60 p-3.5 ${
            disabled ? '' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/20 text-sm font-bold text-accent-soft">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium text-slate-100 ${lang === 'ur' ? 'urdu' : ''}`}>{item.label}</p>
            {item.note && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.note}</p>}
          </div>
          {/* Keyboard and touch path — dragging alone would fail accessibility. */}
          <div className="flex shrink-0 flex-col gap-1">
            <button
              onClick={() => move(i, i - 1)}
              disabled={disabled || i === 0}
              aria-label={`Move "${item.label}" earlier`}
              className="rounded-md border border-white/10 px-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-25"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, i + 1)}
              disabled={disabled || i === items.length - 1}
              aria-label={`Move "${item.label}" later`}
              className="rounded-md border border-white/10 px-2 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-25"
            >
              ▼
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------- Decide */

export function DecideWidget({
  spec,
  chosen,
  onChoose,
  result,
  lang,
}: {
  spec: any;
  chosen: string | null;
  onChoose: (id: string) => void;
  result: any;
  lang: string;
}) {
  const [meters, setMeters] = useState<Record<string, number>>(
    () => Object.fromEntries(spec.meters.map((m: any) => [m.id, m.value])),
  );

  // Meters animate to their new value only after the server returns the deltas,
  // so the consequence is revealed by the result, not by hovering the option.
  useEffect(() => {
    if (!result?.deltas) return;
    const t = setTimeout(() => {
      setMeters((prev) => {
        const next = { ...prev };
        for (const d of result.deltas) {
          const m = spec.meters.find((x: any) => x.id === d.meterId);
          if (!m) continue;
          next[d.meterId] = Math.max(0, Math.min(m.max, (prev[d.meterId] ?? 0) + d.delta));
        }
        return next;
      });
    }, 180);
    return () => clearTimeout(t);
  }, [result, spec.meters]);

  return (
    <div className="space-y-5">
      <div className={`rounded-2xl border border-white/5 bg-ink-900/60 p-4 text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
        {spec.situation}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spec.meters.map((m: any) => {
          const v = meters[m.id] ?? m.value;
          const pct = Math.round((v / m.max) * 100);
          const healthy = m.goodDirection === 'up' ? pct >= 60 : pct <= 40;
          const delta = result?.deltas?.find((d: any) => d.meterId === m.id)?.delta;
          return (
            <div key={m.id} className="rounded-xl border border-white/5 bg-ink-900/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-slate-400">{m.label}</p>
                {typeof delta === 'number' && delta !== 0 && (
                  <span
                    className={`animate-riseFade text-xs font-bold tabular-nums ${
                      (m.goodDirection === 'up') === delta > 0 ? 'text-good' : 'text-bad'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-slate-100">{v}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${healthy ? 'bg-good' : 'bg-warn'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <ul className="space-y-2.5">
        {spec.options.map((o: any) => {
          const isChosen = chosen === o.id;
          const revealed = Boolean(result) && isChosen;
          return (
            <li key={o.id}>
              <button
                onClick={() => !chosen && onChoose(o.id)}
                disabled={Boolean(chosen)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  isChosen
                    ? result?.quality === 'best'
                      ? 'border-good/40 bg-good/10'
                      : result?.quality === 'risky'
                        ? 'border-bad/40 bg-bad/10'
                        : 'border-warn/40 bg-warn/10'
                    : chosen
                      ? 'border-white/5 bg-ink-900/40 opacity-50'
                      : 'border-white/10 bg-ink-900/60 hover:border-accent/40 hover:bg-accent/5'
                }`}
              >
                <p className={`text-sm font-medium text-slate-100 ${lang === 'ur' ? 'urdu' : ''}`}>{o.label}</p>
                {revealed && (
                  <p className="animate-riseFade mt-2 text-sm leading-relaxed text-slate-300">
                    <span className="font-semibold">What happens: </span>
                    {result.message ?? o.consequence}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {result?.successMessage && (
        <p className="animate-riseFade rounded-xl border border-good/30 bg-good/10 p-3 text-sm text-emerald-100">
          {result.successMessage}
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Trace */

export function TraceWidget({
  spec,
  picked,
  onPick,
  result,
  lang,
}: {
  spec: any;
  picked: string | null;
  onPick: (id: string) => void;
  result: any;
  lang: string;
}) {
  const [flowIndex, setFlowIndex] = useState(-1);
  const [meter, setMeter] = useState(0);

  // After the learner commits, walk the particle along the chain so they see
  // where the quantity actually moves.
  useEffect(() => {
    if (!result) return;
    let i = 0;
    setFlowIndex(0);
    const timer = setInterval(() => {
      i += 1;
      if (i >= spec.nodes.length) {
        clearInterval(timer);
        return;
      }
      setFlowIndex(i);
      if (spec.nodes[i].id === spec.meterRisesAtNodeId) setMeter(100);
      else if (i > spec.nodes.findIndex((n: any) => n.id === spec.meterRisesAtNodeId)) setMeter(100);
      else setMeter(Math.round((i / spec.nodes.length) * 35));
    }, 700);
    return () => clearInterval(timer);
  }, [result, spec.nodes, spec.meterRisesAtNodeId]);

  return (
    <div className="space-y-5">
      <p className={`text-sm font-semibold text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>{spec.question}</p>

      <ol className="flex flex-wrap items-stretch gap-2">
        {spec.nodes.map((n: any, i: number) => {
          const isPicked = picked === n.id;
          const isCorrect = result && spec.correctNodeId && n.id === result.correctNodeId;
          const active = flowIndex === i;
          return (
            <li key={n.id} className="flex flex-1 basis-[160px] items-center gap-2">
              <button
                onClick={() => !picked && onPick(n.id)}
                disabled={Boolean(picked)}
                className={`w-full rounded-2xl border p-3 text-left transition ${
                  isCorrect
                    ? 'border-good/50 bg-good/10'
                    : isPicked
                      ? result
                        ? 'border-bad/40 bg-bad/10'
                        : 'border-accent/50 bg-accent/10'
                      : active
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-white/10 bg-ink-900/60 hover:border-white/25'
                }`}
              >
                <p className="text-sm font-semibold text-slate-100">{n.label}</p>
                {(result || active) && n.detail && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{n.detail}</p>
                )}
              </button>
              {i < spec.nodes.length - 1 && (
                <span
                  aria-hidden
                  className={`hidden shrink-0 text-lg sm:block ${
                    flowIndex > i ? 'text-accent' : 'text-slate-700'
                  }`}
                >
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl border border-white/5 bg-ink-900/60 p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs text-slate-400">{spec.meterLabel}</p>
          <p className="text-sm font-bold tabular-nums text-slate-200">{meter}%</p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-good transition-all duration-700"
            style={{ width: `${meter}%` }}
          />
        </div>
      </div>
    </div>
  );
}
