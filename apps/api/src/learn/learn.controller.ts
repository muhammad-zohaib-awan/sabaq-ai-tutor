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
  ArrayMaxSize,
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
const CONSTRAINT_IDS = ['standard', 'low_bandwidth', 'voice_only', 'accessibility', 'offline_first'];
const TONES = ['coaching', 'socratic', 'formal', 'playful', 'mentor'];

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
  @IsOptional() @IsIn(LANGS) language?: string;
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

class TranslateDto {
  @IsIn(LANGS) language: Language;
}

class HintDto {
  @IsOptional() @IsIn(LANGS) language?: string;
  @IsString() @MaxLength(64) stepId: string;
  @IsOptional() @IsObject() states?: Record<string, number>;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) order?: string[];
  @IsOptional() @IsString() @MaxLength(40) optionId?: string;
  @IsOptional() @IsString() @MaxLength(40) nodeId?: string;
}

class StepRefDto {
  @IsOptional() @IsIn(LANGS) language?: string;
  @IsString() @MaxLength(64) stepId: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/**
 * Only UI-side signals may be posted by the browser. The old DTO accepted any
 * type, so a learner could post `explain_submitted` with `score: 1` and the
 * mastery engine would believe it.
 */
const CLIENT_EVENT_TYPES = ['voice_used', 'language_switched', 'step_started', 'confidence_stated', 'lesson_viewed'];

class EventDto {
  @IsIn(CLIENT_EVENT_TYPES) type: string;
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
  journey(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.learn.get(id, user);
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
    let text = typeof body.text === 'string' ? body.text.slice(0, 200_000) : '';
    let sourceName = 'Pasted text';

    if (file) {
      const parsed = await this.content.parse(file);
      text = parsed.text;
      sourceName = parsed.sourceName;
    }

    const clean = (v: unknown, max: number) =>
      typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

    const topic = clean(body.topic, 300);
    // A topic with no document is honestly labelled as such, so the UI never
    // implies a citation to a source that does not exist.
    if (!text && topic) sourceName = 'Your topic';

    const constraint = CONSTRAINT_IDS.includes(body.constraint) ? body.constraint : 'standard';
    const constraintNote = clean(body.constraintNote, 160);
    const difficulty = Number(body.difficulty);

    return this.learn.build(
      {
        text,
        topic,
        sourceName,
        learnerType: clean(body.learnerType, 80) || 'Curious learner',
        language: (LANGS.includes(body.language) ? body.language : 'en') as Language,
        constraint: constraint as OperatingConstraint,
        constraintNote: constraintNote || undefined,
        tone: TONES.includes(body.tone) ? (body.tone as Tone) : undefined,
        difficulty: Number.isFinite(difficulty) ? Math.min(5, Math.max(1, Math.round(difficulty))) : undefined,
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
      language: dto.language,
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

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':journeyId/hint')
  hint(@Param('journeyId') journeyId: string, @Body() dto: HintDto, @CurrentUser() user: AuthUser) {
    return this.learn.hint(user, journeyId, dto);
  }

  @Post(':journeyId/self-correct')
  selfCorrect(@Param('journeyId') journeyId: string, @Body() dto: StepRefDto, @CurrentUser() user: AuthUser) {
    return this.learn.selfCorrect(user, journeyId, dto.stepId, dto.note ?? '');
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

  /** Reveal the answer. Recorded as evidence, so mastery stays honest. */
  @Post(':journeyId/reveal')
  reveal(@Param('journeyId') journeyId: string, @Body() dto: StepRefDto, @CurrentUser() user: AuthUser) {
    return this.learn.reveal(user, journeyId, dto.stepId, dto.language);
  }

  // Diagram generation is a full model call each time, so it is throttled far
  // harder than the cheap routes — otherwise one learner holding down a button
  // burns the whole deployment's free-tier quota.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':journeyId/diagram-mermaid')
  async getMermaidDiagram(@Param('journeyId') id: string, @Query('force') force: string, @CurrentUser() user: AuthUser) {
    return this.learn.generateMermaidDiagram(user, id, force === '1');
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':journeyId/diagram-svg')
  async getSvgDiagram(
    @Param('journeyId') id: string,
    @Query('force') force: string,
    @Query('lang') lang: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.learn.generateSvgDiagram(user, id, force === '1', lang);
  }

  /** Translate the mission into the language the learner just switched to. */
  // Results are cached server-side, so repeats are cheap. Generous limit.
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post(':journeyId/translate')
  translate(@Param('journeyId') id: string, @Body() dto: TranslateDto, @CurrentUser() user: AuthUser) {
    return this.learn.translate(user, id, dto.language);
  }
}
