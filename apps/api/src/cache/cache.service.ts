import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * One cache seam for the whole API.
 *
 *  - REDIS_URL set   -> Redis (Upstash / Redis Cloud free tiers both work).
 *                       Shared across instances, survives restarts.
 *  - REDIS_URL blank -> an in-process LRU with TTLs. Still removes the repeat
 *                       model calls, just per instance.
 *
 * `wrap()` also de-duplicates concurrent identical requests ("singleflight"):
 * five people pressing "Show diagram" on the same topic at once make ONE
 * Gemini call, not five.
 *
 * Nothing here is required for correctness. Every failure falls through to
 * calling the producer directly — a cache outage must never become an outage.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Cache');
  private redis: any = null;
  private readonly prefix = (process.env.CACHE_PREFIX ?? 'sabaq:').trim();
  private readonly mem = new Map<string, { v: string; exp: number }>();
  private readonly maxMem = Number(process.env.CACHE_MAX_ITEMS ?? 2000);
  private readonly inflight = new Map<string, Promise<any>>();
  private hits = 0;
  private misses = 0;

  async onModuleInit() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.log.log('REDIS_URL not set — using in-memory LRU cache.');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require('ioredis');
      this.redis = new IORedis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 5000,
        lazyConnect: true,
        tls: url.startsWith('rediss://') ? {} : undefined,
      });
      this.redis.on('error', (e: any) => this.log.warn(`redis error: ${String(e?.message).slice(0, 120)}`));
      await this.redis.connect();
      this.log.log('Connected to Redis.');
    } catch (e: any) {
      this.log.warn(`Redis unavailable (${String(e?.message).slice(0, 120)}) — using in-memory cache.`);
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    try {
      await this.redis?.quit();
    } catch {
      /* ignore */
    }
  }

  get mode() {
    return this.redis?.status === 'ready' ? 'redis' : 'memory';
  }

  stats() {
    const total = this.hits + this.misses;
    return { mode: this.mode, hits: this.hits, misses: this.misses, hitRate: total ? this.hits / total : 0, memItems: this.mem.size };
  }

  static key(...parts: unknown[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
  }

  async get<T>(key: string): Promise<T | null> {
    const k = this.prefix + key;
    try {
      if (this.redis?.status === 'ready') {
        const raw = await this.redis.get(k);
        return raw ? (JSON.parse(raw) as T) : null;
      }
    } catch {
      /* fall through to memory */
    }
    const row = this.mem.get(k);
    if (!row) return null;
    if (row.exp < Date.now()) {
      this.mem.delete(k);
      return null;
    }
    // LRU touch
    this.mem.delete(k);
    this.mem.set(k, row);
    return JSON.parse(row.v) as T;
  }

  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    const k = this.prefix + key;
    const v = JSON.stringify(value);
    try {
      if (this.redis?.status === 'ready') {
        await this.redis.set(k, v, 'EX', Math.max(1, Math.round(ttlSec)));
        return;
      }
    } catch {
      /* fall through */
    }
    this.mem.set(k, { v, exp: Date.now() + ttlSec * 1000 });
    while (this.mem.size > this.maxMem) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
  }

  async del(key: string): Promise<void> {
    const k = this.prefix + key;
    this.mem.delete(k);
    try {
      if (this.redis?.status === 'ready') await this.redis.del(k);
    } catch {
      /* ignore */
    }
  }

  /**
   * Read-through with singleflight. `accept` lets the caller refuse to cache a
   * poor result (e.g. an offline/degraded build) so it is retried next time.
   */
  async wrap<T>(
    key: string,
    ttlSec: number,
    producer: () => Promise<T>,
    opts: { force?: boolean; accept?: (v: T) => boolean } = {},
  ): Promise<{ value: T; cached: boolean }> {
    if (!opts.force) {
      const hit = await this.get<T>(key);
      if (hit !== null) {
        this.hits += 1;
        return { value: hit, cached: true };
      }
    }
    this.misses += 1;
    const running = this.inflight.get(key);
    if (running) return { value: (await running) as T, cached: false };

    const p = (async () => {
      const v = await producer();
      if (!opts.accept || opts.accept(v)) await this.set(key, v, ttlSec);
      return v;
    })();
    this.inflight.set(key, p);
    try {
      return { value: await p, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}

@Global()
@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
