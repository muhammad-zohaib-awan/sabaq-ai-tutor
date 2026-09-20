import { Module } from '@nestjs/common';
import { LearnController } from './learn.controller';
import { LearnService } from './learn.service';
import { ContentService } from '../content/content.service';

@Module({
  controllers: [LearnController],
  providers: [LearnService, ContentService],
  exports: [LearnService],
})
export class LearnModule {}
