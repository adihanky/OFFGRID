import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { configureHttp } from './configure-http.js';
import { AppModule } from './app.module.js';
import { ENVIRONMENT } from './config/environment.module.js';
import type { Environment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const environment = app.get<Environment>(ENVIRONMENT);
  configureHttp(app, environment);
  app.enableShutdownHooks();
  await app.listen(environment.API_PORT, '127.0.0.1');
  Logger.log(`API listening at http://localhost:${environment.API_PORT}/api`, 'Bootstrap');
}

void bootstrap().catch(() => {
  Logger.error('API startup failed. Check configuration and MongoDB availability.', 'Bootstrap');
  process.exitCode = 1;
});
