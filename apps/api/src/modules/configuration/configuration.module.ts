import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PolicyModule } from './policy-reader.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
@Module({
  imports: [AdminModule, AuthModule, PolicyModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class ConfigurationModule {}
