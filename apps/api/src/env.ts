/**
 * Loads .env before anything else in the process reads process.env.
 *
 * This file MUST be the first import in main.ts. Nest does not read .env files
 * on its own, and several modules (throttler limits, CORS, the AI provider
 * chain) read environment variables at module-definition time — which happens
 * as soon as they are imported, before any bootstrap code runs.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

const candidates = [
  // running from apps/api (nest start) or from the repo root (node apps/api/dist/main.js)
  join(process.cwd(), '.env'),
  join(process.cwd(), 'apps', 'api', '.env'),
  resolve(__dirname, '..', '.env'),
  resolve(__dirname, '..', '..', '..', '.env'),
];

const loaded: string[] = [];
for (const path of [...new Set(candidates.map((c) => resolve(c)))]) {
  if (!existsSync(path)) continue;
  // First file wins for any given key; later files only fill gaps.
  loadEnv({ path, override: false });
  loaded.push(path);
}

export const envFilesLoaded = loaded;

export function envSummary() {
  const keys = [
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'OPENROUTER_API_KEY',
    'CEREBRAS_API_KEY',
    'MISTRAL_API_KEY',
  ];
  return {
    files: loaded,
    aiKeys: keys.filter((k) => Boolean(process.env[k]?.trim())),
    database: Boolean(process.env.DATABASE_URL?.trim()),
    smtp: Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim()),
  };
}
