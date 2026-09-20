'use client';

/**
 * All audio is synthesised with the Web Audio API — no asset files, nothing to
 * host, nothing to load on a slow connection, and it works offline. Every sound
 * is short, quiet and respects the user's mute preference.
 */

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem('sabaq.muted', String(v));
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('sabaq.muted') === 'true' || muted;
  } catch {
    return muted;
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || isMuted()) return null;
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, gain = 0.12, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + duration);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + duration + 0.05);
}

/** Rising arpeggio — awarded XP. */
export const sfxXp = () => {
  tone(660, 0, 0.12, 0.1);
  tone(880, 0.08, 0.14, 0.09);
};

/** Fuller fanfare — a badge came out. */
export const sfxBadge = () => {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.32, 0.11, 'triangle'));
  tone(1318.5, 0.42, 0.5, 0.06, 'sine');
};

/** Deeper, longer — level up. */
export const sfxLevel = () => {
  [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.08, 0.4, 0.12, 'triangle'));
};

export const sfxCorrect = () => {
  tone(587.33, 0, 0.1, 0.09);
  tone(880, 0.07, 0.2, 0.08);
};

export const sfxWrong = () => {
  tone(233.08, 0, 0.16, 0.08, 'sawtooth');
  tone(196, 0.1, 0.22, 0.06, 'sawtooth');
};

export const sfxTap = () => tone(440, 0, 0.05, 0.05, 'square');

/**
 * Two-beat heart sound: lub (S1, low and short) - dup (S2, higher and shorter),
 * with a band-limited noise burst in systole when a murmur is present.
 */
export function sfxHeartbeat(withMurmur = true, beats = 3) {
  const a = audio();
  if (!a) return;
  const period = 0.75;
  for (let b = 0; b < beats; b++) {
    const t0 = b * period;
    tone(62, t0, 0.13, 0.28, 'sine');
    tone(96, t0 + 0.005, 0.09, 0.12, 'sine');
    tone(88, t0 + 0.32, 0.09, 0.2, 'sine');
    tone(132, t0 + 0.325, 0.06, 0.09, 'sine');

    if (withMurmur) {
      const len = Math.floor(a.sampleRate * 0.22);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((Math.PI * i) / len);
        data[i] = (Math.random() * 2 - 1) * env * 0.55;
      }
      const src = a.createBufferSource();
      src.buffer = buf;
      const filter = a.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 300;
      filter.Q.value = 1.1;
      const g = a.createGain();
      g.gain.value = 0.11;
      src.connect(filter).connect(g).connect(a.destination);
      src.start(a.currentTime + t0 + 0.1);
    }
  }
}

/**
 * Confetti, hand-rolled on a canvas. No library: one fewer dependency to break
 * a build, about 40 lines, and it respects the reduced-motion preference.
 */
export function confetti(durationMs = 1600) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();

  const colors = ['#3d8bfd', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2 + (Math.random() - 0.5) * 220,
    y: canvas.height * 0.38,
    vx: (Math.random() - 0.5) * 11,
    vy: Math.random() * -13 - 4,
    size: Math.random() * 6 + 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const started = Date.now();
  let raf = 0;
  const tick = () => {
    const elapsed = Date.now() - started;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.vy += 0.36;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / durationMs);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < durationMs) raf = requestAnimationFrame(tick);
    else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
}
