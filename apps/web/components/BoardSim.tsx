'use client';

/**
 * The generic decision board — what every non-cardiac topic gets.
 * Same primitive as the heart: commit each element to one of two states, run,
 * see the consequence. Works for KYC documents, safety interlocks, triage
 * decisions, code review calls, anything with a judgement to make.
 */
export function BoardSim({
  elements,
  states,
  onToggle,
  legend,
  disabled,
  lang,
}: {
  elements: Array<{ id: string; label: string; states: [string, string] }>;
  states: Record<string, number>;
  onToggle: (id: string) => void;
  legend?: Array<{ label: string; color: string }>;
  disabled?: boolean;
  lang: string;
}) {
  return (
    <div className="space-y-3">
      {elements.map((el) => {
        const active = states[el.id] ?? 0;
        return (
          <div
            key={el.id}
            className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-ink-900/60 p-4 sm:flex-row sm:items-center"
          >
            <p className={`flex-1 text-sm leading-relaxed text-slate-200 ${lang === 'ur' ? 'urdu' : ''}`}>
              {el.label}
            </p>
            <div
              className="flex shrink-0 overflow-hidden rounded-xl border border-white/10"
              role="radiogroup"
              aria-label={el.label}
            >
              {el.states.map((s, i) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={active === i}
                  disabled={disabled}
                  onClick={() => active !== i && onToggle(el.id)}
                  className={`px-4 py-2 text-xs font-semibold transition ${
                    active === i ? 'bg-accent text-white' : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {legend?.length ? (
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
