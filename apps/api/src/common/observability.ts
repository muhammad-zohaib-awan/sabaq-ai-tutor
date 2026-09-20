import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, tap } from 'rxjs';

/** Rolling in-process metrics. Exposed on /health/metrics for the dashboard. */
export class Metrics {
  private static reqs: Array<{ route: string; ms: number; status: number; at: number }> = [];
  private static ai: Array<{ provider: string; ok: boolean; ms: number; at: number }> = [];

  static request(route: string, ms: number, status: number) {
    this.reqs.push({ route, ms, status, at: Date.now() });
    if (this.reqs.length > 2000) this.reqs.splice(0, 500);
  }

  static aiCall(provider: string, ok: boolean, ms: number) {
    this.ai.push({ provider, ok, ms, at: Date.now() });
    if (this.ai.length > 1000) this.ai.splice(0, 300);
  }

  static snapshot() {
    const pct = (arr: number[], p: number) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
    };
    const latencies = this.reqs.map((r) => r.ms);
    const aiByProvider: Record<string, { calls: number; ok: number; p50: number; p95: number }> = {};
    for (const c of this.ai) {
      const k = (aiByProvider[c.provider] ??= { calls: 0, ok: 0, p50: 0, p95: 0 });
      k.calls++;
      if (c.ok) k.ok++;
    }
    for (const p of Object.keys(aiByProvider)) {
      const ms = this.ai.filter((c) => c.provider === p).map((c) => c.ms);
      aiByProvider[p].p50 = pct(ms, 50);
      aiByProvider[p].p95 = pct(ms, 95);
    }
    return {
      requests: this.reqs.length,
      errorRate:
        this.reqs.length === 0
          ? 0
          : Number((this.reqs.filter((r) => r.status >= 500).length / this.reqs.length).toFixed(4)),
      latencyP50Ms: pct(latencies, 50),
      latencyP95Ms: pct(latencies, 95),
      ai: aiByProvider,
      aiCalls: this.ai.length,
      aiFailures: this.ai.filter((c) => !c.ok).length,
    };
  }
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly log = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const started = Date.now();
    const rid = req.headers['x-request-id'] || randomUUID().slice(0, 8);
    res.setHeader('x-request-id', rid);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - started;
          Metrics.request(`${req.method} ${req.route?.path ?? req.url}`, ms, res.statusCode);
          this.log.log(
            `${rid} ${req.method} ${req.url} ${res.statusCode} ${ms}ms user=${req.user?.email ?? 'anon'}`,
          );
        },
        error: (err) => {
          const ms = Date.now() - started;
          const status = err instanceof HttpException ? err.getStatus() : 500;
          Metrics.request(`${req.method} ${req.route?.path ?? req.url}`, ms, status);
          this.log.warn(`${rid} ${req.method} ${req.url} ${status} ${ms}ms :: ${err?.message}`);
        },
      }),
    );
  }
}

/** Never leak a stack trace or a driver message to the client. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const safeMessage =
      exception instanceof HttpException
        ? (exception.getResponse() as any)?.message ?? exception.message
        : 'Something went wrong on our side. Please try again.';

    if (status >= 500) {
      this.log.error(`${req.method} ${req.url} :: ${(exception as any)?.stack ?? exception}`);
    }

    res.status(status).json({
      statusCode: status,
      message: safeMessage,
      requestId: res.getHeader('x-request-id') ?? null,
      timestamp: new Date().toISOString(),
    });
  }
}
