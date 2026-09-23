'use client';

import { useCallback, useEffect, useState } from 'react';
import { pick } from '@/lib/i18n';
import { SmartDiagram } from './SmartDiagram';

/**
 * What the learner reads before they are asked to do anything.
 *
 * Replaces the old vitals panel, which drew a synthetic ECG trace on every
 * topic — fine for the cardiac sample it was built for, absurd on a lithium
 * battery. Nothing here is hardcoded to a subject: the primer, the analogy, the
 * diagram prompt and the video query all come from the generated mission.
 *
 * All hooks run unconditionally, before any early return. The previous version
 * declared a hook after `if (...) return null`, which is a Rules-of-Hooks
 * violation — React throws "rendered fewer hooks than expected" the moment the
 * condition flips, and the video never loaded.
 */
export function TopicBrief({ journey, lang, mediaOnly = false }: { journey: any; lang: any; mediaOnly?: boolean }) {
  const [show, setShow] = useState<'none' | 'image' | 'video'>('none');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  const query: string = journey?.media?.videoSearchQuery ?? '';
  const primer = pick(journey?.primer, lang);
  const analogy = pick(journey?.analogy, lang);
  const lowBandwidth =
    journey?.constraint === 'low_bandwidth' || journey?.constraint === 'offline_first';

  // Only fetched when the learner asks for it — no cost, no wait, unless wanted.
  const loadVideo = useCallback(async () => {
    if (!query || videoId || videoState === 'loading') return;
    setVideoState('loading');
    try {
      const res = await fetch(`/api/youtube?q=${encodeURIComponent(query.slice(0, 120))}`);
      const data = await res.json();
      if (data?.videoId) {
        setVideoId(data.videoId);
        setVideoState('ready');
      } else {
        setVideoState('failed');
      }
    } catch {
      setVideoState('failed');
    }
  }, [query, videoId, videoState]);

  useEffect(() => {
    // A new mission invalidates the old video.
    setVideoId(null);
    setVideoState('idle');
    setShow('none');
  }, [journey?.id]);

  if (!mediaOnly && !primer.trim() && !analogy.trim()) return null;
  if (mediaOnly && lowBandwidth) return null;

  const isUr = lang === 'ur';

  return (
    <section className={mediaOnly ? '' : 'panel p-5'}>
      {!mediaOnly && primer.trim() && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-soft">
            First, the basics
          </p>
          <p className={`mt-2 text-base leading-relaxed text-slate-100 ${isUr ? 'urdu text-lg' : ''}`}>
            {primer}
          </p>
        </>
      )}

      {!mediaOnly && analogy.trim() && (
        <div className={`${primer.trim() ? 'mt-4 border-t border-white/5 pt-4' : ''}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Think of it like this
          </p>
          <p className={`mt-1.5 text-sm leading-relaxed text-slate-300 ${isUr ? 'urdu text-base' : ''}`}>
            {analogy}
          </p>
        </div>
      )}

      {!lowBandwidth && (
        <div className={`flex flex-wrap gap-2 ${mediaOnly ? '' : 'mt-4 border-t border-white/5 pt-4'}`}>
          <button
            className="btn-ghost text-xs"
            onClick={() => setShow((s) => (s === 'image' ? 'none' : 'image'))}
          >
            {show === 'image' ? 'Hide diagram' : '🖼️ Show a diagram'}
          </button>

          {query && (
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setShow((s) => (s === 'video' ? 'none' : 'video'));
                void loadVideo();
              }}
            >
              {show === 'video' ? 'Hide video' : '▶️ Watch a short video'}
            </button>
          )}
        </div>
      )}

      {show === 'image' && (
        <SmartDiagram
          sessionId={journey.id}
          lang={lang}
          imagePrompt={journey?.media?.imagePrompt}
          topicTitle={journey?.topic ?? ''}
        />
      )}

      {show === 'video' && (
        <div className="animate-riseFade mt-4">
          {videoState === 'loading' && (
            <div className="flex h-[200px] items-center justify-center gap-3 rounded-xl border border-white/10 bg-ink-900/60 text-sm text-slate-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
              Finding a video on “{query}”…
            </div>
          )}

          {videoState === 'ready' && videoId && (
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title={`Explainer: ${query}`}
                className="h-full w-full"
                allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
              />
            </div>
          )}

          {videoState === 'failed' && (
            <div className="rounded-xl border border-white/10 bg-ink-900/60 p-4 text-sm leading-relaxed text-slate-400">
              Could not find a video automatically.{' '}
              <a
                className="font-semibold text-accent-soft hover:underline"
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Search YouTube for “{query}”
              </a>
            </div>
          )}

          <p className="mt-2 text-[11px] text-slate-500">
            External video, chosen by search — a supplement, not the source you are assessed on.
          </p>
        </div>
      )}
    </section>
  );
}
