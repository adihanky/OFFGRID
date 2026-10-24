import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENVIRONMENT } from '../../config/environment.module.js';
import type { Environment } from '../../config/environment.js';
import { AuthService } from './auth.service.js';
import { cookieNames, readCookie } from './auth.http.js';

export type AuthenticatedRequest = Request & {
  auth: NonNullable<Awaited<ReturnType<AuthService['authenticate']>>>;
};
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const identity = await this.auth.authenticate(
      readCookie(request, cookieNames(this.environment).session),
    );
    if (!identity) throw new UnauthorizedException('Sign in to continue.');
    request.auth = identity;
    return true;
  }
}
