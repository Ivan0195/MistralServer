import {
  Body,
  Controller,
  HttpException,
  Post,
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
    @Body() query: { prompt: string; text?: string; language: 'en' | 'pl' },
  ) {
    try {
      return this.manifestAIService.getAnswer({
        prompt: query.prompt,
        files: [...files],
        text: query.text,
        language: query.language,
      });
    } catch (err) {
      console.log('EEERRRROOORR');
      if (err.message) {
        throw new HttpException(err.message, err.status);
      }
      throw new HttpException(err, 500);
    }
  }
}
