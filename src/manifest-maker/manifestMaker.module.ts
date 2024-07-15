import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ManifestMakerController } from './manifestMaker.controller';
import { ManifestMakerService } from './manifestMaker.service';

@Module({
  imports: [ConfigModule],
  controllers: [ManifestMakerController],
  providers: [ManifestMakerService],
})
export class ManifestMakerModule {}
