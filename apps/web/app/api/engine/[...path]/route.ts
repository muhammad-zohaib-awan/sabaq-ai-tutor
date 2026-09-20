import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_CONFIG,
  answerQuestion,
  buildJourney,
  gradeExplanation,
  sampleJourney,
} from '@sabaq/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Degraded-mode engine.
 *
 * The NestJS service is the real API. This route exists so that a sleeping
 * free-tier container or a dropped connection does not end a live demo: the
 * frontend retries here and the *same* shared engine package serves the request
 * in-process. No database writes happen here — progress resumes syncing as soon
 * as the API is reachable again, and the UI says plainly that it is degraded.
 */

const hits = new Map<string, { n: number; resetAt: number }>();

function rateLimited(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now > row.resetAt) {
    hits.set(ip, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  row.n += 1;
  return row.n > 20;
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (rateLimited(req)) {
    return NextResponse.json({ message: 'Too many requests. Wait a minute.' }, { status: 429 });
  }

  const action = (params.path ?? []).join('/');
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    if (action === 'journey') {
      const { journey, attempts } = await buildJourney(
        {
          text: String(body.text ?? '').slice(0, DEFAULT_CONFIG.maxSourceChars),
          topic: String(body.topic ?? '').slice(0, 300),
          sourceName: String(body.sourceName ?? 'Pasted text').slice(0, 80),
          learnerType: String(body.learnerType ?? DEFAULT_CONFIG.defaultLearnerType),
          language: ['en', 'ur', 'mix'].includes(body.language) ? body.language : 'en',
          constraint: body.constraint ?? 'standard',
          difficulty: body.difficulty ? Number(body.difficulty) : undefined,
        },
        DEFAULT_CONFIG,
      );
      return NextResponse.json({ journey: { ...journey, degraded: true }, attempts, local: true });
    }

    if (action === 'ask') {
      const journey = body.journey ?? sampleJourney(DEFAULT_CONFIG);
      const step = journey.steps?.find((s: any) => s.id === body.stepId) ?? journey.steps?.[1];
      const res = await answerQuestion({
        journey,
        step,
        question: String(body.question ?? ''),
        language: body.language ?? 'en',
        history: Array.isArray(body.history) ? body.history.slice(-6) : [],
        cfg: DEFAULT_CONFIG,
      });
      return NextResponse.json({ ...res, degraded: true, local: true });
    }

    if (action === 'explain') {
      const journey = body.journey ?? sampleJourney(DEFAULT_CONFIG);
      const step = journey.steps?.find((s: any) => s.id === body.stepId) ?? journey.steps?.[2];
      const res = await gradeExplanation({
        step,
        answer: String(body.answer ?? ''),
        language: body.language ?? 'en',
        cfg: DEFAULT_CONFIG,
      });
      return NextResponse.json({ ...res, degraded: true, local: true });
    }

    return NextResponse.json({ message: 'Unknown engine action.' }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json(
      { message: 'The local engine could not complete that request.', detail: String(e?.message).slice(0, 200) },
      { status: 500 },
    );
  }
}
