'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Generated infographic.
 *
 *  - Cached twice: here per journey (hide/show never refetches) and on the
 *    server by topic (a second learner gets it instantly). "Regenerate" is the
 *    only thing that asks the model again.
 *  - Rendered as an <img> from a data: URL. Inside <img>, SVG cannot run
 *    scripts or load anything, so model output can never touch the page.
 */
const memo = new Map<string, string>();

function toDataUrl(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export function SmartDiagram({
  sessionId,
  topicTitle,
  lang,
}: {
  sessionId: string;
  imagePrompt?: string;
  topicTitle?: string;
  lang?: string;
}) {
  const mk = `${sessionId}:${lang ?? ''}`;
  const [src, setSrc] = useState(() => memo.get(mk) ?? '');
  const [loading, setLoading] = useState(!memo.has(mk));
  const [error, setError] = useState('');

  async function load(force = false) {
    setLoading(true);
    setError('');
    try {
      const data = await api.diagramSvg(sessionId, force, lang);
      if (!data?.svg?.includes('<svg')) throw new Error('No diagram came back. Try again.');
      const url = toDataUrl(data.svg);
      memo.set(mk, url);
      setSrc(url);
    } catch (e: any) {
      setError(e?.message || 'Could not generate the diagram.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (memo.has(mk)) {
      setSrc(memo.get(mk)!);
      setLoading(false);
      return;
    }
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mk]);

  return (
    <div className="relative mt-4 min-h-[200px] animate-riseFade rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      {loading && (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <span className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          <p className="text-sm font-medium text-slate-200">Drawing a diagram of {topicTitle || 'this topic'}…</p>
          <p className="mt-1 text-xs text-slate-400">A few seconds, only the first time — after that it is saved.</p>
        </div>
      )}

      {src && !loading && (
        <>
          <img src={src} alt={`Infographic: ${topicTitle ?? ''}`} className="h-auto w-full rounded-xl" />
          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-400">
            <span>✨ AI-generated diagram — check key facts against the lesson</span>
            <button onClick={() => void load(true)} className="text-xs text-accent hover:underline">
              🔄 Regenerate
            </button>
          </div>
        </>
      )}

      {error && !loading && !src && (
        <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400">
          <p className="mb-2 text-sm text-red-300">{error}</p>
          <button onClick={() => void load(false)} className="btn-ghost mt-2 text-xs">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
