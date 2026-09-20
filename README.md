# Sabaq — AI Learning Experience Engine

Turns any document or topic into an adaptive, voice-enabled, three-beat learning mission, and infers
mastery from what the learner **does** rather than from a test.

Built for the UBL *Digital HR & AI Manager* candidate assignment.

---

## Run it in three commands

```bash
npm install
cp apps/api/.env.example apps/api/.env        # already done in this zip
cp apps/web/.env.example apps/web/.env.local  # already done in this zip
npm run dev
```

Frontend on **http://localhost:3000**, API on **http://localhost:4000**.

On the sign-in screen press **Enter as Learner** or **Enter as Admin** — no password needed.

**It runs with zero configuration.** No database, no API key, nothing. The engine falls back to
in-memory storage and a deterministic offline mission builder, and says so honestly in the UI. Add a
`DATABASE_URL` and a `GEMINI_API_KEY` to turn on persistence and model generation.

---

## What is actually in here

```
packages/engine/   The learning engine. Framework-free TypeScript, imported by BOTH apps.
                   Journey generation, the AI provider chain, grounding checks,
                   mastery inference, adaptation policy, XP and badges.
apps/api/          NestJS + TypeORM. Auth, content ingest, journeys, analytics,
                   Excel reporting, email, audit log, rate limiting, health.
apps/web/          Next.js 14 App Router + Tailwind. Learn / Configure / Insights.
```

The engine living in its own package is the reason the demo cannot die: if the API is asleep on a
free tier or the network drops, the frontend retries against a Next.js route that runs **the same
engine** in-process and shows a "degraded" chip instead of an error screen.

---

## The problem this solves, and how

A learner can bring **any** topic. No model can reliably invent a bespoke interaction per topic, and
a quiz is not a learning experience. So the interactions live in code as a small palette, and the
model only supplies data for them.

| Mechanic | Chosen when the source is… | What the learner does |
|---|---|---|
| **Sort** | anything — the safe default | Commits each item to one of two states, then runs it |
| **Order** | a process, protocol or workflow | Drags the steps into the sequence they really happen in |
| **Decide** | a policy, rule set or risk judgement | Picks an action and watches consequence meters move |
| **Trace** | a system that passes something along | Predicts where the real work happens, then watches it flow |

Beats 2 and 3 — **role-play with the case** and **explain it back** — work on any content and never
change, so there is always a complete experience even if every mechanic validator rejects the model's
output.

**The model chooses, the code validates.** If it says "order" but gives four items and five positions,
the schema rejects it and the step falls back to Sort. There is no mechanic the model can break.

**Nothing numeric is invented.** Meters move by whole integers the model wrote down explicitly —
there is no rule table, no formula, and nothing is `eval`-ed. Invented arithmetic is the failure mode
the grounding check exists to catch, so the engine never creates a second source of it.

### Assessment without tests

Six weak signals, each with its own evidence count: explain-back quality, decisions in the simulation,
working without hints, self-correction, whether stated confidence matched actual accuracy, and recall
after a break. The weighted mean is shrunk toward a 0.5 prior by the evidence available, so a learner
who has done nothing reads **"no evidence yet"** rather than a fabricated 50%. Every number opens a
**"Why this number?"** panel showing the arithmetic. Weights are editable in Configure.

### AI provider chain

`Gemini → Groq → OpenRouter → Cerebras → Mistral → deterministic offline builder`

First key that answers within the timeout wins. Every attempt is recorded, and Insights shows which
provider served each mission and what it cost in latency. Gemini model IDs are auto-discovered if the
configured one 404s, so a model rename cannot kill a live demo.

---

## Security

Server-side role checks on every route (learner cannot reach admin data — verified), JWT with
configurable TTL, bcrypt password hashing, `@nestjs/throttler` rate limits (tighter on auth and
generation), `class-validator` on every DTO, Helmet, a CORS allowlist, magic-byte file type checking
with a size cap, and prompt-injection stripping on all learner and source text before it reaches a
model. Grading happens server-side, so the correct answers never reach the browser before the learner
commits. An audit log records sign-ins, configuration changes and data exports, with IP addresses
truncated to the network prefix. Learner free text is never written to reports or the audit trail —
only derived scores and counts.

---

## Admin reporting

**Insights** → `Download Excel` produces a seven-sheet workbook (summary, learners, engagement,
mastery distribution, missions, AI providers, configuration snapshot). `Email to admin` sends the same
workbook via Nodemailer. Without SMTP credentials it returns exactly what *would* have been sent, so
the feature is demonstrable on an unconfigured deployment.

Gmail: enable 2FA → create an App Password → paste it as `SMTP_PASS`.

---

## Deploying free

| Piece | Where | Notes |
|---|---|---|
| Frontend | **Vercel** | Root = repo root, build `npm run build:web`, output `apps/web/.next` |
| API | **Render** free web service | Build `npm install && npm run build:api`, start `npm run start:api` |
| Database | **Supabase** free | Connection string → `DATABASE_URL`, append `?sslmode=require` |

Set `CORS_ORIGINS` on the API to your Vercel URL, and `NEXT_PUBLIC_API_URL` on Vercel to your Render
URL. Render's free tier sleeps after 15 minutes — point a free **cron-job.org** ping at
`https://your-api.onrender.com/api/health` every 10 minutes so it is warm when the panel arrives.

---

## Endpoints worth knowing

```
GET  /api/health              liveness + whether storage is degraded (keep-alive target)
GET  /api/health/metrics      p50/p95 latency, error rate, per-provider AI stats
POST /api/auth/demo           one-click role sign-in
POST /api/learn/journey       the live test: file or text in, playable mission out
POST /api/learn/:id/sim       grades whichever mechanic the step runs
POST /api/learn/:id/ask       role-play turn, answered only from the source
POST /api/learn/:id/explain   grades an explanation against the rubric
GET  /api/reports/excel       the workbook  (admin)
GET  /api/reports/audit       the security trail  (admin)
```
