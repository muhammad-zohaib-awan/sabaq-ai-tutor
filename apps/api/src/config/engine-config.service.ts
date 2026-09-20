import { Injectable } from '@nestjs/common';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  sanitizeConfig,
  type EngineConfig,
} from '@sabaq/engine';
import { StoreService } from '../store/store.service';

/**
 * Live configuration. The Configure screen writes a patch; every request reads
 * the merged, sanitised result. No redeploy, no rebuild — which is exactly what
 * "highly configurable" has to mean in practice.
 */
@Injectable()
export class EngineConfigService {
  private cache: { at: number; cfg: EngineConfig } | null = null;
  private readonly ttlMs = 3000;

  constructor(private readonly store: StoreService) {}

  async get(): Promise<EngineConfig> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.cfg;
    const patch = await this.store.getConfigPatch();
    const cfg = sanitizeConfig(mergeConfig(DEFAULT_CONFIG, patch));
    this.cache = { at: Date.now(), cfg };
    return cfg;
  }

  async update(patch: Partial<EngineConfig>, updatedBy: string): Promise<EngineConfig> {
    const current = await this.store.getConfigPatch();
    const next = { ...current, ...patch };
    // Validate before persisting so a bad value never reaches a learner.
    sanitizeConfig(mergeConfig(DEFAULT_CONFIG, next));
    await this.store.setConfigPatch(next, updatedBy);
    this.cache = null;
    return this.get();
  }

  async reset(updatedBy: string): Promise<EngineConfig> {
    await this.store.setConfigPatch({}, updatedBy);
    this.cache = null;
    return this.get();
  }

  defaults(): EngineConfig {
    return DEFAULT_CONFIG;
  }
}
