import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { StoreService } from '../store/store.service';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guards';

class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(180)
  email: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters.' })
  @MaxLength(200)
  password: string;
}

class DemoDto {
  @IsIn(['admin', 'learner'])
  role: 'admin' | 'learner';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly store: StoreService,
  ) {}

  /** Tight limit: brute-forcing the panel demo account should not be possible. */
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    try {
      const res = await this.auth.login(dto.email, dto.password);
      await this.store.audit({ actor: dto.email, actorRole: res.user.role, action: 'auth.login', ip });
      return res;
    } catch (e) {
      // Failed attempts are the ones worth keeping: this is how brute force shows up.
      await this.store.audit({ actor: dto.email, action: 'auth.login', status: 'denied', ip });
      throw e;
    }
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('demo')
  async demo(@Body() dto: DemoDto, @Ip() ip: string) {
    const res = await this.auth.demoLogin(dto.role);
    await this.store.audit({ actor: res.user.email, actorRole: dto.role, action: 'auth.demo_login', ip });
    return res;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }
}
