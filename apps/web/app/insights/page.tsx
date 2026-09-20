'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, downloadExcel } from '@/lib/api';
import { useApp } from '@/lib/state';

/* Hand-rolled charts: no charting dependency, no bundle cost, full control of
   the dark palette. Every mark carries a label — colour never carries meaning
   on its own. */

function Bars({ data, x, y, height = 150 }: { data: any[]; x: string; y: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => Number(d[y]) || 0));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const v = Number(d[y]) || 0;
        return (
          <div key={i} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-accent/70 transition group-hover:bg-accent"
              style={{ height: `${(v / max) * (height - 24)}px`, minHeight: v > 0 ? 3 : 0 }}
            />
            <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-700 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-100 group-hover:block">
              {String(d[x]).slice(5)} · {v}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HBars({ data }: { data: Array<{ band: string; learners: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.learners));
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.band} className="grid grid-cols-[72px_1fr_28px] items-center gap-2">
          <span className="text-xs tabular-nums text-slate-400">{d.band}</span>
          <span className="h-4 overflow-hidden rounded bg-white/5">
            <span
              className="block h-full rounded bg-gradient-to-r from-accent to-good"
              style={{ width: `${(d.learners / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-slate-300">{d.learners}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-extrabold tabular-nums ${tone ?? 'text-slate-100'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function InsightsPage() {
  const { toast, user } = useApp();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [mailStatus, setMailStatus] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [tab, setTab] = useState<'learners' | 'missions' | 'audit'>('learners');

  const load = useCallback(
    async (d: number) => {
      try {
        const [dash, status] = await Promise.all([api.dashboard(d), api.reportStatus().catch(() => null)]);
        setData(dash);
        setMailStatus(status);
        if (status?.defaultRecipient && !emailTo) setEmailTo(status.defaultRecipient);
      } catch (e: any) {
        toast('error', e?.message ?? 'Could not load the dashboard.');
      }
    },
    [toast, emailTo],
  );

  useEffect(() => {
    void load(days);
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'audit' || audit.length) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/reports/audit`, {
      headers: { authorization: `Bearer ${localStorage.getItem('sabaq.token') ?? ''}` },
    })
      .then((r) => r.json())
      .then((rows) => setAudit(Array.isArray(rows) ? rows : []))
      .catch(() => setAudit([]));
  }, [tab, audit.length]);

  if (user && user.role !== 'admin') {
    return <p className="panel p-6 text-slate-300">This screen is for administrators.</p>;
  }
  if (!data) return <p className="p-6 text-slate-400">Loading insights…</p>;

  const o = data.overview;

  async function onDownload() {
    setBusy('excel');
    try {
      const name = await downloadExcel(days);
      toast('success', `Downloaded ${name}`);
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not generate the workbook.');
    } finally {
      setBusy('');
    }
  }

  async function onEmail() {
    setBusy('email');
    try {
      const res = await api.emailReport(days, emailTo || undefined);
      if (res.sent) toast('success', `Report emailed to ${res.to}`);
      else toast('info', res.reason ?? 'SMTP is not configured — the workbook still downloads.');
      void load(days);
    } catch (e: any) {
      toast('error', e?.message ?? 'Could not send the report.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Insights</h1>
          <p className="mt-1 text-sm text-slate-400">
            Learner, engagement, mastery, usage and outcome views · window of {data.windowDays} days ·
            storage: {data.storageMode}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="field w-auto"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Reporting window"
          >
            {[7, 14, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
          <button className="btn-ghost" onClick={onDownload} disabled={busy === 'excel'}>
            {busy === 'excel' ? 'Building…' : 'Download Excel'}
          </button>
          <button className="btn-primary" onClick={onEmail} disabled={busy === 'email'}>
            {busy === 'email' ? 'Sending…' : 'Email to admin'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-ink-800/60 px-4 py-2.5 text-xs">
        <span className={`chip ${mailStatus?.smtpConfigured ? 'bg-good/20 text-good' : 'bg-amber-400/15 text-amber-200'}`}>
          {mailStatus?.smtpConfigured ? 'SMTP configured' : 'SMTP not configured'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          Send to
          <input
            className="field w-64 py-1"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="admin@ubl.com.pk"
          />
        </label>
        <span className="text-slate-600">
          The workbook has seven sheets: summary, learners, engagement, mastery distribution, missions,
          AI providers and the configuration snapshot.
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Learners" value={o.learners} sub={`${o.activeToday} active today`} />
        <Stat
          label="Average inferred mastery"
          value={o.learnersWithEvidence ? `${Math.round(o.avgMastery * 100)}%` : '—'}
          sub={`${o.learnersWithEvidence} learner(s) with evidence`}
          tone="text-accent-soft"
        />
        <Stat label="Missions built" value={o.missionsBuilt} sub={`${o.stepsCompleted} steps completed`} />
        <Stat
          label="Grounded generations"
          value={`${Math.round(o.groundedRate * 100)}%`}
          sub={`${Math.round(o.degradedRate * 100)}% used the offline builder`}
          tone={o.groundedRate >= 0.9 ? 'text-good' : 'text-warn'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2">
          <h2 className="text-lg font-bold">Engagement</h2>
          <p className="mb-4 text-xs text-slate-500">Learning events per day across the window.</p>
          <Bars data={data.engagement} x="day" y="events" />
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/5 pt-4 text-center">
            <div>
              <p className="text-xs text-slate-500">Questions asked</p>
              <p className="text-xl font-bold tabular-nums">{o.questionsAsked}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Explanations graded</p>
              <p className="text-xl font-bold tabular-nums">{o.explanationsGraded}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Avg time on task</p>
              <p className="text-xl font-bold tabular-nums">{Math.round(o.avgTimeOnTaskSec / 60)}m</p>
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-lg font-bold">Mastery distribution</h2>
          <p className="mb-4 text-xs text-slate-500">Learners with enough evidence to score.</p>
          <HBars data={data.masteryDistribution} />

          <h3 className="mt-6 text-sm font-semibold text-slate-200">Gamification</h3>
          <dl className="mt-2 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Total XP awarded</dt>
              <dd className="tabular-nums text-slate-200">{o.totalXp}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Badges unlocked</dt>
              <dd className="tabular-nums text-slate-200">{o.badgesUnlocked}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Level-ups</dt>
              <dd className="tabular-nums text-slate-200">{o.levelUps}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Hints used</dt>
              <dd className="tabular-nums text-slate-200">{o.hintsUsed}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-bold">Efficiency &amp; reliability</h2>
        <p className="mb-4 text-xs text-slate-500">
          Which provider actually served each request, and what it cost in latency.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="API p50" value={`${data.runtime.latencyP50Ms} ms`} />
          <Stat label="API p95" value={`${data.runtime.latencyP95Ms} ms`} />
          <Stat
            label="API error rate"
            value={`${Math.round(data.runtime.errorRate * 100)}%`}
            tone={data.runtime.errorRate > 0.02 ? 'text-bad' : 'text-good'}
          />
          <Stat label="AI calls" value={data.runtime.aiCalls} sub={`${data.runtime.aiFailures} failed over to a backup`} />
        </div>

        {Object.keys(data.providerUse ?? {}).length > 0 && (
          <table className="mt-5 w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2">Provider</th>
                <th className="pb-2 text-right">Missions</th>
                <th className="pb-2 text-right">Avg latency</th>
                <th className="pb-2 text-right">Calls</th>
                <th className="pb-2 text-right">p95</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {Object.entries(data.providerUse).map(([p, v]: any) => (
                <tr key={p}>
                  <td className="py-2 capitalize text-slate-200">{p}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{v.journeys}</td>
                  <td className="py-2 text-right tabular-nums text-slate-300">{v.avgLatencyMs} ms</td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {data.runtime.ai?.[p]?.calls ?? 0}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {data.runtime.ai?.[p]?.p95 ?? 0} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="flex gap-1 border-b border-white/5 p-2">
          {(['learners', 'missions', 'audit'] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold capitalize transition ${
                tab === tb ? 'bg-accent/20 text-accent-soft' : 'text-slate-400 hover:bg-white/5'
              }`}
            >
              {tb === 'audit' ? 'Security log' : tb}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto p-1">
          {tab === 'learners' && (
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="p-3">Learner</th>
                  <th className="p-3">Type</th>
                  <th className="p-3 text-right">Level</th>
                  <th className="p-3 text-right">XP</th>
                  <th className="p-3 text-right">Mastery</th>
                  <th className="p-3 text-right">Steps</th>
                  <th className="p-3 text-right">Questions</th>
                  <th className="p-3 text-right">Hints</th>
                  <th className="p-3 text-right">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.learners.map((l: any) => (
                  <tr key={l.id} className="hover:bg-white/[0.03]">
                    <td className="p-3">
                      <p className="font-semibold text-slate-100">{l.name}</p>
                      <p className="text-xs text-slate-500">{l.email}</p>
                    </td>
                    <td className="p-3 text-slate-400">{l.learnerType}</td>
                    <td className="p-3 text-right tabular-nums">{l.level}</td>
                    <td className="p-3 text-right tabular-nums">{l.xp}</td>
                    <td className="p-3 text-right">
                      {l.hasEvidence ? (
                        <span
                          className={`font-semibold tabular-nums ${
                            l.mastery >= 0.7 ? 'text-good' : l.mastery >= 0.4 ? 'text-warn' : 'text-bad'
                          }`}
                        >
                          {Math.round(l.mastery * 100)}%
                        </span>
                      ) : (
                        <span className="text-xs italic text-slate-600">no evidence</span>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{l.stepsCompleted}</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{l.questionsAsked}</td>
                    <td className="p-3 text-right tabular-nums text-slate-400">{l.hintsUsed}</td>
                    <td className="p-3 text-right text-xs text-slate-500">
                      {l.lastActive ? new Date(l.lastActive).toLocaleString() : 'never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'missions' && (
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="p-3">Mission</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3 text-right">Latency</th>
                  <th className="p-3 text-center">Grounded</th>
                  <th className="p-3 text-right">Built</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.journeys.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      No missions built in this window yet. Use Live test to build one.
                    </td>
                  </tr>
                )}
                {data.journeys.map((j: any) => (
                  <tr key={j.id} className="hover:bg-white/[0.03]">
                    <td className="p-3 font-medium text-slate-100">{j.title}</td>
                    <td className="p-3 text-slate-400">{j.sourceName}</td>
                    <td className="p-3">
                      <span className="chip bg-white/5 capitalize text-slate-300">{j.provider}</span>
                    </td>
                    <td className="p-3 text-right tabular-nums text-slate-400">
                      {j.latencyMs ? `${(j.latencyMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`chip ${j.grounded ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad'}`}>
                        {j.grounded ? 'yes' : 'check'}
                      </span>
                    </td>
                    <td className="p-3 text-right text-xs text-slate-500">
                      {new Date(j.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'audit' && (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="p-3">When</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Network</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {audit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      No recorded actions yet.
                    </td>
                  </tr>
                )}
                {audit.map((a: any) => (
                  <tr key={a.id}>
                    <td className="p-3 text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="p-3 text-slate-200">{a.actor || '—'}</td>
                    <td className="p-3">
                      <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-300">{a.action}</code>
                    </td>
                    <td className="p-3">
                      <span className={`chip ${a.status === 'ok' ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad'}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-slate-500">{a.ip || 'masked'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="pb-4 text-center text-xs text-slate-600">
        Learner free-text is never stored in reports or the audit trail — only derived scores and counts.
        IP addresses are truncated to the network prefix before they are written.
      </p>
    </div>
  );
}
