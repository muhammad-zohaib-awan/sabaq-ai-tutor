import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
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
  publicJourney,
  reissueJourney,
  hintFor,
  revealFor,
  translateJourney,
  outlineFromLesson,
  outlineWithModel,
  renderInfographic,
  type BuildJourneyInput,
  type Journey,
  type Language,
  type LearningEvent,
} from '@sabaq/engine';
import { StoreService } from '../store/store.service';
import { EngineConfigService } from '../config/engine-config.service';
import { Metrics } from '../common/observability';
import type { AuthUser } from '../common/auth.guards';
import { sanitizeSvg } from './svg-sanitize';

const id = (p: string) => `${p}_${randomUUID().slice(0, 12)}`;

@Injectable()
export class LearnService {
  private readonly log = new Logger('Learn');

  constructor(
    private readonly store: StoreService,
    private readonly cfg: EngineConfigService,
    private readonly cache: CacheService,
  ) {}

  /** Bump when the prompt or journey shape changes so stale cached missions are not served. */
  private static readonly JOURNEY_SCHEMA = 'v3';
  private readonly journeyTtl = Number(process.env.JOURNEY_CACHE_TTL_SEC ?? 7 * 86400);

  /** Writes that the response does not depend on. Logged, never thrown. */
  private later(p: Promise<unknown>, what: string) {
    p.catch((e) => this.log.warn(`${what} failed: ${String(e?.message ?? e).slice(0, 160)}`));
  }

  /* ------------------------------------------------------ journey access */

  /**
   * Loads a journey the caller is allowed to use. Journeys are immutable once
   * built, so they are cached — every sim / ask / hint call used to be a
   * Postgres round trip for the same row.
   *
   * Ownership is enforced here: previously any signed-in user could read or
   * play any other learner's journey (and its answers) by guessing the id.
   */
  private async load(journeyId: string, user: AuthUser): Promise<Journey> {
    const id = String(journeyId ?? '').slice(0, 64);
    if (id === 'sample_cardiac') return sampleJourney(await this.cfg.get());
    const key = `j:${id}`;
    let row = await this.cache.get<{ ownerId: string; data: Journey }>(key);
    if (!row) {
      const db = await this.store.findJourney(id);
      if (db) {
        row = { ownerId: db.ownerId, data: db.data as Journey };
        await this.cache.set(key, row, 6 * 3600);
      }
    }
    const allowed = row && (row.ownerId === user.sub || row.ownerId === 'system' || user.role === 'admin');
    // Same message for "missing" and "not yours", so ids cannot be probed.
    if (!row || !allowed) throw new NotFoundException('That mission no longer exists. Build a new one.');
    return row.data;
  }

  /** The journey in the learner's current language, if it has been translated. */
  private async loadFor(journeyId: string, user: AuthUser, lang?: string): Promise<Journey> {
    const base = await this.load(journeyId, user);
    if (!lang || lang === base.language || !['en', 'ur', 'mix'].includes(lang)) return base;
    return (await this.cache.get<Journey>(`jt:${base.id}:${lang}`)) ?? base;
  }

  /**
   * Translate the mission into another language on demand. Same ids and
   * answers, new words. Cached, so each language is generated once.
   */
  async translate(user: AuthUser, journeyId: string, lang: Language) {
    const base = await this.load(journeyId, user);
    if (lang === base.language) return { journey: publicJourney(base), cached: true };
    const key = `jt:${base.id}:${lang}`;
    const hit = await this.cache.get<Journey>(key);
    if (hit) return { journey: publicJourney(hit), cached: true };

    const config = await this.cfg.get();
    const started = Date.now();
    const { value, cached } = await this.cache.wrap(
      // Keyed on content too, so a re-issued cached mission reuses the translation.
      'tr:' + CacheService.key(base.title.en, base.steps.map((st) => st.narrative.en), lang),
      30 * 86400,
      () => translateJourney(base, lang, config, (m) => this.log.log(m)),
      { accept: (r) => r.complete },
    );
    // Re-attach this journey's own id (the content cache may hold a sibling's).
    const translated: Journey = { ...value.journey, id: base.id };
    // A partial translation is still shown, but only kept briefly so the
    // missing parts are retried on the next toggle.
    await this.cache.set(key, translated, value.complete ? 7 * 86400 : 600);
    this.log.log(`[translate] ${base.id} -> ${lang} in ${Date.now() - started} ms${cached ? ' (cache)' : ''}`);
    return { journey: publicJourney(translated), cached, complete: value.complete };
  }

