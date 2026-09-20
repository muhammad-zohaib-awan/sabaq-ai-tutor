'use client';

import { speechLocale, type Lang } from './i18n';

/**
 * Voice in and out via the browser's own Web Speech API.
 *
 * Deliberately not a paid STT/TTS service: it is free, adds no latency from an
 * upload round trip, keeps the learner's voice on their own device (nothing is
 * recorded or sent anywhere), and degrades to typing where unsupported. The UI
 * always shows the text equivalent, so voice is an addition, never a requirement.
 */

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export const canListen = () =>
  typeof window !== 'undefined' &&
  Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang?.toLowerCase() === locale.toLowerCase()) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(locale.split('-')[0])) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith('en'))
  );
}

export function speak(text: string, lang: Lang, onEnd?: () => void): boolean {
  if (!canSpeak() || !text.trim()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 2000));
    const locale = speechLocale(lang);
    u.lang = locale;
    const v = pickVoice(locale);
    if (v) u.voice = v;
    u.rate = lang === 'ur' ? 0.92 : 1;
    u.pitch = 1;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  if (canSpeak()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

export interface Listener {
  stop: () => void;
}

export function listen(
  lang: Lang,
  handlers: {
    onPartial?: (text: string) => void;
    onFinal: (text: string) => void;
    onError?: (message: string) => void;
    onEnd?: () => void;
  },
): Listener | null {
  if (!canListen()) {
    handlers.onError?.('Voice input is not supported in this browser. Chrome or Edge works best.');
    return null;
  }
  try {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = speechLocale(lang);
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let final = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) handlers.onPartial?.(final + interim);
    };
    rec.onerror = (e: any) => {
      const map: Record<string, string> = {
        'not-allowed': 'Microphone access was blocked. Allow it in the address bar and try again.',
        'no-speech': 'I did not catch that. Try again a little closer to the mic.',
        network: 'Voice recognition needs a network connection.',
      };
      handlers.onError?.(map[e?.error] ?? 'Voice input stopped unexpectedly. You can type instead.');
    };
    rec.onend = () => {
      if (final.trim()) handlers.onFinal(final.trim());
      handlers.onEnd?.();
    };
    rec.start();
    return { stop: () => rec.stop() };
  } catch {
    handlers.onError?.('Could not start voice input. You can type instead.');
    return null;
  }
}
