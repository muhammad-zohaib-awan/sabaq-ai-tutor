import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';

export type Role = 'admin' | 'learner';
export interface AuthUser {
  sub: string;
  email: string;
  role: Role;
  name: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

export function jwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set to at least 16 characters in production');
    }
    return 'dev-only-insecure-secret-change-me';
  }
  return s;
}

export function signToken(u: AuthUser): string {
  const options = { expiresIn: process.env.JWT_TTL ?? '12h' } as jwt.SignOptions;
  return jwt.sign(u as object, jwtSecret(), options);
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers?.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (token) {
      try {
        req.user = jwt.verify(token, jwtSecret()) as AuthUser;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Session expired. Please sign in again.');
      }
    }

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Sign in required.');

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('Your role does not have access to this.');
    }
    return true;
  }
}
