import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { AnalyticsService } from '../analytics/analytics.service';
import { EngineConfigService } from '../config/engine-config.service';
import { StoreService } from '../store/store.service';
import { MailerService } from './mailer.service';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0B5FA5' },
};

@Injectable()
export class ReportsService {
  private readonly log = new Logger('Reports');

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly cfg: EngineConfigService,
    private readonly store: StoreService,
    private readonly mailer: MailerService,
  ) {}

  private sheet(wb: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width: number }>) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns;
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    header.fill = HEADER_FILL;
    header.height = 22;
    header.alignment = { vertical: 'middle' };
    return ws;
  }

  async workbook(days = 30) {
    const data = await this.analytics.dashboard({ days });
    const config = await this.cfg.get();

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sabaq Learning Experience Engine';
    wb.created = new Date();

    /* -------------------------------------------------------- Summary */
    const s = wb.addWorksheet('Summary');
    s.columns = [
      { header: '', key: 'k', width: 38 },
      { header: '', key: 'v', width: 26 },
    ];
    s.addRow(['Sabaq — Learning Report', '']).font = { bold: true, size: 16 };
    s.addRow(['Generated', new Date(data.generatedAt).toUTCString()]);
    s.addRow(['Window', `Last ${data.windowDays} days`]);
    s.addRow(['Storage mode', data.storageMode]);
    s.addRow([]);
    const o = data.overview;
    const rows: Array<[string, string | number]> = [
      ['Learners', o.learners],
      ['Active today', o.activeToday],
      ['Missions built', o.missionsBuilt],
      ['Steps completed', o.stepsCompleted],
      ['Questions asked', o.questionsAsked],
      ['Explanations graded', o.explanationsGraded],
      ['Hints used', o.hintsUsed],
      ['Badges unlocked', o.badgesUnlocked],
      ['Level-ups', o.levelUps],
      ['Total XP awarded', o.totalXp],
      ['Average inferred mastery', `${Math.round(o.avgMastery * 100)}%`],
      ['Learners with mastery evidence', o.learnersWithEvidence],
      ['Average time on task (min)', Math.round(o.avgTimeOnTaskSec / 60)],
      ['Step completion rate', `${Math.round(o.completionRate * 100)}%`],
      ['Grounded generation rate', `${Math.round(o.groundedRate * 100)}%`],
      ['Degraded (fallback) rate', `${Math.round(o.degradedRate * 100)}%`],
      ['Average AI latency (ms)', o.avgAiLatencyMs],
      ['API p50 latency (ms)', data.runtime.latencyP50Ms],
      ['API p95 latency (ms)', data.runtime.latencyP95Ms],
      ['API error rate', `${Math.round(data.runtime.errorRate * 100)}%`],
    ];
    for (const [k, v] of rows) {
      const r = s.addRow([k, v]);
      r.getCell(1).font = { bold: true };
    }

    /* ------------------------------------------------------- Learners */
    const ls = this.sheet(wb, 'Learners', [
      { header: 'Name', key: 'name', width: 22 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Learner type', key: 'learnerType', width: 20 },
      { header: 'Level', key: 'level', width: 8 },
      { header: 'XP', key: 'xp', width: 8 },
      { header: 'Badges', key: 'badges', width: 9 },
      { header: 'Streak (days)', key: 'streakDays', width: 13 },
      { header: 'Inferred mastery', key: 'mastery', width: 17 },
      { header: 'Confidence', key: 'conf', width: 12 },
      { header: 'Steps completed', key: 'steps', width: 16 },
      { header: 'Questions asked', key: 'questions', width: 16 },
      { header: 'Hints used', key: 'hints', width: 11 },
      { header: 'Explain avg', key: 'explain', width: 12 },
      { header: 'Time on task (min)', key: 'time', width: 18 },
      { header: 'Last active', key: 'last', width: 22 },
    ]);
    for (const l of data.learners) {
      const row = ls.addRow({
        name: l.name,
        email: l.email,
        learnerType: l.learnerType,
        level: l.level,
        xp: l.xp,
        badges: l.badges,
        streakDays: l.streakDays,
        mastery: l.hasEvidence ? l.mastery : null,
        conf: l.hasEvidence ? l.masteryConfidence : null,
        steps: l.stepsCompleted,
        questions: l.questionsAsked,
        hints: l.hintsUsed,
        explain: l.explainAvg || null,
        time: Math.round(l.timeOnTaskSec / 60),
        last: l.lastActive ? new Date(l.lastActive).toUTCString() : 'never',
      });
      row.getCell('mastery').numFmt = '0%';
      row.getCell('conf').numFmt = '0%';
      row.getCell('explain').numFmt = '0%';
      if (l.hasEvidence) {
        const c = row.getCell('mastery');
        c.font = {
          bold: true,
          color: { argb: l.mastery >= 0.7 ? 'FF157347' : l.mastery >= 0.4 ? 'FFB26A00' : 'FFB02A37' },
        };
      } else {
        row.getCell('mastery').value = 'no evidence yet';
        row.getCell('mastery').font = { italic: true, color: { argb: 'FF6B7280' } };
      }
    }
    ls.autoFilter = { from: 'A1', to: 'O1' };

    /* ----------------------------------------------------- Engagement */
    const es = this.sheet(wb, 'Engagement', [
      { header: 'Day', key: 'day', width: 14 },
      { header: 'Active learners', key: 'activeLearners', width: 16 },
      { header: 'Events', key: 'events', width: 10 },
      { header: 'Steps completed', key: 'completions', width: 17 },
    ]);
    data.engagement.forEach((d) => es.addRow(d));

    const chart = this.sheet(wb, 'Mastery distribution', [
      { header: 'Band', key: 'band', width: 14 },
      { header: 'Learners', key: 'learners', width: 12 },
    ]);
    data.masteryDistribution.forEach((d) => chart.addRow(d));

    /* -------------------------------------------------------- Missions */
    const ms = this.sheet(wb, 'Missions', [
      { header: 'Title', key: 'title', width: 34 },
      { header: 'Source', key: 'sourceName', width: 26 },
      { header: 'Topic', key: 'topic', width: 26 },
      { header: 'Provider', key: 'provider', width: 14 },
      { header: 'Model', key: 'model', width: 26 },
      { header: 'Latency (ms)', key: 'latencyMs', width: 13 },
      { header: 'Grounded', key: 'grounded', width: 11 },
      { header: 'Fallback used', key: 'degraded', width: 14 },
      { header: 'Built at', key: 'createdAt', width: 24 },
    ]);
    for (const j of data.journeys) {
      ms.addRow({
        ...j,
        grounded: j.grounded ? 'yes' : 'CHECK',
        degraded: j.degraded ? 'yes' : 'no',
        createdAt: new Date(j.createdAt).toUTCString(),
      });
    }
    ms.autoFilter = { from: 'A1', to: 'I1' };

    /* ------------------------------------------------ Providers / usage */
    const ps = this.sheet(wb, 'AI providers', [
      { header: 'Provider', key: 'provider', width: 16 },
      { header: 'Missions served', key: 'journeys', width: 17 },
      { header: 'Avg latency (ms)', key: 'avgLatencyMs', width: 18 },
      { header: 'Calls (runtime)', key: 'calls', width: 15 },
      { header: 'Successful', key: 'ok', width: 12 },
      { header: 'p50 (ms)', key: 'p50', width: 11 },
      { header: 'p95 (ms)', key: 'p95', width: 11 },
    ]);
    const providers = new Set([
      ...Object.keys(data.providerUse),
      ...Object.keys(data.runtime.ai ?? {}),
    ]);
    for (const p of providers) {
      ps.addRow({
        provider: p,
        journeys: data.providerUse[p]?.journeys ?? 0,
        avgLatencyMs: data.providerUse[p]?.avgLatencyMs ?? 0,
        calls: (data.runtime.ai as any)?.[p]?.calls ?? 0,
        ok: (data.runtime.ai as any)?.[p]?.ok ?? 0,
        p50: (data.runtime.ai as any)?.[p]?.p50 ?? 0,
        p95: (data.runtime.ai as any)?.[p]?.p95 ?? 0,
      });
    }

    const us = this.sheet(wb, 'Usage breakdown', [
      { header: 'Dimension', key: 'dim', width: 20 },
      { header: 'Key', key: 'key', width: 26 },
      { header: 'Count', key: 'count', width: 12 },
    ]);
    for (const [k, v] of Object.entries(data.languageUse)) {
      us.addRow({ dim: 'Language', key: k === 'mix' ? 'Urdu + English' : k === 'ur' ? 'Urdu' : 'English', count: v });
    }
    for (const [k, v] of Object.entries(data.badgeUse)) {
      us.addRow({ dim: 'Badge unlocked', key: data.badges.find((b) => b.id === k)?.label ?? k, count: v });
    }

    /* ------------------------------------------------- Config snapshot */
    const cs = this.sheet(wb, 'Configuration', [
      { header: 'Setting', key: 'k', width: 34 },
      { header: 'Value', key: 'v', width: 52 },
    ]);
    cs.addRow({ k: 'XP per step', v: config.xpPerStep.join(' / ') });
    cs.addRow({ k: 'XP per level', v: config.xpPerLevel });
    cs.addRow({ k: 'Hint penalty (XP)', v: config.hintPenaltyXp });
    cs.addRow({ k: 'Mastery unlock threshold', v: `${Math.round(config.masteryUnlockThreshold * 100)}%` });
    cs.addRow({ k: 'Mastery prior strength', v: config.masteryPriorStrength });
    cs.addRow({ k: 'Adaptation sensitivity', v: config.adaptationSensitivity });
    cs.addRow({ k: 'Provider order', v: config.providerOrder.join(' → ') });
    cs.addRow({ k: 'AI timeout (ms)', v: config.aiTimeoutMs });
    cs.addRow({ k: 'Grounding check required', v: config.requireGrounding ? 'yes' : 'no' });
    cs.addRow({ k: 'Default language', v: config.defaultLanguage });
    cs.addRow({ k: 'Default learner type', v: config.defaultLearnerType });
    for (const [k, v] of Object.entries(config.masteryWeights)) {
      cs.addRow({ k: `Mastery weight · ${k}`, v });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, data, filename: this.filename(days) };
  }

  filename(days: number) {
    return `sabaq-learning-report-${new Date().toISOString().slice(0, 10)}-${days}d.xlsx`;
  }

  async emailReport(args: { to: string; days: number; requestedBy: string }) {
    const { buffer, data, filename } = await this.workbook(args.days);
    const o = data.overview;
    const result = await this.mailer.sendReport({
      to: args.to,
      subject: `Sabaq learning report — ${new Date().toISOString().slice(0, 10)} (last ${args.days} days)`,
      summaryLines: [
        `Learners: ${o.learners}   Active today: ${o.activeToday}`,
        `Missions built: ${o.missionsBuilt}   Steps completed: ${o.stepsCompleted}`,
        `Average inferred mastery: ${Math.round(o.avgMastery * 100)}% across ${o.learnersWithEvidence} learner(s) with evidence`,
        `Badges unlocked: ${o.badgesUnlocked}   Total XP awarded: ${o.totalXp}`,
        `Grounded generations: ${Math.round(o.groundedRate * 100)}%   Fallback used on: ${Math.round(o.degradedRate * 100)}% of missions`,
        `API p95 latency: ${data.runtime.latencyP95Ms} ms   Error rate: ${Math.round(data.runtime.errorRate * 100)}%`,
      ],
      filename,
      buffer,
    });

    await this.store.saveReport({
      id: `r_${randomUUID().slice(0, 12)}`,
      requestedBy: args.requestedBy,
      emailedTo: args.to,
      status: result.sent ? 'emailed' : 'generated',
      rows: data.learners.length,
      note: result.reason ?? '',
      createdAt: new Date(),
    } as any);

    return { ...result, filename, summary: o };
  }

  history() {
    return this.store.listReports(50);
  }
}
