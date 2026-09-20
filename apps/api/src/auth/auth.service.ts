import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { StoreService } from '../store/store.service';
import { signToken, type AuthUser, type Role } from '../common/auth.guards';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly log = new Logger('Auth');

  constructor(private readonly store: StoreService) {}

  async onModuleInit() {
    await this.seed(
      process.env.ADMIN_EMAIL ?? 'admin@sabaq.app',
      process.env.ADMIN_PASSWORD ?? 'Admin@12345',
      'admin',
      'Admin',
    );
    await this.seed(
      process.env.LEARNER_EMAIL ?? 'learner@sabaq.app',
      process.env.LEARNER_PASSWORD ?? 'Learner@12345',
      'learner',
      'Demo Learner',
    );
    if (!process.env.ADMIN_PASSWORD) {
      this.log.warn('ADMIN_PASSWORD not set — using the documented default. Set it before the panel demo.');
    }
  }

  private async seed(email: string, password: string, role: Role, name: string) {
    const existing = await this.store.findUserByEmail(email);
    if (existing) return;
    await this.store.saveUser({
      id: `u_${randomUUID().slice(0, 12)}`,
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 10),
      learnerType: process.env.DEFAULT_LEARNER_TYPE ?? 'Nursing trainee',
    });
    this.log.log(`Seeded ${role} account ${email}`);
  }

  async login(email: string, password: string) {
    const user = await this.store.findUserByEmail(String(email ?? '').trim());
    // Constant-ish work either way so a wrong email and a wrong password look the same.
    const ok = user ? await bcrypt.compare(password ?? '', user.passwordHash) : await bcrypt.compare('x', '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect.');
    return this.issue(user);
  }

  /**
   * One-click demo sign-in for the assessment panel. Disabled by setting
   * DEMO_LOGIN=false — it exists so nobody has to type a password on stage.
   */
  async demoLogin(role: Role) {
    if (process.env.DEMO_LOGIN === 'false') {
      throw new UnauthorizedException('Demo sign-in is disabled on this deployment.');
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
