import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InsufficientSourceError,
  adapt,
  answerQuestion,
  award,
  buildJourney,
  gradeExplanation,
  inferMastery,
  progressFromXp,
  sampleJourney,
  completeWithFallback,
  type BuildJourneyInput,
  type Journey,
  type Language,
  type LearningEvent,
} from '@sabaq/engine';
import { StoreService } from '../store/store.service';
import { EngineConfigService } from '../config/engine-config.service';
import { Metrics } from '../common/observability';
import type { AuthUser } from '../common/auth.guards';

const id = (p: string) => `${p}_${randomUUID().slice(0, 12)}`;

@Injectable()
export class LearnService {
  private readonly log = new Logger('Learn');

  constructor(
    private readonly store: StoreService,
    private readonly cfg: EngineConfigService,
  ) {}

  /* ----------------------------------------------------------- journeys */

  async build(input: BuildJourneyInput, user: AuthUser) {
    const config = await this.cfg.get();
    if (!input.text?.trim() && !input.topic?.trim()) {
      throw new BadRequestException('Give me a topic, some text, or a file to work from.');
    }

    // Close the adaptation loop: what the engine has already inferred about this
    // learner is fed back into the generation prompt, so the next mission is
    // genuinely harder or gentler rather than just labelled that way.
    const priorRows = await this.store.listEvents({ learnerId: user.sub });
    const priorMastery = inferMastery(this.toEngineEvents(priorRows), config);
    const weakest = priorMastery.signals
      .filter((s) => s.evidence > 0)
      .sort((a, b) => a.value - b.value)[0];
    const prior = {
      mastery: priorMastery.overall,
      hasEvidence: priorMastery.hasEvidence,
      weakestSignal: weakest?.label,
    };

    const started = Date.now();
    let built: { journey: Journey; attempts: any[] };
    try {
      built = await buildJourney(input, config, (m) => this.log.log(m), prior);
    } catch (e) {
      if (e instanceof InsufficientSourceError) throw new BadRequestException(e.message);
      throw e;
    }
    const { journey, attempts } = built;
    for (const a of attempts) Metrics.aiCall(a.provider, a.ok, a.latencyMs);

    await this.store.saveJourney({
      id: journey.id,
      ownerId: user.sub,
      title: journey.title.en.slice(0, 160),
      sourceName: journey.sourceName,
      topic: journey.topic.slice(0, 160),
      provider: journey.provider,
      model: journey.model,
      latencyMs: journey.latencyMs,
      grounded: journey.grounded,
      degraded: journey.degraded,
      data: journey,
      createdAt: new Date(),
    } as any);

    await this.record(user, {
      journeyId: journey.id,
      type: 'journey_built',
      payload: {
        provider: journey.provider,
        model: journey.model,
        degraded: journey.degraded,
        grounded: journey.grounded,
        learnerType: input.learnerType,
        language: input.language,
        constraint: input.constraint,
        conceptCount: journey.conceptCount,
        priorMastery: prior.hasEvidence ? prior.mastery : null,
        attempts,
      },
      latencyMs: Date.now() - started,
    });

    return { journey, attempts, totalMs: Date.now() - started, adaptedFrom: prior };
  }

  async sample(user: AuthUser) {
    const config = await this.cfg.get();
    const journey = sampleJourney(config);
    const existing = await this.store.findJourney(journey.id);
    if (!existing) {
      await this.store.saveJourney({
        id: journey.id,
        ownerId: 'system',
        title: journey.title.en,
        sourceName: journey.sourceName,
        topic: journey.topic,
        provider: journey.provider,
        model: journey.model,
        latencyMs: 0,
        grounded: true,
        degraded: false,
        data: journey,
        createdAt: new Date(),
      } as any);
    }
    return journey;
  }

  async get(journeyId: string): Promise<Journey> {
    if (journeyId === 'sample_cardiac') return sampleJourney(await this.cfg.get());
    const row = await this.store.findJourney(journeyId);
    if (!row) throw new NotFoundException('That mission no longer exists. Build a new one.');
    return row.data as Journey;
  }

