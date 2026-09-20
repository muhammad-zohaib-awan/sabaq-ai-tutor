import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Index({ unique: true })
  @Column('varchar', { length: 180 })
  email: string;

  @Column('varchar', { length: 120, default: '' })
  name: string;

  @Column('varchar', { length: 16, default: 'learner' })
  role: 'admin' | 'learner';

  @Column('varchar', { length: 200, default: '' })
  passwordHash: string;

  @Column('int', { default: 0 })
  xp: number;

  @Column('jsonb', { default: () => "'[]'" })
  badges: string[];

  @Column('int', { default: 0 })
  streakDays: number;

  @Column('varchar', { length: 40, default: '' })
  lastActiveDay: string;

  @Column('varchar', { length: 80, default: '' })
  learnerType: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('journeys')
export class JourneyEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Index()
  @Column('varchar', { length: 64, default: '' })
  ownerId: string;

  @Column('varchar', { length: 160, default: '' })
  title: string;

  @Column('varchar', { length: 160, default: '' })
  sourceName: string;

  @Column('varchar', { length: 160, default: '' })
  topic: string;

  @Column('varchar', { length: 40, default: '' })
  provider: string;

  @Column('varchar', { length: 80, default: '' })
  model: string;

  @Column('int', { default: 0 })
  latencyMs: number;

  @Column('boolean', { default: true })
  grounded: boolean;

  @Column('boolean', { default: false })
  degraded: boolean;

  @Column('jsonb')
  data: any;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('events')
export class EventEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Index()
  @Column('varchar', { length: 64 })
  learnerId: string;

  @Index()
  @Column('varchar', { length: 64, default: '' })
  journeyId: string;

  @Column('varchar', { length: 64, default: '' })
  sessionId: string;

  @Index()
  @Column('varchar', { length: 40 })
  type: string;

  @Column('varchar', { length: 64, default: '' })
  stepId: string;

  @Column('jsonb', { default: () => "'{}'" })
  payload: any;

  @Column('int', { default: 0 })
  latencyMs: number;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('engine_config')
export class ConfigEntity {
  @PrimaryColumn('varchar', { length: 32 })
  id: string;

  @Column('jsonb', { default: () => "'{}'" })
  patch: any;

  @Column('varchar', { length: 180, default: '' })
  updatedBy: string;

  @Column('timestamptz', { default: () => 'now()' })
  updatedAt: Date;
}

@Entity('report_runs')
export class ReportEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Column('varchar', { length: 180, default: '' })
  requestedBy: string;

  @Column('varchar', { length: 180, default: '' })
  emailedTo: string;

  @Column('varchar', { length: 24, default: 'generated' })
  status: string;

  @Column('int', { default: 0 })
  rows: number;

  @Column('varchar', { length: 400, default: '' })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}



/**
 * Separate from learning events on purpose: this is the security trail
 * (who signed in, who changed configuration, who exported learner data),
 * and it is never mixed with pedagogy telemetry.
 */
@Entity('audit_log')
export class AuditEntity {
  @PrimaryColumn('varchar', { length: 64 })
  id: string;

  @Index()
  @Column('varchar', { length: 180, default: '' })
  actor: string;

  @Column('varchar', { length: 16, default: '' })
  actorRole: string;

  @Index()
  @Column('varchar', { length: 48 })
  action: string;

  @Column('varchar', { length: 16, default: 'ok' })
  status: string;

  /** Truncated to a /24 before storage - enough to spot abuse, not to track a person. */
  @Column('varchar', { length: 64, default: '' })
  ip: string;

  @Column('jsonb', { default: () => "'{}'" })
  details: any;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

export const ALL_ENTITIES = [
  UserEntity,
  JourneyEntity,
  EventEntity,
  ConfigEntity,
  ReportEntity,
  AuditEntity,
];