  private stepOf(journey: Journey, stepId: string, fallbackIndex: number) {
    const step = journey.steps.find((s) => s.id === stepId);
    if (step) return step;
    if (stepId) throw new BadRequestException('That step is not part of this mission.');
    return journey.steps[fallbackIndex];
  }

  /* ----------------------------------------------------------- journeys */

  async build(input: BuildJourneyInput, user: AuthUser) {
    if (!input.text?.trim() && !input.topic?.trim()) {
      throw new BadRequestException('Give me a topic, some text, or a file to work from.');
    }
    const started = Date.now();

    // Independent reads, in parallel.
    const [config, priorRows] = await Promise.all([
      this.cfg.get(),
      this.store.listEvents({ learnerId: user.sub }),
    ]);

    // Close the adaptation loop: what the engine has already inferred about this
    // learner is fed back into the generation prompt.
    const priorMastery = inferMastery(this.toEngineEvents(priorRows), config);
    const weakest = priorMastery.signals
      .filter((s) => s.evidence > 0)
      .sort((a, b) => a.value - b.value)[0];
    const prior = {
      mastery: priorMastery.overall,
      hasEvidence: priorMastery.hasEvidence,
      weakestSignal: weakest?.label,
    };

    // Same topic + same learner profile + same mastery band = same mission.
    // Cached, a repeat build is instant instead of a 10-20 s model call.
    const band = !prior.hasEvidence ? 'none' : prior.mastery >= 0.7 ? 'high' : prior.mastery <= 0.45 ? 'low' : 'mid';
    const cacheKey =
      'jb:' +
      CacheService.key(
        LearnService.JOURNEY_SCHEMA,
        (input.topic ?? '').trim().toLowerCase(),
        CacheService.key(input.text ?? ''),
        input.sourceName ?? '',
        input.learnerType.trim().toLowerCase(),
        input.language,
        input.constraint,
        input.constraintNote ?? '',
        input.difficulty ?? config.defaultDifficulty,
        input.tone ?? config.defaultTone,
        config.gamificationEnabled,
        band,
        band === 'none' ? '' : prior.weakestSignal ?? '',
      );

    let built: { journey: Journey; attempts: any[] };
    let cached = false;
    try {
      const res = await this.cache.wrap(
        cacheKey,
        this.journeyTtl,
        () => buildJourney(input, config, (m) => this.log.log(m), prior),
        // Never cache a degraded/offline build: next time the model may be back.
        { accept: (v) => !v.journey.degraded },
      );
      built = res.value;
      cached = res.cached;
    } catch (e) {
      if (e instanceof InsufficientSourceError) throw new BadRequestException(e.message);
      throw e;
    }

    const journey = cached ? reissueJourney(built.journey) : built.journey;
    const attempts = cached ? [] : built.attempts;
    for (const a of attempts) Metrics.aiCall(a.provider, a.ok, a.latencyMs);

    await Promise.all([
      this.cache.set(`j:${journey.id}`, { ownerId: user.sub, data: journey }, 6 * 3600),
      this.store.saveJourney({
        id: journey.id,
        ownerId: user.sub,
        title: journey.title.en.slice(0, 160),
        sourceName: journey.sourceName,
        topic: journey.topic.slice(0, 160),
        provider: journey.provider,
        model: journey.model,
        latencyMs: cached ? 0 : journey.latencyMs,
        grounded: journey.grounded,
        degraded: journey.degraded,
        data: journey,
        createdAt: new Date(),
      } as any),
    ]);

    this.later(
      this.record(user, {
        journeyId: journey.id,
        type: 'journey_built',
        payload: {
          provider: journey.provider,
          model: journey.model,
          degraded: journey.degraded,
          grounded: journey.grounded,
          cached,
          learnerType: input.learnerType,
          language: input.language,
          constraint: input.constraintNote ? `custom: ${input.constraintNote}` : input.constraint,
          conceptCount: journey.conceptCount,
          priorMastery: prior.hasEvidence ? prior.mastery : null,
          attempts,
        },
        latencyMs: Date.now() - started,
      }),
      'journey_built event',
    );

    // Pre-translate into the other languages in the background while the
    // learner reads the lesson, so the language toggle is instant. A toggle
    // that arrives mid-way joins the same in-flight job (singleflight).
    // PREFETCH_LANGS= (empty) turns this off to save free-tier quota.
    if (!journey.degraded) {
      const langs = (process.env.PREFETCH_LANGS ?? 'ur,mix,en')
        .split(',')
        .map((l) => l.trim())
        .filter((l): l is Language => ['en', 'ur', 'mix'].includes(l) && l !== journey.language);
      for (const l of langs) this.later(this.translate(user, journey.id, l), `prefetch ${l}`);
    }

    return {
      journey: { ...publicJourney(journey), latencyMs: cached ? 0 : journey.latencyMs },
      attempts,
      cached,
      totalMs: Date.now() - started,
      adaptedFrom: prior,
    };
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
    return publicJourney(journey);
  }