  /* -------------------------------------------------------------- events */

  async record(
    user: AuthUser,
    e: { journeyId: string; type: string; stepId?: string; payload?: any; latencyMs?: number; sessionId?: string },
  ) {
    return this.store.saveEvent({
      id: id('e'),
      learnerId: user.sub,
      journeyId: e.journeyId ?? '',
      sessionId: e.sessionId ?? '',
      type: e.type,
      stepId: e.stepId ?? '',
      payload: e.payload ?? {},
      latencyMs: e.latencyMs ?? 0,
      createdAt: new Date(),
    } as any);
  }

  private toEngineEvents(rows: any[]): LearningEvent[] {
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      learnerId: r.learnerId,
      journeyId: r.journeyId,
      type: r.type,
      stepId: r.stepId,
      payload: r.payload ?? {},
      latencyMs: r.latencyMs,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /* --------------------------------------------------------------- state */

  async state(user: AuthUser, journeyId?: string) {
    const config = await this.cfg.get();
    const rows = await this.store.listEvents({ learnerId: user.sub, journeyId });
    const events = this.toEngineEvents(rows);
    const mastery = inferMastery(events, config);
    const dbUser = await this.store.findUser(user.sub);
    const progress = progressFromXp(dbUser?.xp ?? 0, config);
    progress.badges = dbUser?.badges ?? [];
    progress.streakDays = dbUser?.streakDays ?? 0;

    const journey = journeyId ? await this.get(journeyId).catch(() => null) : null;
    const adaptation = adapt({
      mastery,
      events,
      currentDifficulty: journey?.difficulty ?? config.defaultDifficulty,
      cfg: config,
    });

    const completedSteps = [
      ...new Set(rows.filter((r) => r.type === 'step_completed').map((r) => r.stepId)),
    ];

    return { mastery, adaptation, progress, completedSteps, config: this.publicConfig(config) };
  }

  private publicConfig(c: any) {
    return {
      xpPerStep: c.xpPerStep,
      xpPerLevel: c.xpPerLevel,
      hintPenaltyXp: c.hintPenaltyXp,
      masteryUnlockThreshold: c.masteryUnlockThreshold,
      badges: c.badges,
      learnerTypes: c.learnerTypes,
      constraints: c.constraints,
      defaultLanguage: c.defaultLanguage,
      defaultLearnerType: c.defaultLearnerType,
    };
  }

  /* ---------------------------------------------------------- step 1 sim */

  /**
   * Grades whichever mechanic this step runs. Grading is always server-side:
   * the correct order, the correct states and the best option never reach the
   * browser before the learner has committed, so the board cannot be read out
   * of the network tab and brute-forced.
   */
  async runSim(
    user: AuthUser,
    journeyId: string,
    body: {
      stepId: string;
      states?: Record<string, number>;
      order?: string[];
      optionId?: string;
      nodeId?: string;
      attempt: number;
      hintsUsed: number;
      seconds: number;
      statedConfidence?: number;
      sessionId?: string;
    },
  ) {
    const journey = await this.get(journeyId);
    const step = journey.steps.find((s) => s.id === body.stepId) ?? journey.steps[0];
    const mechanic = step.mechanic ?? 'sort';

    let correctRatio = 0;
    let passed = false;
    let message = '';
    let detail: Record<string, unknown> = {};

    if (mechanic === 'order' && step.order) {
      const expected = step.order.correctOrder;
      const got = Array.isArray(body.order) ? body.order : [];
      // Partial credit for adjacency, not just exact position — getting the
      // shape of a process right matters even if one pair is transposed.
      const positional = expected.filter((id, i) => got[i] === id).length / Math.max(1, expected.length);
      const pairs = expected.slice(0, -1).filter((id, i) => {
        const a = got.indexOf(id);
        const b = got.indexOf(expected[i + 1]);
        return a !== -1 && b !== -1 && a < b;
      }).length;
      const adjacency = pairs / Math.max(1, expected.length - 1);
      correctRatio = Number(((positional + adjacency) / 2).toFixed(3));
      passed = got.length === expected.length && got.every((id, i) => id === expected[i]);
      message = passed ? step.order.successMessage : step.order.consequenceIfWrong;
      detail = { misplaced: expected.filter((id, i) => got[i] !== id).length };
    } else if (mechanic === 'decide' && step.decide) {
      const chosen = step.decide.options.find((o) => o.id === body.optionId);
      if (!chosen) throw new BadRequestException('That is not one of the available actions.');
      correctRatio = chosen.quality === 'best' ? 1 : chosen.quality === 'defensible' ? 0.6 : 0.15;
      passed = chosen.quality === 'best';
      message = chosen.consequence;
      detail = {
        quality: chosen.quality,
        deltas: chosen.deltas,
        successMessage: passed ? step.decide.successMessage : '',
      };
    } else if (mechanic === 'trace' && step.trace) {
      passed = body.nodeId === step.trace.correctNodeId;
      correctRatio = passed ? 1 : 0;
      message = passed ? step.trace.successMessage : step.trace.failureMessage;
      detail = {
        correctNodeId: passed ? step.trace.correctNodeId : undefined,
        path: step.trace.nodes.map((n) => n.id),
        riseAt: step.trace.meterRisesAtNodeId,
      };
    } else {
      const sim = step.sim;
      if (!sim) throw new BadRequestException('That step has no interaction.');
      const results = sim.elements.map((el) => ({
        id: el.id,
        chosen: Number(body.states?.[el.id] ?? 0),
        correct: el.correct,
        ok: Number(body.states?.[el.id] ?? 0) === el.correct,
      }));
      correctRatio = results.filter((r) => r.ok).length / Math.max(1, results.length);
      passed = correctRatio === 1;
      message = passed ? sim.successMessage : sim.failureMessage;
      detail = {
        // On failure we say how many are wrong but never which — otherwise the
        // learner brute-forces the board instead of reasoning about it.
        results: passed ? results : results.map((r) => ({ id: r.id, chosen: r.chosen })),
        wrongCount: results.filter((r) => !r.ok).length,
      };
    }

    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'sim_run',
      sessionId: body.sessionId,
      payload: {
        mechanic,
        correctRatio,
        passed,
        attempt: Math.max(1, Number(body.attempt) || 1),
        hintsUsed: Number(body.hintsUsed) || 0,
        seconds: Number(body.seconds) || 0,
        statedConfidence: body.statedConfidence,
        language: journey.language,
      },
    });

