import { Body, Controller, Get, Ip, Post, Put } from '@nestjs/common';
import { providerStatus, testProviders } from '@sabaq/engine';
import { EngineConfigService } from './engine-config.service';
import { StoreService } from '../store/store.service';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.guards';

@Controller('config')
export class ConfigController {
  constructor(
    private readonly cfg: EngineConfigService,
    private readonly store: StoreService,
  ) {}

  @Get()
  async get() {
    const config = await this.cfg.get();
    return { config, defaults: this.cfg.defaults() };
  }

  @Roles('admin')
  @Put()
  async update(@Body() body: any, @CurrentUser() user: AuthUser, @Ip() ip: string) {
    const patch = body?.patch ?? {};
    const config = await this.cfg.update(patch, user.email);
    await this.store.audit({
      actor: user.email,
      actorRole: user.role,
      action: 'config.update',
      ip,
      details: { keys: Object.keys(patch) },
    });
    return { config, updatedBy: user.email, updatedAt: new Date().toISOString() };
  }

  @Roles('admin')
  @Post('reset')
  async reset(@CurrentUser() user: AuthUser, @Ip() ip: string) {
    const config = await this.cfg.reset(user.email);
    await this.store.audit({ actor: user.email, actorRole: user.role, action: 'config.reset', ip });
    return { config };
  }

  /**
   * Live smoke test of the provider chain: one tiny real call each, with the
   * exact error text when one fails. The fastest way to answer "why is it not
   * generating?" without reading server logs.
   */
  @Roles('admin')
  @Get('providers/test')
  async testProviders() {
    const config = await this.cfg.get();
    return { results: await testProviders(config.providerOrder, config.aiTimeoutMs) };
  }

  /** Which AI providers actually have keys on this deployment. Never returns the keys. */
  @Roles('admin')
  @Get('providers')
  async providers() {
    const config = await this.cfg.get();
    return {
      order: config.providerOrder,
      providers: providerStatus(config.providerOrder),
      timeoutMs: config.aiTimeoutMs,
    };
  }
}
