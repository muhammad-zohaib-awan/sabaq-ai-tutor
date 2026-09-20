import { Controller, Get, Module } from '@nestjs/common';
import { providerStatus } from '@sabaq/engine';
import { Public } from '../common/auth.guards';
import { Metrics } from '../common/observability';
import { StoreService } from '../store/store.service';
import { EngineConfigService } from '../config/engine-config.service';

const startedAt = Date.now();

@Controller()
export class HealthController {
  constructor(
    private readonly store: StoreService,
    private readonly cfg: EngineConfigService,
  ) {}

  /**
   * Kept deliberately cheap: this is also the keep-alive target that stops a
   * free-tier container from cold-starting in front of the assessment panel.
   */
  @Public()
  @Get('health')
  health() {
    const s = this.store.healthy;
    return {
      status: 'ok',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      storage: s.mode,
      storageDegraded: s.mode !== 'postgres',
      version: process.env.APP_VERSION ?? '1.0.0',
      time: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health/ready')
  async ready() {
    const config = await this.cfg.get();
    const providers = providerStatus(config.providerOrder);
    return {
      ready: true,
      storage: this.store.healthy.mode,
      aiProvidersConfigured: providers.filter((p) => p.configured).map((p) => p.id),
      // An engine with no keys still serves learners via the offline builder.
      canServeLearners: true,
    };
  }

  @Public()
  @Get('health/metrics')
  metrics() {
    return { ...Metrics.snapshot(), uptimeSec: Math.round((Date.now() - startedAt) / 1000) };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
