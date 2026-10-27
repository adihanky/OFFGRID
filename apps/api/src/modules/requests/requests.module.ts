import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PolicyModule } from '../configuration/policy-reader.js';
import { RequestsController, RequestDecisionsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
@Module({
  imports: [AdminModule, AuthModule, PolicyModule],
  providers: [RequestsService],
  controllers: [RequestsController, RequestDecisionsController],
  exports: [RequestsService],
})
export class RequestsModule {}
