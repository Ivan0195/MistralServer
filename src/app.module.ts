import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ManifestAIModule } from './manifest_ai/manifestAI.module';

@Module({
  imports: [ManifestAIModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
