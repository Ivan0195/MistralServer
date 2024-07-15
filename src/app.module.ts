import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ManifestAIModule } from './manifest_ai/manifestAI.module';
import { ManifestMakerModule } from './manifest-maker/manifestMaker.module';

@Module({
  imports: [ManifestAIModule, ManifestMakerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
