import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { DEFAULT_CONFIG, answerQuestion, buildJourney, gradeExplanation, publicJourney } from '@sabaq/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Degraded-mode engine: takes over when the Nest API is unreachable.
 *
 * Locked down, because an open route here is a free AI proxy on your key:
 *  - OFF unless LOCAL_ENGINE_FALLBACK=true.
 *  - Requires a valid session token, verified with the same JWT_SECRET as
 *    the API (HS256, issuer + audience checked).
 *  - Only accepts the journey fields the engine needs, size-capped.
 */

const hits = new Map<string, { n: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now > row.resetAt) {
    hits.set(key, { n: 1, resetAt: now + 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  row.n += 1;
  return row.n > 20;
}

function verify(token: string): { sub: string } | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32 || !token) return null;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.iss !== 'sabaq-api' || claims.aud !== 'sabaq-web') return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
    return { sub: String(claims.sub) };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (process.env.LOCAL_ENGINE_FALLBACK !== 'true') {
    return NextResponse.json({ message: 'Local fallback is disabled.' }, { status: 503 });
  }
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const user = verify(token);
  if (!user) return NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
  if (rateLimited(user.sub)) return NextResponse.json({ message: 'Too many requests. Wait a minute.' }, { status: 429 });

  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ message: 'Request too large.' }, { status: 413 });
  let body: any = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return NextResponse.json({ message: 'Bad JSON.' }, { status: 400 });
  }

  const action = (params.path ?? []).join('/');
  try {
    if (action === 'journey') {
      const { journey, attempts } = await buildJourney(
        {
          text: String(body.text ?? '').slice(0, DEFAULT_CONFIG.maxSourceChars),
          topic: String(body.topic ?? '').slice(0, 300),
          sourceName: body.text ? 'Pasted text' : 'Your topic',
          learnerType: String(body.learnerType ?? DEFAULT_CONFIG.defaultLearnerType).slice(0, 80),
          language: ['en', 'ur', 'mix'].includes(body.language) ? body.language : 'en',
          constraint: ['standard', 'low_bandwidth', 'voice_only', 'accessibility', 'offline_first'].includes(body.constraint)
            ? body.constraint
            : 'standard',
          constraintNote: String(body.constraintNote ?? '').slice(0, 160) || undefined,
          difficulty: body.difficulty ? Math.min(5, Math.max(1, Number(body.difficulty) || 3)) : undefined,
        },
        DEFAULT_CONFIG,
      );
      return NextResponse.json({ journey: { ...publicJourney(journey), degraded: true }, attempts, local: true });
    }

    // ask / explain need a journey; the local engine only has what the client sends.
    const journey = body.journey;
    if (!journey || !Array.isArray(journey.steps)) {
      return NextResponse.json({ message: 'The API is unreachable. Try again in a moment.' }, { status: 503 });
    }

    if (action === 'ask') {
      const step = journey.steps.find((s: any) => s.id === body.stepId) ?? journey.steps[1];
      const res = await answerQuestion({
        journey,
        step,
        question: String(body.question ?? '').slice(0, 1500),
        language: ['en', 'ur', 'mix'].includes(body.language) ? body.language : 'en',
        history: Array.isArray(body.history) ? body.history.slice(-6) : [],
        cfg: DEFAULT_CONFIG,
      });
      return NextResponse.json({ ...res, degraded: true, local: true });
    }

    if (action === 'explain') {
      const step = journey.steps.find((s: any) => s.id === body.stepId) ?? journey.steps[2];
      if (!step?.explain) return NextResponse.json({ message: 'Not an explain step.' }, { status: 400 });
      const res = await gradeExplanation({
        step: { ...step, explain: { ...step.explain, modelAnswer: '', rubric: step.explain.rubric ?? [] } },
        answer: String(body.answer ?? '').slice(0, 4000),
        language: ['en', 'ur', 'mix'].includes(body.language) ? body.language : 'en',
        cfg: DEFAULT_CONFIG,
      });
      return NextResponse.json({ ...res, degraded: true, local: true });
    }

    return NextResponse.json({ message: 'Unknown engine action.' }, { status: 404 });
  } catch {
    return NextResponse.json({ message: 'The local engine could not complete that request.' }, { status: 500 });
  }
}
