import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseCookie, stringifySetCookie } from 'cookie';
import type { Environment } from '../../config/environment.js';
import { csrfForSession, isToken, secureEqual } from './auth.crypto.js';

export function cookieNames(environment: Environment) {
  const prefix = environment.NODE_ENV === 'production' ? '__Host-p2p_' : 'p2p_';
  return { session: `${prefix}session`, csrf: `${prefix}csrf`, oauth: `${prefix}oauth` };
}
export function readCookie(request: Request, name: string) {
  return parseCookie(request.headers.cookie ?? '')[name];
}
export function setAuthCookie(
  response: Response,
  environment: Environment,
  name: string,
  value: string,
  maxAge: number,
) {
  response.append(
    'Set-Cookie',
    stringifySetCookie({
      name,
      value,
      httpOnly: true,
      secure: environment.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    }),
  );
}
export function requireCsrf(request: Request, environment: Environment, sessionToken?: string) {
  const header = request.headers['x-csrf-token'];
  const cookie = readCookie(request, cookieNames(environment).csrf);
  if (
    request.headers.origin !== environment.WEB_ORIGIN ||
    !isToken(header) ||
    !isToken(cookie) ||
    !secureEqual(header, cookie) ||
    (sessionToken && !secureEqual(header, csrfForSession(sessionToken)))
  ) {
    throw new ForbiddenException('Invalid request origin or CSRF token.');
  }
}
