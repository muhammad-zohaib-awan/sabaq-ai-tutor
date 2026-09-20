import { Body, Controller, Get, Ip, Module, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { MailerService } from './mailer.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { StoreService } from '../store/store.service';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.guards';

@Roles('admin')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly mailer: MailerService,
    private readonly store: StoreService,
  ) {}

  /** Download the workbook. Streamed as a buffer; nothing is written to disk. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('excel')
  async excel(
    @Query('days') days: string | undefined,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
  ) {
    const window = Math.min(365, Math.max(1, Number(days) || 30));
    const { buffer, filename } = await this.reports.workbook(window);
    // Exporting learner data is a privileged action and is always recorded.
    await this.store.audit({
      actor: user.email,
      actorRole: user.role,
      action: 'report.export_excel',
      ip,
      details: { windowDays: window, bytes: buffer.length },
    });
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('content-length', String(buffer.length));
    res.end(buffer);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('email')
  async email(@Body() body: { to?: string; days?: number }, @CurrentUser() user: AuthUser, @Ip() ip: string) {
    const to = (body.to ?? process.env.REPORT_EMAIL_TO ?? user.email).trim();
    const days = Math.min(365, Math.max(1, Number(body.days) || 30));
    const res = await this.reports.emailReport({ to, days, requestedBy: user.email });
    await this.store.audit({
      actor: user.email,
      actorRole: user.role,
      action: 'report.email',
      status: res.sent ? 'ok' : 'not_sent',
      ip,
      details: { to, windowDays: days },
    });
    return res;
  }

  @Get('status')
  status() {
    return {
      smtpConfigured: this.mailer.configured,
      defaultRecipient: process.env.REPORT_EMAIL_TO ?? null,
      scheduleCron: process.env.REPORT_CRON ?? null,
    };
  }

  @Get('history')
  history() {
    return this.reports.history();
  }

  /** The security trail: sign-ins, configuration changes, data exports. */
  @Get('audit')
  audit() {
    return this.store.listAudit(200);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, MailerService, AnalyticsService],
  exports: [ReportsService],
})
export class ReportsModule {}
