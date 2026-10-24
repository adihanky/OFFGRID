import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ENVIRONMENT } from './config/environment.module.js';
import type { Environment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const environment = app.get<Environment>(ENVIRONMENT);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: environment.WEB_ORIGIN, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(environment.API_PORT, '127.0.0.1');
  Logger.log(`API listening at http://localhost:${environment.API_PORT}/api`, 'Bootstrap');
}

void bootstrap().catch(() => {
  Logger.error('API startup failed. Check configuration and MongoDB availability.', 'Bootstrap');
  process.exitCode = 1;
});