  /** The learner-safe view of a journey: no answer key. */
  async get(journeyId: string, user: AuthUser): Promise<Journey> {
    return publicJourney(await this.load(journeyId, user));
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
    const [config, rows, dbUser, journey] = await Promise.all([
      this.cfg.get(),
      this.store.listEvents({ learnerId: user.sub, journeyId }),
      this.store.findUser(user.sub),
      journeyId ? this.load(journeyId, user).catch(() => null) : Promise.resolve(null),
    ]);
    const events = this.toEngineEvents(rows);
    const mastery = inferMastery(events, config);
    const progress = progressFromXp(dbUser?.xp ?? 0, config);
    progress.badges = dbUser?.badges ?? [];
    progress.streakDays = dbUser?.streakDays ?? 0;
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
   * Grades whichever mechanic this step runs. Grading is server-side and the
   * answer key is stripped from the journey the browser receives, so the board
   * cannot be read out of the network tab.
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
      language?: string;
    },
  ) {
    const journey = await this.loadFor(journeyId, user, body.language);
    const step = this.stepOf(journey, body.stepId, 0);
    if (step.kind !== 'simulate') throw new BadRequestException('That step has no simulation.');
    const mechanic = step.mechanic ?? 'sort';

    let correctRatio = 0;
    let passed = false;
    let message = '';
    let detail: Record<string, unknown> = {};

    if (mechanic === 'order' && step.order) {
      const expected = step.order.correctOrder;
      const got = Array.isArray(body.order) ? body.order : [];
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
      // The flow animation and node details ARE the answer, so they are only
      // sent once the learner has got it.
      detail = passed
        ? {
            correctNodeId: step.trace.correctNodeId,
            riseAt: step.trace.meterRisesAtNodeId,
            details: Object.fromEntries(step.trace.nodes.map((n) => [n.id, n.detail])),
          }
        : {};
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
        // How many are wrong, never which — otherwise the board gets brute-forced.
        results: passed ? results : results.map((r) => ({ id: r.id, chosen: r.chosen })),
        wrongCount: results.filter((r) => !r.ok).length,
      };
    }

    // Awaited: /complete checks for this event immediately afterwards.
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
    const [config, journey] = await Promise.all([this.cfg.get(), this.loadFor(journeyId, user, body.language)]);
    const step = this.stepOf(journey, body.stepId, 1);
    if (step.kind !== 'inquire') throw new BadRequestException('That step is not a conversation step.');

    const history = (Array.isArray(body.history) ? body.history : [])
      .slice(-6)
      .map((h: any) => ({
        role: h?.role === 'learner' ? ('learner' as const) : ('persona' as const),
        text: String(h?.text ?? '').slice(0, 800),
      }));
    const language = body.language ?? journey.language;

    // The same opening question on the same mission gets the same answer —
    // suggested-question chips are clicked by almost every learner.
    const key =
      'ask:' +
      CacheService.key(journeyId, step.id, language, body.question.trim().toLowerCase(), history.slice(-2));
    const { value: res, cached } = await this.cache.wrap(
      key,
      86400,
      () =>
        answerQuestion({
          journey,
          step,
          question: body.question,
          language,
          history,
          cfg: config,
          log: (m) => this.log.log(m),
        }),
      { accept: (r) => !r.degraded },
    );
    if (!cached) Metrics.aiCall(res.provider, !res.degraded, res.latencyMs);

    // Awaited so /complete can verify the learner actually engaged.
    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'question_asked',
      sessionId: body.sessionId,
      latencyMs: cached ? 0 : res.latencyMs,
      payload: {
        questionLength: body.question?.length ?? 0,
        factsSurfaced: res.factsSurfaced,
        grounded: res.grounded,
        basis: res.basis,
        provider: res.provider,
        cached,
        language,
      },
    });

    const totalFacts = step.inquire?.mustSurfaceFacts.length ?? 0;
    return { ...res, cached, totalFacts };
  }

  /* ------------------------------------------------------- step 3 explain */

  async explain(user: AuthUser, journeyId: string, body: { stepId: string; answer: string; language: Language; seconds?: number; sessionId?: string }) {
    const [config, journey] = await Promise.all([this.cfg.get(), this.loadFor(journeyId, user, body.language)]);
    const step = this.stepOf(journey, body.stepId, 2);
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

    // The model answer is only released once the learner has made their own attempt.
    return { ...res, modelAnswer: step.explain.modelAnswer };
  }

  /**
   * The learner reports catching their own mistake. Only counted when there is
   * a failed run on this step to have caught, and only once per step —
   * otherwise the button is a free mastery pump.
   */
  async selfCorrect(user: AuthUser, journeyId: string, stepId: string, note: string) {
    const journey = await this.load(journeyId, user);
    const step = this.stepOf(journey, stepId, 0);
    const rows = await this.store.listEvents({ learnerId: user.sub, journeyId });
    const onStep = rows.filter((r) => r.stepId === step.id);
    const hadMiss = onStep.some((r) => r.type === 'sim_run' && !(r.payload as any)?.passed && !(r.payload as any)?.revealed);
    const already = onStep.some((r) => r.type === 'self_corrected');
    if (!hadMiss || already) return { ok: true, counted: false };
    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'self_corrected',
      payload: { note: String(note ?? '').slice(0, 300) },
    });
    return { ok: true, counted: true };
  }

  /* ------------------------------------------------- completion + rewards */

  /**
   * Completion is verified against what the server itself recorded. The old
   * endpoint trusted the client's `score` and never checked the step was
   * actually done — one POST per step was free XP and a perfect mastery score.
   */
  async completeStep(
    user: AuthUser,
    journeyId: string,
    body: { stepId: string; hintsUsed?: number; seconds?: number; score?: number; sessionId?: string },
  ) {
    const [config, journey, prior, allRows, dbUser] = await Promise.all([
      this.cfg.get(),
      this.load(journeyId, user),
      this.store.listEvents({ learnerId: user.sub, journeyId }),
      this.store.listEvents({ learnerId: user.sub }),
      this.store.findUser(user.sub),
    ]);
    const step = this.stepOf(journey, body.stepId, 0);
    const stepIndex = Math.max(0, journey.steps.findIndex((s) => s.id === step.id));
    const onStep = prior.filter((e) => e.stepId === step.id);

    let score: number | undefined;
    if (step.kind === 'simulate') {
      const runs = onStep.filter((e) => e.type === 'sim_run');
      const passedRun = [...runs].reverse().find((e) => (e.payload as any)?.passed);
      const revealed = runs.some((e) => (e.payload as any)?.revealed);
      if (!passedRun && !revealed) throw new BadRequestException('Run the simulation first.');
      score = passedRun ? Number((passedRun.payload as any)?.correctRatio ?? 0) : 0;
    } else if (step.kind === 'inquire') {
      if (!onStep.some((e) => e.type === 'question_asked')) {
        throw new BadRequestException('Ask the persona at least one question first.');
      }
    } else {
      const graded = onStep.filter((e) => e.type === 'explain_submitted');
      if (!graded.length) throw new BadRequestException('Submit your explanation first.');
      score = Math.max(...graded.map((e) => Number((e.payload as any)?.score ?? 0)));
    }
    const hintsUsed = onStep.filter((e) => e.type === 'hint_used').length;

    const already = onStep.some((e) => e.type === 'step_completed');
    const lastEvent = prior[prior.length - 1];
    const gapMinutes = lastEvent
      ? Math.round((Date.now() - new Date(lastEvent.createdAt).getTime()) / 60000)
      : 0;

    const completedRow = await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'step_completed',
      sessionId: body.sessionId,
      payload: {
        stepIndex,
        hintsUsed,
        seconds: Number(body.seconds) || 0,
        score,
        gapMinutesSincePrevious: gapMinutes,
        replay: already,
        language: journey.language,
      },
    });

    const journeyRows = [...prior, completedRow];
    const events = this.toEngineEvents([...allRows, completedRow]);
    const mastery = inferMastery(this.toEngineEvents(journeyRows), config);
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
          hintsUsedInStep: hintsUsed,
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

      const side: Promise<unknown>[] = outcome.newBadges.map((b: any) =>
        this.record(user, { journeyId, stepId: step.id, type: 'badge_unlocked', payload: { badgeId: b.id } }),
      );
      if (outcome.leveledUp) {
        side.push(this.record(user, { journeyId, stepId: step.id, type: 'level_up', payload: { level: outcome.progress.level } }));
      }
      this.later(Promise.all(side), 'badge/level events');
    }

    const adaptation = adapt({ mastery, events, currentDifficulty: journey.difficulty, cfg: config });
    const nextStep = journey.steps[stepIndex + 1] ?? null;
    const unlocked = mastery.overall >= config.masteryUnlockThreshold;

    return {
      ...outcome,
      mastery,
      adaptation,
      alreadyCompleted: already,
      stepLabel: step.label,
      stepIndex,
      nextStepId: nextStep?.id ?? null,
      missionComplete: !nextStep,
      nextMissionUnlocked: unlocked,
      unlockThreshold: config.masteryUnlockThreshold,
    };
  }

  /**
   * A hint for ANY mechanic (the old one only worked for sort boards), based on
   * the learner's current board. Each hint is recorded and costs XP.
   */
  async hint(
    user: AuthUser,
    journeyId: string,
    body: { stepId: string; states?: Record<string, number>; order?: string[]; optionId?: string; nodeId?: string; language?: string },
  ) {
    const [journey, config, rows] = await Promise.all([
      this.loadFor(journeyId, user, body.language),
      this.cfg.get(),
      this.store.listEvents({ learnerId: user.sub, journeyId }),
    ]);
    const step = this.stepOf(journey, body.stepId, 0);
    if (step.kind !== 'simulate') throw new BadRequestException('Hints are for the simulation step.');
    const level = rows.filter((r) => r.type === 'hint_used' && r.stepId === step.id).length;
    const h = hintFor(step, { ...body, level });

    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'hint_used',
      payload: { mechanic: step.mechanic ?? 'sort', level, language: journey.language },
    });

    return { hint: h.hint, targetId: h.targetId, xpCost: config.hintPenaltyXp, hintsUsed: level + 1 };
  }

  /**
   * "Show correct steps". Allowed — a stuck learner learns nothing staring at a
   * board — but recorded, so the step scores zero on the decision signal.
   */
  async reveal(user: AuthUser, journeyId: string, stepId: string, lang?: string) {
    const journey = await this.loadFor(journeyId, user, lang);
    const step = this.stepOf(journey, stepId, 0);
    if (step.kind !== 'simulate') throw new BadRequestException('Only the simulation step has a worked solution.');

    await this.record(user, {
      journeyId,
      stepId: step.id,
      type: 'sim_run',
      payload: { mechanic: step.mechanic ?? 'sort', revealed: true, correctRatio: 0, passed: false, attempt: 99 },
    });

    return revealFor(step);
  }

  /* ------------------------------------------------------------ diagrams */

  /**
   * Diagrams depend only on the topic and language, so they are cached by that —
   * the second press of "Show a diagram", or a second learner on the same topic,
   * gets the stored SVG instantly instead of another 15-25 s model call.
   */
  async generateMermaidDiagram(user: AuthUser, journeyId: string, force = false) {
    const journey = await this.load(journeyId, user);
    const config = await this.cfg.get();
    const key = 'dgm:' + CacheService.key(journey.topic.toLowerCase(), journey.language);
    const { value, cached } = await this.cache.wrap(
      key,
      30 * 86400,
      async () => {
        const res = await completeWithFallback(
          {
            system: `Return ONLY valid Mermaid code (graph TD or flowchart) for a labeled educational diagram of the topic the user gives. No markdown. No explanation.`,
            user: `Topic: ${journey.topic.slice(0, 200)}`,
            json: false,
            maxTokens: 1024,
          },
          config.providerOrder,
          15000,
          (m) => this.log.log(m),
        );
        return { mermaidCode: res?.text?.replace(/```mermaid\n|```/g, '').trim() ?? '' };
      },
      { force, accept: (v) => Boolean(v.mermaidCode) },
    );
    return { ...value, cached };
  }

  /**
   * Infographic: the model supplies a small JSON outline (1-3 s) and the SVG is
   * drawn in code. If the model is slow or down, the outline comes from the
   * lesson, so this endpoint always returns a diagram.
   */
  async generateSvgDiagram(user: AuthUser, journeyId: string, force = false, lang?: string) {
    const journey = await this.loadFor(journeyId, user, lang);
    const config = await this.cfg.get();
    const key = 'dgi2:' + CacheService.key(journey.topic.toLowerCase(), journey.language, journey.learnerType.toLowerCase());
    const { value, cached } = await this.cache.wrap(
      key,
      30 * 86400,
      async () => {
        const ai = await outlineWithModel(journey, config, (m) => this.log.log(m)).catch(() => null);
        const outline = ai ?? outlineFromLesson(journey);
        return { svg: renderInfographic(outline, journey.language === 'ur'), source: ai ? 'ai' : 'lesson' };
      },
      // A lesson-only fallback is fine to show, but retry the model next time.
      { force, accept: (v) => v.source === 'ai' },
    );
    return { ...value, cached };
  }
}
