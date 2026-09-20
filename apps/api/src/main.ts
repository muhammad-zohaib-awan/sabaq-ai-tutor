// MUST stay first: modules read process.env at import time.
import { envFilesLoaded, envSummary } from './env';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bodyParser: true });

  app.use(
    helmet({
      // The API serves JSON and file downloads only; no HTML, so no CSP surface.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, cb) => {
      // Same-origin/server-to-server requests arrive with no Origin header.
      if (!origin) return cb(null, true);
      if (origins.includes('*') || origins.includes(origin)) return cb(null, true);
      // Allow Vercel preview deployments of this project without hardcoding hashes.
      if (process.env.ALLOW_VERCEL_PREVIEWS === 'true' && /\.vercel\.app$/.test(new URL(origin).hostname)) {
        return cb(null, true);
      }
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
