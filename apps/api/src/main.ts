// MUST stay first: modules read process.env at import time.
import { envFilesLoaded, envSummary } from './env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Behind Render/Railway/Fly there is exactly one proxy hop. Without this every
  // request looks like it comes from the proxy, so the rate limiter either
  // throttles everyone together or can be dodged with a spoofed header.
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  express.disable('x-powered-by');
  // Explicit, small body limits: the only large payload is a file upload,
  // which multer bounds separately.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bodyParser = require('body-parser');
  app.use(bodyParser.json({ limit: '200kb' }));
  app.use(bodyParser.urlencoded({ extended: false, limit: '50kb' }));

  app.use(
    helmet({
      // JSON only: the strictest possible CSP costs nothing.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  // CORS_ORIGINS can be a comma-separated list. Add `*` to allow every origin
  // (dev only — production rejects `*` automatically to avoid accidental exposure).
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Every Vercel preview of this project carries a hostname like
  // `sabaq-ai-tutor-web-git-main-<hash>.vercel.app` or
  // `sabaq-ai-tutor-web-<hash>.vercel.app`. Match by prefix so a preview URL
  // does not need a manual allow-list entry after every commit.
  const vercelPrefix = (process.env.VERCEL_PREVIEW_PREFIX ?? 'sabaq-ai-tutor-web').trim();

  app.enableCors({
    origin: (origin, cb) => {
      // Same-origin / server-to-server requests arrive with no Origin header.
      if (!origin) return cb(null, true);

      // Exact matches first.
      if (origins.includes(origin)) return cb(null, true);

      // Wildcard: allowed only outside production, so a misconfigured prod
      // deployment cannot accidentally expose the API to every origin.
      if (origins.includes('*') && process.env.NODE_ENV !== 'production') {
        return cb(null, true);
      }

      // Vercel previews of THIS project only. Matching any *.vercel.app would
      // let anyone who deploys a site there make calls against this API.
      if (process.env.ALLOW_VERCEL_PREVIEWS === 'true') {
        try {
          const host = new URL(origin).hostname;
          if (
            host.endsWith('.vercel.app') &&
            host.startsWith(vercelPrefix)
          ) {
            log.log(`CORS: allowing Vercel preview origin ${origin}`);
            return cb(null, true);
          }
        } catch {
          /* malformed origin — fall through to rejection */
        }
      }

      log.warn(`CORS: rejecting origin ${origin}`);
      return cb(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'content-disposition'],
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      validationError: { target: false, value: false },
    }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  const env = envSummary();
  log.log(`Sabaq API listening on :${port} (prefix /api)`);
  log.log(`CORS origins: ${origins.join(', ')}`);
  log.log(`CORS Vercel previews: ${process.env.ALLOW_VERCEL_PREVIEWS === 'true' ? `enabled for prefix "${vercelPrefix}"` : 'disabled'}`);
  log.log(
    envFilesLoaded.length
      ? `Loaded env from: ${envFilesLoaded.join(', ')}`
      : 'No .env file found — using only real environment variables.',
  );
  // The single most useful line in the log: it answers "why is it not
  // generating?" before anyone has to open the browser devtools.
  if (env.aiKeys.length) {
    log.log(`AI keys detected: ${env.aiKeys.join(', ')}`);
  } else {
    log.warn(
      'NO AI KEY DETECTED. Add GEMINI_API_KEY to apps/api/.env and restart. ' +
        'Until then, missions can only be built from pasted text or an uploaded file.',
    );
  }
  log.log(`Database: ${env.database ? 'configured' : 'not set (in-memory)'} · SMTP: ${env.smtp ? 'configured' : 'not set'}`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal boot error:', e);
  process.exit(1);
});