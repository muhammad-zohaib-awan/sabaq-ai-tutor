import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { StoreModule } from './store/store.module';
import { EngineConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { LearnModule } from './learn/learn.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/auth.guards';
import { AllExceptionsFilter, LoggingInterceptor } from './common/observability';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120) },
    ]),
    StoreModule,
    EngineConfigModule,
    AuthModule,
    LearnModule,
    AnalyticsModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: rate limit first, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
