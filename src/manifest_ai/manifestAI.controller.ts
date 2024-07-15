import {
  Controller,
  HttpException,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ManifestAIService } from './manifestAI.service';
import { FilesInterceptor } from '@nestjs/platform-express';

@Controller('manifestAI')
export class ManifestAIController {
  constructor(private readonly manifestAIService: ManifestAIService) {}
  @Post('invoke')
  @UseInterceptors(FilesInterceptor('files'))
  uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Query() query: { prompt: string; language: 'en' | 'pl' },
  ) {
    try {
      return this.manifestAIService.getAnswer(
        query.prompt,
        [...files],
        query.language,
      );
    } catch (err) {
      console.log('EEERRRROOORR');
      if (err.message) {
        throw new HttpException(err.message, err.status);
      }
      throw new HttpException(err, 500);
    }
  }
}
