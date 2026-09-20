'use client';

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TOKEN_KEY = 'sabaq.token';
const USER_KEY = 'sabaq.user';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'learner';
  xp: number;
  badges: string[];
  learnerType?: string;
}

export const session = {
  token(): string {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  user(): SessionUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },
  set(token: string, user: SessionUser) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* private mode — session lives in memory for this tab only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Set when a call has fallen through to the local engine route. Drives the UI banner. */
let degradedSince: number | null = null;
export const isDegraded = () => degradedSince !== null;
export const markHealthy = () => (degradedSince = null);
export const markDegraded = () => (degradedSince = Date.now());

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 45000);
  const token = session.token();

  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 401) {
      session.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError('Session expired.', 401);
    }

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? message);
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(message, res.status);
    }

    markHealthy();
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the Nest API, and on a transport failure (asleep free-tier container,
 * network drop) retries against the Next.js route that runs the same shared
 * engine in-process. The learner keeps learning; the UI shows a degraded chip.
 */
async function requestWithLocalFallback<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number },
  localPath: string,
): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (e: any) {
    const transportFailure = !(e instanceof ApiError) || e.status >= 500;
    if (!transportFailure) throw e;
    const res = await fetch(`/api/engine${localPath}`, {
      method: init.method ?? 'POST',
      headers: init.body instanceof FormData ? undefined : { 'content-type': 'application/json' },
      body: init.body as any,
    });
    if (!res.ok) throw e;
    markDegraded();
    return (await res.json()) as T;
  }
}

export const api = {
  /* auth */
  demoLogin: (role: 'admin' | 'learner') =>
    request<{ token: string; user: SessionUser }>('/auth/demo', {
      method: 'POST',
      body: JSON.stringify({ role }),
      timeoutMs: 60000,
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      timeoutMs: 60000,
    }),
  me: () => request<SessionUser>('/auth/me'),

  /* learning */
  sample: () => request<any>('/learn/sample'),
  journey: (id: string) => request<any>(`/learn/journey/${id}`),
  state: (journeyId?: string) =>
    request<any>(`/learn/state${journeyId ? `?journeyId=${encodeURIComponent(journeyId)}` : ''}`),

  build: (payload: FormData | Record<string, unknown>) =>
    requestWithLocalFallback<any>(
      '/learn/journey',
      {
        method: 'POST',
        body: payload instanceof FormData ? payload : JSON.stringify(payload),
        timeoutMs: 90000,
      },
      '/journey',
    ),

  sim: (journeyId: string, body: unknown) =>
    request<any>(`/learn/${journeyId}/sim`, { method: 'POST', body: JSON.stringify(body) }),
  ask: (journeyId: string, body: unknown) =>
    requestWithLocalFallback<any>(
      `/learn/${journeyId}/ask`,
      { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000 },
      '/ask',
    ),
  explain: (journeyId: string, body: unknown) =>
    requestWithLocalFallback<any>(
      `/learn/${journeyId}/explain`,
      { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000 },
      '/explain',
    ),
  hint: (journeyId: string, stepId: string, elementId: string) =>
    request<any>(`/learn/${journeyId}/hint`, {
      method: 'POST',
      body: JSON.stringify({ stepId, elementId }),
    }),
  selfCorrect: (journeyId: string, stepId: string, note: string) =>
    request<any>(`/learn/${journeyId}/self-correct`, {
      method: 'POST',
      body: JSON.stringify({ stepId, note }),
    }),
  complete: (journeyId: string, body: unknown) =>
    request<any>(`/learn/${journeyId}/complete`, { method: 'POST', body: JSON.stringify(body) }),
  event: (body: unknown) =>
    request<any>('/learn/event', { method: 'POST', body: JSON.stringify(body) }).catch(() => null),

  /* admin */
  config: () => request<any>('/config'),
  saveConfig: (patch: Record<string, unknown>) =>
    request<any>('/config', { method: 'PUT', body: JSON.stringify({ patch }) }),
  resetConfig: () => request<any>('/config/reset', { method: 'POST' }),
  providers: () => request<any>('/config/providers'),
  dashboard: (days: number, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ days: String(days), ...extra });
    return request<any>(`/analytics/dashboard?${q}`);
  },
  reportStatus: () => request<any>('/reports/status'),
  emailReport: (days: number, to?: string) =>
    request<any>('/reports/email', { method: 'POST', body: JSON.stringify({ days, to }), timeoutMs: 90000 }),
  excelUrl: (days: number) => `${API_BASE}/api/reports/excel?days=${days}`,

  health: () => request<any>('/health', { timeoutMs: 8000 }),
  ready: () => request<any>('/health/ready', { timeoutMs: 8000 }),
};

/** Excel download needs the bearer token, so fetch as a blob rather than a plain link. */
export async function downloadExcel(days: number) {
  const res = await fetch(api.excelUrl(days), {
    headers: { authorization: `Bearer ${session.token()}` },
  });
  if (!res.ok) throw new ApiError('Could not generate the report.', res.status);
  const blob = await res.blob();
  const name =
    res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] ??
    `sabaq-report-${days}d.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}
