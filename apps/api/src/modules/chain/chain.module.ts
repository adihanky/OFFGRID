import { Module } from '@nestjs/common';
import { ChainService } from './chain.service.js';

@Module({ providers: [ChainService], exports: [ChainService] })
export class ChainModule {}
