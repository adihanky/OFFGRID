import { Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { AuthController } from './auth.controller.js';
import { PasswordService } from './auth.crypto.js';
import { AuthGuard } from './auth.guard.js';
import { AuthStore } from './auth.models.js';
import { AuthService } from './auth.service.js';
import { GoogleProvider, GOOGLE_HTTP, GOOGLE_KEYS } from './google.provider.js';
import { MongoAuthStore } from './mongo-auth.store.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    PasswordService,
    GoogleProvider,
    { provide: AuthStore, useClass: MongoAuthStore },
    {
      provide: GOOGLE_KEYS,
      useFactory: () =>
        createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
          timeoutDuration: 10000,
        }),
    },
    { provide: GOOGLE_HTTP, useValue: fetch },
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
