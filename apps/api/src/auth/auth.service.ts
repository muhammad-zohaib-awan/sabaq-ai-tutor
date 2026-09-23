import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { StoreService } from '../store/store.service';
import { signToken, type AuthUser, type Role } from '../common/auth.guards';

// A real hash, so an unknown email costs the same time as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');

  constructor(private readonly store: StoreService) {}

  async onModuleInit() {
    // No hardcoded fallback passwords. A missing password gets a random one,
    // printed once to the server log, so a fresh deploy is never protected by
    // a password that is in the README.
    const gen = (role: string) => {
      const p = randomBytes(12).toString('base64url');
      this.log.warn(`${role.toUpperCase()}_PASSWORD not set — generated one for this boot: ${p}`);
      return p;
    };
    await this.seed(
      process.env.ADMIN_EMAIL ?? 'admin@sabaq.app',
      process.env.ADMIN_PASSWORD || gen('admin'),
      'admin',
      'Admin',
    );
    await this.seed(
      process.env.LEARNER_EMAIL ?? 'learner@sabaq.app',
      process.env.LEARNER_PASSWORD || gen('learner'),
      'learner',
      'Demo Learner',
    );
  }

  private async seed(email: string, password: string, role: Role, name: string) {
    try {
      const existing = await this.store.findUserByEmail(email);
      if (existing) {
        this.log.log(`Seed skipped: ${email} already exists.`);
        return;
      }
      await this.store.saveUser({
        id: `u_${randomUUID().slice(0, 12)}`,
        email,
        name,
        role,
        passwordHash: await bcrypt.hash(password, 12),
        learnerType: process.env.DEFAULT_LEARNER_TYPE ?? 'Curious learner',
      });
      this.log.log(`Seeded ${role} account ${email}`);
    } catch (e: any) {
      // Postgres unique index (SQLSTATE 23505) fires when the store was in
      // memory mode when we checked for the account and switched to Postgres
      // before the insert landed. Not a failure: the row exists, which is
      // exactly what we wanted. Anything else (permission denied, missing
      // schema, etc.) still crashes loudly.
      if (e?.code === '23505' || /duplicate key|unique constraint/i.test(String(e?.message))) {
        this.log.warn(`Seed skipped (already exists): ${email}`);
        return;
      }
      throw e;
    }
  }

  async login(email: string, password: string) {
    const user = await this.store.findUserByEmail(String(email ?? '').trim());
    // Constant-ish work either way so a wrong email and a wrong password look the same.
    const ok = user ? await bcrypt.compare(password ?? '', user.passwordHash) : await bcrypt.compare(String(password ?? ''), DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect.');
    return this.issue(user);
  }

  /**
   * One-click demo sign-in for the assessment panel. Disabled by setting
   * DEMO_LOGIN=false — it exists so nobody has to type a password on stage.
   */
  /**
   * Which one-click demo roles this deployment allows.
   *
   * Note: a password-less ADMIN button on a public URL gives anyone the
   * reports, audit log and config. Fine for the panel demo; turn it off after.
   */
  demoRoles(): Role[] {
    // DEMO_LOGIN=true shows BOTH buttons (Demo Learner + Demo Admin).
    // Set DEMO_ADMIN_LOGIN=false to keep only the learner button on a public URL.
    if (process.env.DEMO_LOGIN !== 'true') return [];
    const roles: Role[] = ['learner'];
    if (process.env.DEMO_ADMIN_LOGIN !== 'false') roles.push('admin');
    return roles;
  }

  async demoLogin(role: Role) {
    if (!this.demoRoles().includes(role)) {
      throw new UnauthorizedException('Demo sign-in for that role is disabled on this deployment.');
    }
    const email = role === 'admin'
      ? (process.env.ADMIN_EMAIL ?? 'admin@sabaq.app')
      : (process.env.LEARNER_EMAIL ?? 'learner@sabaq.app');
    const user = await this.store.findUserByEmail(email);
    if (!user) throw new UnauthorizedException('Demo account is not provisioned.');
    return this.issue(user);
  }

  private issue(user: any) {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };
    return {
      token: signToken(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        xp: user.xp,
        badges: user.badges ?? [],
        learnerType: user.learnerType,
      },
    };
  }

  async me(id: string) {
    const u = await this.store.findUser(id);
    if (!u) throw new UnauthorizedException('Account no longer exists.');
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      xp: u.xp,
      badges: u.badges ?? [],
      streakDays: u.streakDays,
      learnerType: u.learnerType,
    };
  }
}