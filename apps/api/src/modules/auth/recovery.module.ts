import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module.js';
import { RecoveryDelivery, DisabledRecoveryDelivery } from './recovery-delivery.js';
import { RecoveryService } from './recovery.service.js';
import { RecoveryController } from './recovery.controller.js';
@Module({
  imports: [AuthModule],
  providers: [RecoveryService, { provide: RecoveryDelivery, useClass: DisabledRecoveryDelivery }],
  controllers: [RecoveryController],
  exports: [RecoveryService],
})
export class RecoveryModule {}