    return { passed, correctRatio, mechanic, message, ...detail };
  }

  /* ------------------------------------------------------- step 2 inquire */

  async ask(user: AuthUser, journeyId: string, body: { stepId: string; question: string; language: Language; history?: any[]; sessionId?: string }) {
    const config = await this.cfg.get();
    const journey = await this.get(journeyId);
    const step = journey.steps.find((s) => s.id === body.stepId) ?? journey.steps[1];

    const res = await answerQuestion({
      journey,
      step,
      question: body.question,
      language: body.language ?? journey.language,
      history: Array.isArray(body.history) ? body.history.slice(-6) : [],
      cfg: config,
      log: (m) => this.log.log(m),
    });
    Metrics.aiCall(res.provider, !res.degraded, res.latencyMs);

    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'question_asked',
      sessionId: body.sessionId,
      latencyMs: res.latencyMs,
      payload: {
        questionLength: body.question?.length ?? 0,
        factsSurfaced: res.factsSurfaced,
        grounded: res.grounded,
        provider: res.provider,
        language: body.language ?? journey.language,
      },
    });

    const totalFacts = step.inquire?.mustSurfaceFacts.length ?? 0;
    return { ...res, totalFacts };
  }

  /* ------------------------------------------------------- step 3 explain */

  async explain(user: AuthUser, journeyId: string, body: { stepId: string; answer: string; language: Language; seconds?: number; sessionId?: string }) {
    const config = await this.cfg.get();
    const journey = await this.get(journeyId);
    const step = journey.steps.find((s) => s.id === body.stepId) ?? journey.steps[2];
    if (!step.explain) throw new BadRequestException('That step is not an explain-back step.');

    const res = await gradeExplanation({
      step,
      answer: body.answer,
      language: body.language ?? journey.language,
      cfg: config,
      log: (m) => this.log.log(m),
    });
    Metrics.aiCall(res.provider, !res.degraded, res.latencyMs);

    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'explain_submitted',
      sessionId: body.sessionId,
      latencyMs: res.latencyMs,
      payload: {
        score: res.overall,
        confidenceLanguage: res.confidenceLanguage,
        words: String(body.answer ?? '').split(/\s+/).filter(Boolean).length,
        seconds: Number(body.seconds) || 0,
        provider: res.provider,
        language: body.language ?? journey.language,
      },
    });

    return res;
  }

  /** The learner reports catching their own mistake — a first-class mastery signal. */
  async selfCorrect(user: AuthUser, journeyId: string, stepId: string, note: string) {
    await this.record(user, {
      journeyId,
      stepId,
      type: 'self_corrected',
      payload: { note: String(note ?? '').slice(0, 300) },
    });
    return { ok: true };
  }

  /* ------------------------------------------------- completion + rewards */

  async completeStep(
    user: AuthUser,
    journeyId: string,
    body: { stepId: string; hintsUsed?: number; seconds?: number; score?: number; sessionId?: string },
  ) {
    const config = await this.cfg.get();
    const journey = await this.get(journeyId);
    const stepIndex = Math.max(0, journey.steps.findIndex((s) => s.id === body.stepId));

    const prior = await this.store.listEvents({ learnerId: user.sub, journeyId });
    const already = prior.some((e) => e.type === 'step_completed' && e.stepId === body.stepId);

    const lastEvent = prior[prior.length - 1];
    const gapMinutes = lastEvent
      ? Math.round((Date.now() - new Date(lastEvent.createdAt).getTime()) / 60000)
      : 0;

    await this.record(user, {
      journeyId,
      stepId: body.stepId,
      type: 'step_completed',
      sessionId: body.sessionId,
      payload: {
        stepIndex,
        hintsUsed: Number(body.hintsUsed) || 0,
        seconds: Number(body.seconds) || 0,
        score: typeof body.score === 'number' ? body.score : undefined,
        gapMinutesSincePrevious: gapMinutes,
        replay: already,
        language: journey.language,
      },
    });

    const rows = await this.store.listEvents({ learnerId: user.sub });
    const events = this.toEngineEvents(rows);
    const mastery = inferMastery(this.toEngineEvents(rows.filter((r) => r.journeyId === journeyId)), config);

    const dbUser = await this.store.findUser(user.sub);
    const currentXp = dbUser?.xp ?? 0;

    // Replaying a completed step gives feedback but never XP again.
    const outcome = already
      ? {
          xpAwarded: 0,
          totalXp: currentXp,
          progress: { ...progressFromXp(currentXp, config), badges: dbUser?.badges ?? [] },
          leveledUp: false,
          newBadges: [],
        }
      : award({
          currentXp,
          earnedBadges: dbUser?.badges ?? [],
          stepIndex,
          hintsUsedInStep: Number(body.hintsUsed) || 0,
          events,
          mastery,
          cfg: config,
        });

    if (!already) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const streak =
        dbUser?.lastActiveDay === today
          ? dbUser.streakDays
          : dbUser?.lastActiveDay === yesterday
            ? (dbUser.streakDays ?? 0) + 1
            : 1;

      await this.store.saveUser({
        id: user.sub,
        email: user.email,
        xp: outcome.totalXp,
        badges: outcome.progress.badges,
        streakDays: streak,
        lastActiveDay: today,
      });
      outcome.progress.streakDays = streak;

      for (const b of outcome.newBadges) {
        await this.record(user, { journeyId, stepId: body.stepId, type: 'badge_unlocked', payload: { badgeId: b.id } });
      }
      if (outcome.leveledUp) {
        await this.record(user, { journeyId, stepId: body.stepId, type: 'level_up', payload: { level: outcome.progress.level } });
      }
    }

    const adaptation = adapt({
      mastery,
      events,
      currentDifficulty: journey.difficulty,
      cfg: config,
    });

    const nextStep = journey.steps[stepIndex + 1] ?? null;
    const unlocked = mastery.overall >= config.masteryUnlockThreshold;

    return {
      ...outcome,
      mastery,
      adaptation,
      alreadyCompleted: already,
      nextStepId: nextStep?.id ?? null,
      missionComplete: !nextStep,
      nextMissionUnlocked: unlocked,
      unlockThreshold: config.masteryUnlockThreshold,
    };
  }

  async hint(user: AuthUser, journeyId: string, stepId: string, elementId: string) {
    const journey = await this.get(journeyId);
    const step = journey.steps.find((s) => s.id === stepId) ?? journey.steps[0];
    const el = step.sim?.elements.find((e) => e.id === elementId);
    const config = await this.cfg.get();

    await this.record(user, {
      journeyId,
      stepId,
      type: 'hint_used',
      payload: { elementId, language: journey.language },
    });

    return {
      hint: el?.hint ?? 'Go back to what the source said about this part.',
      xpCost: config.hintPenaltyXp,
    };
  }

  async generateMermaidDiagram(journeyId: string) {
    const journey = await this.get(journeyId);
    const config = await this.cfg.get();
    const prompt = `Return ONLY valid Mermaid code (graph TD or flowchart) for a labeled educational diagram of "${journey.topic}". No markdown. No explanation. Just the Mermaid code.`;
    const res = await completeWithFallback(
      { system: prompt, user: 'Draw it.', json: false, maxTokens: 1024 },
      config.providerOrder,
      15000,
      (m) => this.log.log(m)
    );
    const code = res?.text?.replace(/```mermaid\n|```/g, '').trim() ?? '';
    return { mermaidCode: code };
  }

  async generateSvgDiagram(journeyId: string) {
    const journey = await this.get(journeyId);
    const config = await this.cfg.get();
    const prompt = `You are an expert infographic designer. Create a detailed, visually rich educational infographic as valid SVG for the topic: "${journey.topic}".

STRICT RULES — follow every one:
1. Return ONLY raw SVG code. No markdown, no backticks, no explanation, no XML declaration.
2. Start directly with <svg and end with </svg>.
3. Use viewBox="0 0 900 600" width="900" height="600".
4. Dark background: fill the entire canvas with a rect fill="#0f172a" (dark navy).

DESIGN REQUIREMENTS:
- Title bar at top: large bold white title text for the topic.
- Divide into 4–6 clearly labeled sections using colored rounded rectangles as section cards.
- Each section card: rounded rect with semi-transparent colored fill (use variety: blue #1e40af, teal #0f766e, purple #6d28d9, amber #92400e, rose #9f1239 — all at 30–40% opacity), white border (stroke="#ffffff" stroke-opacity="0.15"), padding inside.
- Inside each card: bold white section header text, then 2–4 bullet-point style facts as smaller white/light-gray text (use ● or → as bullet prefix).
- Use colored accent circles or icons (simple geometric shapes: circles, triangles, arrows) as visual markers.
- Add directional arrows (→ or curved SVG paths) between sections to show flow or sequence if the topic is a process.
- Add a small legend or key section at the bottom if relevant.
- Use font-family="system-ui, sans-serif" throughout.
- All text must be clearly readable against the dark background.
- Make it visually professional, like a slide you would show in a class or training session.
- Minimum 400 words worth of labeled content distributed across the infographic.

Topic: "${journey.topic}"

Return the complete SVG infographic now.`;

    const res = await completeWithFallback(
      { system: prompt, user: `Generate the infographic SVG for: ${journey.topic}`, json: false, maxTokens: 4096 },
      config.providerOrder,
      25000,
      (m) => this.log.log(m)
    );
    const raw = res?.text ?? '';
    // Strip any markdown fences
    const svg = raw
      .replace(/```(?:xml|svg|html)?\n?/gi, '')
      .replace(/```/g, '')
      .trim();
    return { svg };
  }
}
