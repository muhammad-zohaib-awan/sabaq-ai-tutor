'use client';

import { useState, useEffect } from 'react';

export function SmartDiagram({
  sessionId,
  imagePrompt,
  topicTitle,
}: {
  sessionId: string;
  imagePrompt?: string;
  topicTitle: string;
}) {
  const [svgCode, setSvgCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tier, setTier] = useState<'gemini' | 'fallback'>('gemini');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setSvgCode('');
    setError(false);
    setTier('gemini');

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

    // Tier 1: Gemini SVG via backend
    (async () => {
      try {
        console.log('[SmartDiagram] Tier 1: Trying Gemini SVG…');
        const res = await fetch(`${apiBase}/api/learn/${sessionId}/diagram-svg`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('sabaq.token')}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.svg && data.svg.includes('<svg') && isMounted) {
          console.log('[SmartDiagram] Tier 1 success ✓');
          setSvgCode(data.svg);
          setLoading(false);
          return;
        }
        throw new Error('No valid SVG returned');
      } catch (err) {
        console.warn('[SmartDiagram] Tier 1 (Gemini) failed, trying Tier 2 (Pollinations)…', err);
        if (!isMounted) return;
        setTier('fallback');
        // Tier 2: Pollinations image fallback
        if (!imagePrompt) {
          setError(true);
          setLoading(false);
          return;
        }
        setLoading(false); // image loads via onLoad/onError
      }
    })();

    return () => { isMounted = false; };
  }, [sessionId, imagePrompt]);

  if (!imagePrompt && !svgCode && !loading) return null;

  return (
    <div className="mt-4 animate-riseFade rounded-xl border border-white/10 bg-white/5 p-4 relative min-h-[200px]">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl z-10">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent mb-2" />
          <span className="text-xs text-slate-400 animate-pulse">Generating diagram with Gemini…</span>
        </div>
      )}

      {/* Tier 1: Gemini SVG Infographic */}
      {svgCode && (
        <>
          <div
            dangerouslySetInnerHTML={{ __html: svgCode }}
            className="w-full overflow-x-auto rounded-xl [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-w-full"
          />
          <p className="mt-2 text-[11px] text-slate-500 text-center border-t border-white/10 pt-2">
            AI-generated infographic (Gemini) · For learning only, not a primary source
          </p>
        </>
      )}

      {/* Tier 2: Pollinations fallback image */}
      {tier === 'fallback' && imagePrompt && !svgCode && (
        <FallbackImage prompt={imagePrompt} />
      )}

      {error && !svgCode && (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          Diagram not available for this topic.
        </div>
      )}
    </div>
  );
}

function FallbackImage({ prompt }: { prompt: string }) {
  const [imgLoading, setImgLoading] = useState(true);
  const [imgError, setImgError] = useState(false);

  return (
    <>
      {imgError ? (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          Diagram not available for this topic.
        </div>
      ) : (
        <div className="relative">
          {imgLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/5 rounded-xl">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
            </div>
          )}
          <img
            src={`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=880&height=520&nologo=true`}
            alt={`Diagram: ${prompt}`}
            className={`w-full rounded-xl border border-white/10 transition-opacity duration-500 ${imgLoading ? 'opacity-0' : 'opacity-100'}`}
            loading="lazy"
            onLoad={() => setImgLoading(false)}
            onError={() => { setImgLoading(false); setImgError(true); }}
          />
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500 text-center border-t border-white/10 pt-2">
        AI-generated visual aid (Pollinations) · Not a source of truth
      </p>
    </>
  );
}
