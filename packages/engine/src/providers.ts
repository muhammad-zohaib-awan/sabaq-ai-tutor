import { withTimeout } from './util';

export interface CompletionRequest {
  system: string;
  user: string;
  json: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface AiProvider {
  id: string;
  available(): boolean;
  complete(req: CompletionRequest, timeoutMs: number): Promise<CompletionResult>;
}

const env = (k: string): string | undefined => {
  const v = typeof process !== 'undefined' ? process.env?.[k] : undefined;
  return v && v.trim() ? v.trim() : undefined;
};

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 200)}`);
  }
}

/* --------------------------------------------------------------- Gemini */

let geminiModelCache: string | null = null;

/**
 * Rank the models a key can actually use, best first.
 *
 * Naive "first flash model in the list" discovery is not enough: models.list
 * still advertises models that generateContent then rejects with 404 for newer
 * keys (gemini-2.5-flash did exactly this after it was retired for new users).
 * So we rank candidates, skip the ones that already failed, and work down the
 * list — a model retirement degrades to the next model instead of a dead demo.
 */
async function geminiCandidates(key: string, exclude: Set<string>): Promise<string[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) throw new Error(`model discovery failed: HTTP ${res.status}`);
  const data: any = await res.json();

  const score = (m: string): number => {
    const version = parseFloat(/gemini-(\d+(?:\.\d+)?)/.exec(m)?.[1] ?? '0');
    let s = version * 10;
    if (/flash/i.test(m)) s += 6; // fast and free-tier friendly
    if (/lite/i.test(m)) s += 1;
    if (/pro/i.test(m)) s += 2;
    if (/preview|exp|thinking/i.test(m)) s -= 8; // unstable, often gated
    if (/latest/i.test(m)) s += 1;
    return s;
  };

  return ((data.models ?? []) as any[])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((m) => !/embedding|aqa|image|imagen|tts|audio|live|vision|veo/i.test(m))
    .filter((m) => !exclude.has(m))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 5);
}

/** A different model may work: the one we asked for is gone, gated, or swamped. */
const TRY_ANOTHER_MODEL =
  /HTTP 40[034]|HTTP 429|HTTP 50[03]|not found|NOT_FOUND|no longer available|unsupported|PERMISSION_DENIED|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i;

/** Worth waiting a moment and asking the same model again. */
const TRANSIENT = /HTTP 429|HTTP 50[023]|UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Keep "thinking" minimal. Every generation here is structured writing, not
 * multi-step maths — hidden reasoning only adds seconds of latency and eats the
 * output budget. GEMINI_THINKING=on restores the model default.
 */
function geminiThinking(model: string): Record<string, unknown> | undefined {
  if (env('GEMINI_THINKING') === 'on') return undefined;
  if (/gemini-2\.5-flash/i.test(model)) return { thinkingBudget: 0 };
  if (/gemini-2\.5-pro/i.test(model)) return { thinkingBudget: 128 };
  if (/gemini-[3-9]/i.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

const gemini: AiProvider = {
  id: 'gemini',
  available: () => Boolean(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')),
  async complete(req, timeoutMs) {
    const key = (env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'))!;
    const started = Date.now();

    const call = async (model: string, withThinking = true) => {
      const thinking = withThinking ? geminiThinking(model) : undefined;
      const body: any = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          // Thinking models count their hidden reasoning against this budget.
          // Without headroom a "2-4 sentence" reply gets cut off mid-word.
          maxOutputTokens: (req.maxTokens ?? 4096) + (thinking ? 0 : 1024),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      };
      let data: any;
      try {
        data = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          body,
          // Header, not query string: keys in URLs end up in proxy and access logs.
          { 'x-goog-api-key': key },
        );
      } catch (e: any) {
        // Some models reject thinkingConfig. Retry once without it.
        if (thinking && /HTTP 400/.test(String(e?.message)) && /thinking/i.test(String(e?.message))) {
          return call(model, false);
        }
        throw e;
      }
      const cand = data?.candidates?.[0];
      const text: string =
        cand?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('') ?? '';
      if (!text) {
        const reason = cand?.finishReason ?? data?.promptFeedback?.blockReason;
        throw new Error(`gemini returned no text${reason ? ` (${reason})` : ''}`);
      }
      if (cand?.finishReason === 'MAX_TOKENS' && req.json) {
        // Truncated JSON is unparseable; let the chain try the next model/provider.
        throw new Error('gemini hit MAX_TOKENS before finishing the JSON');
      }
      geminiModelCache = model;
      return { text, provider: 'gemini', model, latencyMs: Date.now() - started };
    };

    const tried = new Set<string>();
    const first = env('GEMINI_MODEL') ?? geminiModelCache ?? 'gemini-3.6-flash';
    let lastError: Error | null = null;

    // Free-tier flash models get swamped at peak. One short backoff clears most
    // 503s without the learner noticing; anything worse moves to another model.
    for (const model of [first]) {
      tried.add(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await withTimeout(call(model), timeoutMs, 'gemini');
        } catch (e: any) {
          lastError = e;
          const msg = String(e?.message);
          if (attempt === 0 && TRANSIENT.test(msg)) {
            await sleep(900);
            continue;
          }
          if (!TRY_ANOTHER_MODEL.test(msg)) throw e;
          break;
        }
      }
    }

    // The configured model is gone or gated. Ask the key what it can actually run.
    let candidates: string[] = [];
    try {
      candidates = await geminiCandidates(key, tried);
    } catch (e: any) {
      throw new Error(`${lastError?.message ?? 'model rejected'} — and discovery failed: ${e?.message}`);
    }
    if (!candidates.length) {
      throw new Error(`${lastError?.message ?? 'model rejected'} — no alternative model is available on this key`);
    }

    for (const model of candidates) {
      tried.add(model);
      try {
        return await withTimeout(call(model), timeoutMs, 'gemini');
      } catch (e: any) {
        lastError = e;
        if (!TRY_ANOTHER_MODEL.test(String(e?.message))) throw e;
      }
    }

    throw new Error(
      `all Gemini models failed (tried ${[...tried].join(', ')}). Last error: ${lastError?.message}`,
    );
  },
};

/* ------------------------------------------- OpenAI-compatible providers */

function openAiCompatible(opts: {
  id: string;
  baseUrl: string;
  keyEnv: string[];
  defaultModel: string;
  modelEnv: string;
  extraHeaders?: Record<string, string>;
}): AiProvider {
  return {
    id: opts.id,
    available: () => opts.keyEnv.some((k) => Boolean(env(k))),
    async complete(req, timeoutMs) {
      const key = opts.keyEnv.map((k) => env(k)).find(Boolean)!;
      const model = env(opts.modelEnv) ?? opts.defaultModel;
      const started = Date.now();
      const body: any = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      };
      const data = await withTimeout(
        postJson(`${opts.baseUrl}/chat/completions`, body, {
          authorization: `Bearer ${key}`,
          ...(opts.extraHeaders ?? {}),
        }),
        timeoutMs,
        opts.id,
      );
      const text: string = data?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error(`${opts.id} returned no text`);
      return { text, provider: opts.id, model, latencyMs: Date.now() - started };
    },
  };
}

const groq = openAiCompatible({
  id: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: ['GROQ_API_KEY'],
  defaultModel: 'llama-3.3-70b-versatile',
  modelEnv: 'GROQ_MODEL',
});

const openrouterBase = openAiCompatible({
  id: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  keyEnv: ['OPENROUTER_API_KEY'],
  defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  modelEnv: 'OPENROUTER_MODEL',
  extraHeaders: {
    'HTTP-Referer': env('PUBLIC_WEB_URL') ?? 'https://sabaq.local',
    'X-Title': 'Sabaq Learning Engine',
  },
});

let openrouterFreeCache: string[] | null = null;

/**
 * OpenRouter's ":free" line-up rotates, so a hardcoded model id ages badly —
 * the same failure mode that just retired gemini-2.5-flash. Ask the catalogue
 * which free models exist right now and work down the list.
 */
async function openrouterFreeModels(key: string): Promise<string[]> {
  if (openrouterFreeCache) return openrouterFreeCache;
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`model list failed: HTTP ${res.status}`);
  const data: any = await res.json();
  const free = ((data.data ?? []) as any[])
    .filter((m) => String(m.id).endsWith(':free'))
    .filter((m) => Number(m.context_length ?? 0) >= 16000)
    .filter((m) => !/vision|image|audio|embed/i.test(String(m.id)))
    .sort((a, b) => Number(b.context_length ?? 0) - Number(a.context_length ?? 0))
    .map((m) => String(m.id))
    .slice(0, 5);
  if (free.length) openrouterFreeCache = free;
  return free;
}

const openrouter: AiProvider = {
  id: 'openrouter',
  available: openrouterBase.available,
  async complete(req, timeoutMs) {
    try {
      return await openrouterBase.complete(req, timeoutMs);
    } catch (e: any) {
      if (env('OPENROUTER_MODEL') || !TRY_ANOTHER_MODEL.test(String(e?.message))) throw e;
      const key = env('OPENROUTER_API_KEY')!;
      const models = await openrouterFreeModels(key);
      let last = e;
      for (const model of models) {
        try {
          process.env.OPENROUTER_MODEL = model;
          const r = await openrouterBase.complete(req, timeoutMs);
          return r;
        } catch (err: any) {
          last = err;
          delete process.env.OPENROUTER_MODEL;
        }
      }
      delete process.env.OPENROUTER_MODEL;
      throw new Error(`all free OpenRouter models failed. Last: ${last?.message}`);
    }
  },
};

const cerebras = openAiCompatible({
  id: 'cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
  keyEnv: ['CEREBRAS_API_KEY'],
  defaultModel: 'llama-3.3-70b',
  modelEnv: 'CEREBRAS_MODEL',
});

/**
 * GitHub Models: free with nothing but a GitHub personal access token that has
 * the Models:read scope. No credit card, no separate signup — which makes it the
 * most reliable backup to hand someone who already has a GitHub account.
 */
const githubModels = openAiCompatible({
  id: 'github',
  baseUrl: env('GITHUB_MODELS_BASE_URL') ?? 'https://models.inference.ai.azure.com',
  keyEnv: ['GITHUB_MODELS_TOKEN', 'GITHUB_TOKEN'],
  defaultModel: 'gpt-4o-mini',
  modelEnv: 'GITHUB_MODELS_MODEL',
});

const mistral = openAiCompatible({
  id: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  keyEnv: ['MISTRAL_API_KEY'],
  defaultModel: 'mistral-small-latest',
  modelEnv: 'MISTRAL_MODEL',
});

export const PROVIDERS: Record<string, AiProvider> = {
  gemini,
  groq,
  openrouter,
  cerebras,
  github: githubModels,
  mistral,
};

export interface ChainAttempt {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ChainResult extends CompletionResult {
  attempts: ChainAttempt[];
}

/**
 * Walk the configured provider order, first success wins. Every attempt is
 * recorded so the admin dashboard can show which provider actually served a
 * request and what it cost in latency.
 */
export async function completeWithFallback(
  req: CompletionRequest,
  order: string[],
  timeoutMs: number,
  log?: (msg: string) => void,
  /** Optional sink so a caller can read the failures even when nothing succeeds. */
  sink?: ChainAttempt[],
): Promise<ChainResult | null> {
  const attempts: ChainAttempt[] = sink ?? [];
  for (const id of order) {
    if (id === 'offline') break;
    const p = PROVIDERS[id];
    if (!p) continue;
    if (!p.available()) {
      attempts.push({ provider: id, ok: false, latencyMs: 0, error: 'no api key configured' });
      continue;
    }
    const t0 = Date.now();
    try {
      const out = await p.complete(req, timeoutMs);
      attempts.push({ provider: id, ok: true, latencyMs: out.latencyMs });
      return { ...out, attempts };
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 200);
      attempts.push({ provider: id, ok: false, latencyMs: Date.now() - t0, error: msg });
      log?.(`[ai] provider ${id} failed: ${msg}`);
    }
  }
  return null;
}

/**
 * Makes one tiny real call per configured provider and reports exactly what
 * came back. This is the difference between "it doesn't work" and a fix.
 */
export async function testProviders(order: string[], timeoutMs = 15000) {
  const out: Array<{ provider: string; configured: boolean; ok: boolean; model?: string; latencyMs?: number; error?: string }> = [];
  for (const id of order) {
    if (id === 'offline') continue;
    const p = PROVIDERS[id];
    if (!p) continue;
    if (!p.available()) {
      out.push({ provider: id, configured: false, ok: false, error: 'no API key set' });
      continue;
    }
    try {
      const r = await p.complete(
        { system: 'Reply with the single word OK.', user: 'Say OK.', json: false, maxTokens: 8, temperature: 0 },
        timeoutMs,
      );
      out.push({ provider: id, configured: true, ok: true, model: r.model, latencyMs: r.latencyMs });
    } catch (e: any) {
      out.push({ provider: id, configured: true, ok: false, error: String(e?.message ?? e).slice(0, 400) });
    }
  }
  return out;
}

export function providerStatus(order: string[]) {
  return order
    .filter((id) => id !== 'offline')
    .map((id) => ({
      id,
      configured: PROVIDERS[id]?.available() ?? false,
    }));
}
