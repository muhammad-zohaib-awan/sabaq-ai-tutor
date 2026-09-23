import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  ALL_ENTITIES,
  AuditEntity,
  ConfigEntity,
  EventEntity,
  JourneyEntity,
  ReportEntity,
  UserEntity,
} from './entities';

type Mode = 'postgres' | 'memory';

/**
 * One storage seam for the whole API.
 *
 * Postgres (Supabase) is the real store. If the database is unreachable at boot
 * — expired project, paused free tier, network blip during a live demo — the
 * service starts anyway in an in-memory mode and says so loudly on /health.
 * A training demo that dies because a managed database went to sleep is a worse
 * outcome than one that runs with volatile storage for ten minutes.
 */
@Injectable()
export class StoreService implements OnModuleInit {
  private readonly log = new Logger('Store');
  private ds: DataSource | null = null;
  mode: Mode = 'memory';
  lastDbError = '';

  private mem = {
    users: new Map<string, UserEntity>(),
    journeys: new Map<string, JourneyEntity>(),
    events: [] as EventEntity[],
    config: new Map<string, ConfigEntity>(),
    reports: [] as ReportEntity[],
    audit: [] as AuditEntity[],
  };

  async onModuleInit() {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) {
      this.log.warn('DATABASE_URL not set — running with in-memory storage.');
      return;
    }
    try {
      this.ds = new DataSource({
        type: 'postgres',
        url,
        entities: ALL_ENTITIES,
        synchronize: process.env.DB_SYNC !== 'false',
        logging: false,
        ssl: /supabase|render|neon|amazonaws/i.test(url)
          ? { rejectUnauthorized: false }
          : process.env.DB_SSL === 'true'
            ? { rejectUnauthorized: false }
            : false,
        extra: { max: Number(process.env.DB_POOL_MAX ?? 5), connectionTimeoutMillis: 10000 },
      });
      // Connect in the background. Awaiting here blocks the whole boot behind
      // the driver's connect timeout — on a free-tier container that is dead
      // air before the port even opens, and a cold start the panel sits through.
      // Requests that arrive first are served from memory and the store swaps
      // over the moment Postgres answers.
      const ds = this.ds;
      void ds
        .initialize()
        .then(() => {
          this.mode = 'postgres';
          this.log.log('Connected to Postgres.');
        })
        .catch((e: any) => {
          this.lastDbError = String(e?.message ?? e).slice(0, 300);
          this.ds = null;
          this.log.error(
            `Postgres unavailable (${this.lastDbError}) — serving from in-memory storage.`,
          );
        });
    } catch (e: any) {
      this.lastDbError = String(e?.message ?? e).slice(0, 300);
      this.ds = null;
      this.log.error(`Postgres unavailable (${this.lastDbError}) — falling back to in-memory storage.`);
    }
  }

  private repo<T extends object>(e: any): Repository<T> | null {
    return this.ds?.isInitialized ? this.ds.getRepository<T>(e) : null;
  }

  get healthy() {
    return { mode: this.mode, lastDbError: this.lastDbError };
  }

  /* ------------------------------------------------------------- users */

  async findUserByEmail(email: string): Promise<UserEntity | null> {
    const r = this.repo<UserEntity>(UserEntity);
    if (r) return r.findOne({ where: { email: email.toLowerCase() } });
    return [...this.mem.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }

  async findUser(id: string): Promise<UserEntity | null> {
    const r = this.repo<UserEntity>(UserEntity);
    if (r) return r.findOne({ where: { id } });
    return this.mem.users.get(id) ?? null;
  }

  async saveUser(u: Partial<UserEntity> & { id: string }): Promise<UserEntity> {
    const defaults: Partial<UserEntity> = {
      createdAt: new Date(),
      name: '',
      role: 'learner',
      passwordHash: '',
      xp: 0,
      badges: [],
      streakDays: 0,
      lastActiveDay: '',
      learnerType: '',
    };
    const existing = (await this.findUser(u.id)) ?? ({} as UserEntity);
    const merged = {
      ...defaults,
      ...existing,
      ...u,
      email: (u.email ?? existing.email ?? '').toLowerCase(),
    } as UserEntity;
    const r = this.repo<UserEntity>(UserEntity);
    if (r) return r.save(merged);
    this.mem.users.set(merged.id, merged);
    return merged;
  }

  async listUsers(): Promise<UserEntity[]> {
    const r = this.repo<UserEntity>(UserEntity);
    if (r) return r.find({ order: { xp: 'DESC' } });
    return [...this.mem.users.values()].sort((a, b) => b.xp - a.xp);
  }

  /* ---------------------------------------------------------- journeys */

  async saveJourney(j: JourneyEntity): Promise<JourneyEntity> {
    const r = this.repo<JourneyEntity>(JourneyEntity);
    if (r) return r.save(j);
    this.mem.journeys.set(j.id, { ...j, createdAt: j.createdAt ?? new Date() });
    return j;
  }

  async findJourney(id: string): Promise<JourneyEntity | null> {
    const r = this.repo<JourneyEntity>(JourneyEntity);
    if (r) return r.findOne({ where: { id } });
    return this.mem.journeys.get(id) ?? null;
  }

  async listJourneys(limit = 200): Promise<JourneyEntity[]> {
    const r = this.repo<JourneyEntity>(JourneyEntity);
    if (r) return r.find({ order: { createdAt: 'DESC' }, take: limit });
    return [...this.mem.journeys.values()]
      .sort((a, b) => +b.createdAt - +a.createdAt)
      .slice(0, limit);
  }

  /* ------------------------------------------------------------ events */

  async saveEvent(e: EventEntity): Promise<EventEntity> {
    const r = this.repo<EventEntity>(EventEntity);
    if (r) return r.save(e);
    const row = { ...e, createdAt: e.createdAt ?? new Date() };
    this.mem.events.push(row);
    if (this.mem.events.length > 20000) this.mem.events.splice(0, 5000);
    return row;
  }

  async listEvents(filter: { learnerId?: string; journeyId?: string; since?: Date } = {}): Promise<EventEntity[]> {
    const r = this.repo<EventEntity>(EventEntity);
    if (r) {
      const qb = r.createQueryBuilder('e');
      if (filter.learnerId) qb.andWhere('e."learnerId" = :l', { l: filter.learnerId });
      if (filter.journeyId) qb.andWhere('e."journeyId" = :j', { j: filter.journeyId });
      if (filter.since) qb.andWhere('e."createdAt" >= :s', { s: filter.since });
      return qb.orderBy('e."createdAt"', 'ASC').limit(20000).getMany();
    }
    return this.mem.events
      .filter(
        (e) =>
          (!filter.learnerId || e.learnerId === filter.learnerId) &&
          (!filter.journeyId || e.journeyId === filter.journeyId) &&
          (!filter.since || e.createdAt >= filter.since),
      )
      .sort((a, b) => +a.createdAt - +b.createdAt);
  }

  /* ------------------------------------------------------------ config */

  async getConfigPatch(): Promise<any> {
    const r = this.repo<ConfigEntity>(ConfigEntity);
    if (r) return (await r.findOne({ where: { id: 'global' } }))?.patch ?? {};
    return this.mem.config.get('global')?.patch ?? {};
  }

  async setConfigPatch(patch: any, updatedBy: string): Promise<void> {
    const row: ConfigEntity = {
      id: 'global',
      patch,
      updatedBy,
      updatedAt: new Date(),
    } as ConfigEntity;
    const r = this.repo<ConfigEntity>(ConfigEntity);
    if (r) {
      await r.save(row);
      return;
    }
    this.mem.config.set('global', row);
  }

  /* ----------------------------------------------------------- reports */

  async saveReport(r0: ReportEntity): Promise<ReportEntity> {
    const r = this.repo<ReportEntity>(ReportEntity);
    if (r) return r.save(r0);
    this.mem.reports.push({ ...r0, createdAt: r0.createdAt ?? new Date() });
    return r0;
  }

  /* ------------------------------------------------------------- audit */

  /** Only the network prefix is kept: enough to spot abuse, not to follow a person. */
  private maskIp(ip: string): string {
    const raw = String(ip ?? '').split(',')[0].trim();
    if (raw.includes(':')) return raw.split(':').slice(0, 3).join(':') + ':…';
    const parts = raw.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : '';
  }

  async audit(a: {
    actor: string;
    actorRole?: string;
    action: string;
    status?: string;
    ip?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const row = {
      id: `a_${randomUUID().slice(0, 12)}`,
      actor: (a.actor ?? '').slice(0, 180),
      actorRole: a.actorRole ?? '',
      action: a.action.slice(0, 48),
      status: a.status ?? 'ok',
      ip: this.maskIp(a.ip ?? ''),
      details: a.details ?? {},
      createdAt: new Date(),
    } as AuditEntity;
    const r = this.repo<AuditEntity>(AuditEntity);
    if (r) {
      await r.save(row);
      return;
    }
    this.mem.audit.push(row);
    if (this.mem.audit.length > 5000) this.mem.audit.splice(0, 1000);
  }

  async listAudit(limit = 200): Promise<AuditEntity[]> {
    const r = this.repo<AuditEntity>(AuditEntity);
    if (r) return r.find({ order: { createdAt: 'DESC' }, take: limit });
    return [...this.mem.audit].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, limit);
  }

  async listReports(limit = 50): Promise<ReportEntity[]> {
    const r = this.repo<ReportEntity>(ReportEntity);
    if (r) return r.find({ order: { createdAt: 'DESC' }, take: limit });
    return [...this.mem.reports].sort((a, b) => +b.createdAt - +a.createdAt).slice(0, limit);
  }
}
