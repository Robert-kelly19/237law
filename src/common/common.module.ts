import { Module } from '@nestjs/common';
import { GreetingsService } from './greetings.service';
import { LanguageDetectionService } from './language-detection.service';
import { PerformanceTrackerService } from '../performance/performance-tracker.service';

@Module({
  providers: [LanguageDetectionService, GreetingsService, PerformanceTrackerService],
  exports: [LanguageDetectionService, GreetingsService, PerformanceTrackerService],
})
export class CommonModule {}
