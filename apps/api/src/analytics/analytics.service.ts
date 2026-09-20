import { Injectable } from '@nestjs/common';
import { inferMastery, progressFromXp, type LearningEvent } from '@sabaq/engine';
import { StoreService } from '../store/store.service';
import { EngineConfigService } from '../config/engine-config.service';
import { Metrics } from '../common/observability';

export interface AnalyticsFilter {
  days?: number;
  learnerId?: string;
  language?: string;
  provider?: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly store: StoreService,
    private readonly cfg: EngineConfigService,
  ) {}

  async dashboard(filter: AnalyticsFilter = {}) {
    const config = await this.cfg.get();
    const days = Math.min(365, Math.max(1, Number(filter.days) || 30));
    const since = new Date(Date.now() - days * 86400000);

    const [users, journeyRows, eventRows] = await Promise.all([
      this.store.listUsers(),
      this.store.listJourneys(500),
      this.store.listEvents({ since }),
    ]);

    let events = eventRows;
    if (filter.learnerId) events = events.filter((e) => e.learnerId === filter.learnerId);
    if (filter.language) events = events.filter((e) => (e.payload as any)?.language === filter.language);
    if (filter.provider) events = events.filter((e) => (e.payload as any)?.provider === filter.provider);

    const toEngine = (rows: any[]): LearningEvent[] =>
      rows.map((r) => ({
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

    /* ---------------------------------------------------------- learners */

    const learners = users
      .filter((u) => (filter.learnerId ? u.id === filter.learnerId : true))
      .map((u) => {
        const mine = events.filter((e) => e.learnerId === u.id);
        const mastery = inferMastery(toEngine(mine), config);
        const progress = progressFromXp(u.xp ?? 0, config);
        const completions = mine.filter((e) => e.type === 'step_completed');
        const hints = mine.filter((e) => e.type === 'hint_used').length;
        const questions = mine.filter((e) => e.type === 'question_asked').length;
        const explains = mine.filter((e) => e.type === 'explain_submitted');
        const seconds = completions.reduce((a, e) => a + Number((e.payload as any)?.seconds ?? 0), 0);
        const last = mine.length ? new Date(mine[mine.length - 1].createdAt) : null;

        return {
          id: u.id,
          name: u.name || u.email.split('@')[0],
          email: u.email,
          role: u.role,
          learnerType: u.learnerType || config.defaultLearnerType,
          xp: u.xp ?? 0,
          level: progress.level,
          badges: (u.badges ?? []).length,
          badgeIds: u.badges ?? [],
          streakDays: u.streakDays ?? 0,
          mastery: mastery.overall,
          masteryConfidence: mastery.confidence,
          hasEvidence: mastery.hasEvidence,
          stepsCompleted: completions.length,
          questionsAsked: questions,
          hintsUsed: hints,
          explainAvg:
            explains.length > 0
              ? Number(
                  (
                    explains.reduce((a, e) => a + Number((e.payload as any)?.score ?? 0), 0) /
                    explains.length
                  ).toFixed(3),
                )
              : 0,
          timeOnTaskSec: Math.round(seconds),
          lastActive: last ? last.toISOString() : null,
        };
      });

    /* --------------------------------------------------------- engagement */

    const buckets: Record<string, { day: string; events: number; completions: number; learners: Set<string> }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buckets[d] = { day: d, events: 0, completions: 0, learners: new Set() };
    }
    for (const e of events) {
      const d = new Date(e.createdAt).toISOString().slice(0, 10);
      const b = buckets[d];
      if (!b) continue;
      b.events++;
      b.learners.add(e.learnerId);
      if (e.type === 'step_completed') b.completions++;
    }
    const engagement = Object.values(buckets).map((b) => ({
      day: b.day,
      events: b.events,
      completions: b.completions,
      activeLearners: b.learners.size,
    }));

    /* ------------------------------------------------------ distributions */

    const withEvidence = learners.filter((l) => l.hasEvidence);
    const bandOf = (m: number) =>
      m < 0.2 ? '0–20%' : m < 0.4 ? '20–40%' : m < 0.6 ? '40–60%' : m < 0.8 ? '60–80%' : '80–100%';
    const masteryDistribution = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'].map((band) => ({
      band,
      learners: withEvidence.filter((l) => bandOf(l.mastery) === band).length,
    }));

    /* ------------------------------------------------------------ content */

    const journeys = journeyRows.map((j) => ({
      id: j.id,
      title: j.title,
      sourceName: j.sourceName,
      topic: j.topic,
      provider: j.provider,
      model: j.model,
      latencyMs: j.latencyMs,
      grounded: j.grounded,
      degraded: j.degraded,
      createdAt: new Date(j.createdAt).toISOString(),
    }));

    const providerUse: Record<string, { journeys: number; avgLatencyMs: number }> = {};
    for (const j of journeys) {
      const p = (providerUse[j.provider] ??= { journeys: 0, avgLatencyMs: 0 });
      p.avgLatencyMs = Math.round((p.avgLatencyMs * p.journeys + j.latencyMs) / (p.journeys + 1));
      p.journeys++;
    }

    const languageUse: Record<string, number> = {};
    for (const e of events) {
      const l = String((e.payload as any)?.language ?? '');
      if (l) languageUse[l] = (languageUse[l] ?? 0) + 1;
    }

    const badgeUse: Record<string, number> = {};
    for (const e of events.filter((e) => e.type === 'badge_unlocked')) {
      const b = String((e.payload as any)?.badgeId ?? '');
      if (b) badgeUse[b] = (badgeUse[b] ?? 0) + 1;
    }

    /* ----------------------------------------------------------- overview */

    const completions = events.filter((e) => e.type === 'step_completed');
    const today = new Date().toISOString().slice(0, 10);
    const activeToday = new Set(
      events.filter((e) => new Date(e.createdAt).toISOString().slice(0, 10) === today).map((e) => e.learnerId),
    ).size;
    const avgMastery = withEvidence.length
      ? Number((withEvidence.reduce((a, l) => a + l.mastery, 0) / withEvidence.length).toFixed(3))
      : 0;
    const aiEvents = events.filter((e) => (e.payload as any)?.provider);
    const degraded = journeys.filter((j) => j.degraded).length;

    const overview = {
      learners: learners.filter((l) => l.role === 'learner').length || learners.length,
      activeToday,
      missionsBuilt: journeys.length,
      stepsCompleted: completions.length,
      questionsAsked: events.filter((e) => e.type === 'question_asked').length,
      explanationsGraded: events.filter((e) => e.type === 'explain_submitted').length,
      hintsUsed: events.filter((e) => e.type === 'hint_used').length,
      badgesUnlocked: events.filter((e) => e.type === 'badge_unlocked').length,
      levelUps: events.filter((e) => e.type === 'level_up').length,
      totalXp: learners.reduce((a, l) => a + l.xp, 0),
      avgMastery,
      learnersWithEvidence: withEvidence.length,
      avgTimeOnTaskSec: learners.length
        ? Math.round(learners.reduce((a, l) => a + l.timeOnTaskSec, 0) / learners.length)
        : 0,
      completionRate:
        journeys.length > 0
          ? Number((completions.length / (journeys.length * 3)).toFixed(3))
          : 0,
      groundedRate:
        journeys.length > 0 ? Number((journeys.filter((j) => j.grounded).length / journeys.length).toFixed(3)) : 1,
      degradedRate: journeys.length > 0 ? Number((degraded / journeys.length).toFixed(3)) : 0,
      avgAiLatencyMs: aiEvents.length
        ? Math.round(aiEvents.reduce((a, e) => a + (e.latencyMs ?? 0), 0) / aiEvents.length)
        : 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      storageMode: this.store.healthy.mode,
      overview,
      learners: learners.sort((a, b) => b.xp - a.xp),
      engagement,
      masteryDistribution,
      journeys: journeys.slice(0, 100),
      providerUse,
      languageUse,
      badgeUse,
      runtime: Metrics.snapshot(),
      badges: config.badges,
    };
  }
}
