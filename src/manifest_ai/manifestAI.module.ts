import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ManifestAIController } from './manifestAI.controller';
import { ManifestAIService } from './manifestAI.service';

@Module({
  imports: [ConfigModule],
  controllers: [ManifestAIController],
  providers: [ManifestAIService],
})
export class ManifestAIModule {}
