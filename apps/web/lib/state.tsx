'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, isDegraded, session, type SessionUser } from './api';
import type { Lang } from './i18n';
import { sfxBadge, sfxLevel, sfxXp } from './sound';

export interface Toast {
  id: string;
  kind: 'xp' | 'info' | 'error' | 'success';
  text: string;
}

export interface BadgeCard {
  id: string;
  label: string;
  description: string;
  icon: string;
  levelUp?: number;
}

interface Ctx {
  ready: boolean;
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  journey: any | null;
  setJourney: (j: any | null) => void;
  learnState: any | null;
  refreshState: (journeyId?: string) => Promise<void>;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  badgeQueue: BadgeCard[];
  pushBadges: (b: BadgeCard[]) => void;
  shiftBadge: () => void;
  celebrateXp: (amount: number) => void;
  degraded: boolean;
  setDegraded: (v: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [lang, setLangState] = useState<Lang>('en');
  const [journey, setJourney] = useState<any | null>(null);
  const [learnState, setLearnState] = useState<any | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [badgeQueue, setBadgeQueue] = useState<BadgeCard[]>([]);
  const [degraded, setDegraded] = useState(false);
  const timers = useRef<Record<string, any>>({});

  useEffect(() => {
    setUser(session.user());
    try {
      const saved = localStorage.getItem('sabaq.lang') as Lang | null;
      if (saved && ['en', 'ur', 'mix'].includes(saved)) setLangState(saved);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Keep the degraded chip honest without polling the API on a timer.
  useEffect(() => {
    const i = setInterval(() => setDegraded(isDegraded()), 3000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    return () => Object.values(timers.current).forEach(clearTimeout);
  }, []);

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      try {
        localStorage.setItem('sabaq.lang', l);
      } catch {
        /* ignore */
      }
      void api.event({ type: 'language_switched', journeyId: journey?.id, payload: { language: l } });
    },
    [journey?.id],
  );

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((t) => [...t, { id, kind, text }]);
    timers.current[id] = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      delete timers.current[id];
    }, kind === 'error' ? 6000 : 3200);
  }, []);

  const celebrateXp = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      sfxXp();
      toast('xp', `+${amount} XP`);
    },
    [toast],
  );

  const pushBadges = useCallback((b: BadgeCard[]) => {
    if (!b.length) return;
    setBadgeQueue((q) => [...q, ...b]);
    if (b.some((x) => x.levelUp)) sfxLevel();
    else sfxBadge();
  }, []);

  const shiftBadge = useCallback(() => setBadgeQueue((q) => q.slice(1)), []);

  const refreshState = useCallback(async (journeyId?: string) => {
    try {
      const s = await api.state(journeyId);
      setLearnState(s);
    } catch {
      /* state is best-effort; the learner is not blocked by it */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      user,
      setUser,
      lang,
      setLang,
      journey,
      setJourney,
      learnState,
      refreshState,
      toasts,
      toast,
      badgeQueue,
      pushBadges,
      shiftBadge,
      celebrateXp,
      degraded,
      setDegraded,
    }),
    [ready, user, lang, setLang, journey, learnState, refreshState, toasts, toast, badgeQueue, pushBadges, shiftBadge, celebrateXp, degraded],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp must be used inside AppProvider');
  return c;
}
