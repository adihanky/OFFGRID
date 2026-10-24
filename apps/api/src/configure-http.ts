import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Environment } from './config/environment.js';

export function configureHttp(app: INestApplication, environment: Environment) {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: environment.WEB_ORIGIN, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
