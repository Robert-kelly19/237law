import { Module } from '@nestjs/common';
import { LanguageDetectionService } from './language-detection.service';
import { GreetingsService } from './greetings.service';

@Module({
  providers: [LanguageDetectionService, GreetingsService],
  exports: [LanguageDetectionService, GreetingsService],
})
export class CommonModule {}
