import {
  Controller,
  HttpException,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  Query,
} from '@nestjs/common';
import { ManifestMakerService } from './manifestMaker.service';
import { FilesInterceptor } from '@nestjs/platform-express';

@Controller('manifestMaker')
export class ManifestMakerController {
  constructor(private readonly manifestMaker: ManifestMakerService) {}

  @Post('generateSteps')
  generateSteps(
    @Body()
    {
      subtitles,
      withDescription,
      withClips,
    }: {
      subtitles: string;
      withDescription: boolean;
      withClips: boolean;
    },
  ) {
    try {
      return this.manifestMaker.generateSteps(
        subtitles,
        withDescription,
        withClips,
      );
    } catch (err) {
      if (err.message) {
        throw new HttpException(err.message, err.status);
      }
      throw new HttpException(err, 500);
    }
  }

  @Post('generateVocabularyFromFile')
  @UseInterceptors(FilesInterceptor('files'))
  generateVocabularyFromFile(
    @UploadedFiles() files: Express.Multer.File[],
    @Query() { prompt }: { prompt: string },
  ) {
    try {
      return this.manifestMaker.generateKeyboardVocabulary(prompt, files);
    } catch (err) {
      if (err.message) {
        throw new HttpException(err.message, err.status);
      }
      throw new HttpException(err, 500);
    }
  }

  @Post('generateVocabulary')
  generateVocabulary(
    @Body() { prompt, extraInfo }: { prompt: string; extraInfo: string },
  ) {
    try {
      console.log(extraInfo);
      return this.manifestMaker.generateVocabulary(prompt, extraInfo);
    } catch (err) {
      if (err.message) {
        throw new HttpException(err.message, err.status);
      }
      throw new HttpException(err, 500);
    }
  }
}
