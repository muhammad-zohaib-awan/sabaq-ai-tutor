'use client';

/**
 * The heart visual. Valves are the interactive elements: tap one to flip it
 * between its two states, then run the beat to see the consequence.
 *
 * Correctness is never shown before the learner runs it — the whole point of
 * this step is that they commit to a decision first.
 */
export function HeartSim({
  elements,
  states,
  onToggle,
  legend,
  flow,
  disabled,
}: {
  elements: Array<{ id: string; label: string; states: [string, string]; group?: string }>;
  states: Record<string, number>;
  onToggle: (id: string) => void;
  legend?: Array<{ label: string; color: string }>;
  flow: 'idle' | 'running' | 'good' | 'bad';
  disabled?: boolean;
}) {
  const left = elements.filter((e) => e.group !== 'right');
  const right = elements.filter((e) => e.group === 'right');

  const CH = {
    ra: { x: 30, y: 20, w: 130, h: 82, fill: '#12365e', stroke: '#3b82f6', label: 'Right atrium' },
    la: { x: 220, y: 20, w: 130, h: 82, fill: '#4a1622', stroke: '#ef4444', label: 'Left atrium' },
    rv: { x: 30, y: 152, w: 130, h: 120, fill: '#12365e', stroke: '#3b82f6', label: 'Right ventricle' },
    lv: { x: 220, y: 152, w: 130, h: 120, fill: '#4a1622', stroke: '#ef4444', label: 'Left ventricle' },
  };

  // Which valve sits where. Falls back to slot order for generated journeys.
  const slots = [
    { key: 'av-left', x: 95, y: 126, labelX: 22, labelAnchor: 'end' as const },
    { key: 'av-right', x: 285, y: 126, labelX: 358, labelAnchor: 'start' as const },
    { key: 'out-left', x: 95, y: 288, labelX: 22, labelAnchor: 'end' as const },
    { key: 'out-right', x: 285, y: 288, labelX: 358, labelAnchor: 'start' as const },
  ];

  const ordered = [left[0], right[0], left[1], right[1]].filter(Boolean) as typeof elements;

  const flowColor =
    flow === 'bad' ? '#f59e0b' : flow === 'good' ? '#34d399' : 'rgba(148,163,184,.45)';

  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-4">
      <svg viewBox="0 0 380 400" className="mx-auto h-[420px] w-full max-w-[420px]" role="group" aria-label="Heart valve simulation">
        <defs>
          <marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 z" fill={flowColor} />
          </marker>
        </defs>

        {Object.entries(CH).map(([k, c]) => (
          <g key={k}>
            <rect
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              rx={k.endsWith('v') ? 26 : 18}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth="1.6"
              opacity="0.92"
            />
            <text x={c.x + c.w / 2} y={c.y + c.h / 2 + 4} textAnchor="middle" fontSize="12" className="fill-slate-200">
              {c.label}
            </text>
          </g>
        ))}

        {/* blood-flow dots */}
        {[
          [95, 40], [95, 70], [285, 40], [285, 70],
          [95, 180], [95, 220], [285, 180], [285, 220],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3" fill={i % 4 < 2 ? '#3b82f6' : '#ef4444'} opacity="0.8">
            {flow === 'running' && (
              <animate attributeName="cy" values={`${cy};${cy + 14};${cy}`} dur="1.1s" repeatCount="3" />
            )}
          </circle>
        ))}

        {/* outlets */}
        <rect x="60" y="316" width="70" height="52" rx="16" fill="#12365e" stroke="#3b82f6" strokeWidth="1.4" />
        <text x="95" y="384" textAnchor="middle" fontSize="11" className="fill-slate-400">To lungs</text>
        <rect x="250" y="316" width="70" height="52" rx="16" fill="#4a1622" stroke="#ef4444" strokeWidth="1.4" />
        <text x="285" y="384" textAnchor="middle" fontSize="11" className="fill-slate-400">To body</text>

        {/* valves */}
        {ordered.map((el, i) => {
          const slot = slots[i];
          if (!slot) return null;
          const open = (states[el.id] ?? 0) === 0;
          const stateLabel = el.states[states[el.id] ?? 0];
          return (
            <g
              key={el.id}
              onClick={() => !disabled && onToggle(el.id)}
              role="button"
              tabIndex={0}
              aria-label={`${el.label}, currently ${stateLabel}. Activate to change.`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!disabled) onToggle(el.id);
                }
              }}
              className={disabled ? 'cursor-default' : 'cursor-pointer'}
            >
              <rect
                x={slot.x - 34}
                y={slot.y - 20}
                width="68"
                height="40"
                rx="10"
                fill="transparent"
                className="transition"
              />
              {open ? (
                <>
                  <line x1={slot.x - 26} y1={slot.y + 12} x2={slot.x - 8} y2={slot.y - 12} stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
                  <line x1={slot.x + 26} y1={slot.y + 12} x2={slot.x + 8} y2={slot.y - 12} stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
                </>
              ) : (
                <line x1={slot.x - 28} y1={slot.y} x2={slot.x + 28} y2={slot.y} stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
              )}
              <text
                x={slot.labelX}
                y={slot.y - 2}
                textAnchor={slot.labelAnchor}
                fontSize="12"
                fontWeight="600"
                className="fill-slate-200"
              >
                {el.label}
              </text>
              <text
                x={slot.labelX}
                y={slot.y + 14}
                textAnchor={slot.labelAnchor}
                fontSize="11"
                className={open ? 'fill-emerald-300' : 'fill-slate-400'}
              >
                {stateLabel}
              </text>
            </g>
          );
        })}
      </svg>

      {legend?.length ? (
        <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
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
