import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailResult {
  sent: boolean;
  to: string;
  messageId?: string;
  reason?: string;
  preview?: { subject: string; body: string; attachment: string };
}

/**
 * SMTP is optional by design. If it is not configured the report still generates
 * and downloads, and this service returns exactly what would have been sent, so
 * the feature is demonstrable on a deployment with no mail credentials.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger('Mailer');

  get configured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  private transport() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }

  async sendReport(args: {
    to: string;
    subject: string;
    summaryLines: string[];
    filename: string;
    buffer: Buffer;
  }): Promise<MailResult> {
    const body = [
      'Sabaq — Learning Experience Engine',
      '',
      ...args.summaryLines,
      '',
      `The full breakdown is attached as ${args.filename}.`,
      '',
      'This report was generated automatically from learner activity. No free-text learner content is included.',
    ].join('\n');

    if (!this.configured) {
      this.log.warn('SMTP not configured — returning a preview instead of sending.');
      return {
        sent: false,
        to: args.to,
        reason:
          'SMTP is not configured on this deployment. Set SMTP_HOST, SMTP_USER and SMTP_PASS to enable sending.',
        preview: { subject: args.subject, body, attachment: args.filename },
      };
    }

    try {
      const info = await this.transport().sendMail({
        from: process.env.SMTP_FROM ?? `Sabaq Reports <${process.env.SMTP_USER}>`,
        to: args.to,
        subject: args.subject,
        text: body,
        attachments: [
          {
            filename: args.filename,
            content: args.buffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });
      this.log.log(`Report emailed to ${args.to} (${info.messageId})`);
      return { sent: true, to: args.to, messageId: info.messageId };
    } catch (e: any) {
      const reason = String(e?.message ?? e).slice(0, 300);
      this.log.error(`Report email failed: ${reason}`);
      return { sent: false, to: args.to, reason, preview: { subject: args.subject, body, attachment: args.filename } };
    }
  }
}
