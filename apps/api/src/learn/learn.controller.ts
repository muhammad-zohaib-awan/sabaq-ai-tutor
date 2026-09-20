import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Language, OperatingConstraint, Tone } from '@sabaq/engine';
import { LearnService } from './learn.service';
import { ContentService } from '../content/content.service';
import { CurrentUser, type AuthUser } from '../common/auth.guards';

const LANGS = ['en', 'ur', 'mix'];

class AskDto {
  @IsString() @MaxLength(64) stepId: string;
  @IsString() @MaxLength(1500) question: string;
  @IsIn(LANGS) language: Language;
  @IsOptional() @IsArray() history?: Array<{ role: 'learner' | 'persona'; text: string }>;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
}

class ExplainDto {
  @IsString() @MaxLength(64) stepId: string;
  @IsString() @MaxLength(4000) answer: string;
  @IsIn(LANGS) language: Language;
  @IsOptional() @IsNumber() seconds?: number;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
}

class SimDto {
  @IsString() @MaxLength(64) stepId: string;
  @IsOptional() @IsObject() states?: Record<string, number>;
  @IsOptional() @IsArray() order?: string[];
  @IsOptional() @IsString() @MaxLength(40) optionId?: string;
  @IsOptional() @IsString() @MaxLength(40) nodeId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) attempt?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) hintsUsed?: number;
  @IsOptional() @IsNumber() seconds?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) statedConfidence?: number;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
}

class CompleteDto {
  @IsString() @MaxLength(64) stepId: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) hintsUsed?: number;
  @IsOptional() @IsNumber() seconds?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) score?: number;
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string;
}

class EventDto {
  @IsString() @MaxLength(40) type: string;
  @IsOptional() @IsString() @MaxLength(64) journeyId?: string;
  @IsOptional() @IsString() @MaxLength(64) stepId?: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

@Controller('learn')
export class LearnController {
  constructor(
    private readonly learn: LearnService,
    private readonly content: ContentService,
  ) {}

  @Get('sample')
  sample(@CurrentUser() user: AuthUser) {
    return this.learn.sample(user);
  }

  @Get('journey/:id')
  journey(@Param('id') id: string) {
    return this.learn.get(id);
  }

  @Get('state')
  state(@CurrentUser() user: AuthUser, @Query('journeyId') journeyId?: string) {
    return this.learn.state(user, journeyId);
  }

  /**
   * The live-test endpoint: unseen content in, playable mission out.
   * Accepts either multipart (file) or JSON (topic / pasted text).
   * Rate limited hard because every call can hit a paid-tier model.
   */
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('journey')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024), files: 1 },
    }),
  )
  async build(
    @UploadedFile() file: any,
    @Body() body: any,
    @CurrentUser() user: AuthUser,
  ) {
    let text = typeof body.text === 'string' ? body.text : '';
    let sourceName = 'Pasted text';

    if (file) {
      const parsed = await this.content.parse(file);
      text = parsed.text;
      sourceName = parsed.sourceName;
    }

    const topic = typeof body.topic === 'string' ? body.topic.slice(0, 300) : '';
    // A topic with no document is honestly labelled as such, so the UI never
    // implies a citation to a source that does not exist.
    if (!text && topic) sourceName = 'Your topic';

    return this.learn.build(
      {
        text,
        topic,
        sourceName,
        learnerType: String(body.learnerType ?? 'Nursing trainee').slice(0, 80),
        language: (LANGS.includes(body.language) ? body.language : 'en') as Language,
        constraint: (String(body.constraint ?? 'standard') as OperatingConstraint),
        tone: body.tone ? (String(body.tone) as Tone) : undefined,
        difficulty: body.difficulty ? Number(body.difficulty) : undefined,
      },
      user,
    );
  }

  @Post(':journeyId/sim')
  sim(@Param('journeyId') journeyId: string, @Body() dto: SimDto, @CurrentUser() user: AuthUser) {
    return this.learn.runSim(user, journeyId, {
      stepId: dto.stepId,
      states: dto.states ?? {},
      order: Array.isArray(dto.order) ? dto.order.slice(0, 10).map(String) : undefined,
      optionId: dto.optionId,
      nodeId: dto.nodeId,
      attempt: dto.attempt ?? 1,
      hintsUsed: dto.hintsUsed ?? 0,
      seconds: dto.seconds ?? 0,
      statedConfidence: dto.statedConfidence,
      sessionId: dto.sessionId,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':journeyId/ask')
  ask(@Param('journeyId') journeyId: string, @Body() dto: AskDto, @CurrentUser() user: AuthUser) {
    return this.learn.ask(user, journeyId, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':journeyId/explain')
  explain(@Param('journeyId') journeyId: string, @Body() dto: ExplainDto, @CurrentUser() user: AuthUser) {
    return this.learn.explain(user, journeyId, dto);
  }

  @Post(':journeyId/hint')
  hint(
    @Param('journeyId') journeyId: string,
    @Body() body: { stepId: string; elementId: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.learn.hint(user, journeyId, String(body.stepId ?? ''), String(body.elementId ?? ''));
  }

  @Post(':journeyId/self-correct')
  selfCorrect(
    @Param('journeyId') journeyId: string,
    @Body() body: { stepId: string; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.learn.selfCorrect(user, journeyId, String(body.stepId ?? ''), body.note ?? '');
  }

  @Post(':journeyId/complete')
  complete(@Param('journeyId') journeyId: string, @Body() dto: CompleteDto, @CurrentUser() user: AuthUser) {
    return this.learn.completeStep(user, journeyId, dto);
  }

  /** Generic telemetry sink for UI-side signals (voice used, language switched). */
  @Post('event')
  async event(@Body() dto: EventDto, @CurrentUser() user: AuthUser) {
    await this.learn.record(user, {
      journeyId: dto.journeyId ?? '',
      type: dto.type,
      stepId: dto.stepId,
      payload: dto.payload ?? {},
    });
    return { ok: true };
  }
}
