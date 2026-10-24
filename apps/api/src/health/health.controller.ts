import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@p2p/contracts';
import { DatabaseService } from '../database/database.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  live(): LivenessResponse {
    return { status: 'ok', service: 'p2p-api' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    const result = await this.database.readiness();
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}
