"use client";

import { useEffect, useState, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";

interface AnalyticsData {
  totalScreened: number;
  passedToPipeline: number;
  passRate: number;
  avgScore: number;
  timeSavedMinutes: number;
  scoreDistribution: { label: string; count: number }[];
  byProject: { projectId: number; name: string; count: number; avgScore: number }[];
  byRecruiter: { userId: string; email: string; count: number }[];
  recentActivity: { date: string; count: number; avgScore: number }[];
  recruiterList: { id: string; email: string; role: string }[];
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</span>
      {sub && <span className="text-xs text-zinc-400 dark:text-zinc-500">{sub}</span>}
    </div>
  );
}

function BarChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
            {d.count}
          </span>
          <div
            className="w-full rounded-t-md bg-violet-500 dark:bg-violet-600 transition-all"
            style={{ height: `${Math.round((d.count / max) * 96)}px`, minHeight: d.count > 0 ? "4px" : "0" }}
          />
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityLine({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) return <p className="py-4 text-center text-sm text-zinc-400">No activity in range.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-20">
      {data.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count} screened`}
          className="flex-1 rounded-t bg-violet-400/60 dark:bg-violet-500/50 hover:bg-violet-500 dark:hover:bg-violet-400 transition-colors"
          style={{ height: `${Math.round((d.count / max) * 72)}px`, minHeight: "2px" }}
        />
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recruiterId, setRecruiterId] = useState("");

  // Default date range: last 90 days
  const defaultFrom = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    if (recruiterId) params.set("recruiterId", recruiterId);
    const res = await fetch(`/api/analytics?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Error ${res.status}`);
      setLoading(false);
      return;
    }
    setData(await res.json());
    setLoading(false);
  }, [from, to, recruiterId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const timeSavedHours = data ? Math.round(data.timeSavedMinutes / 60) : 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/analytics" />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Analytics</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Team-wide screening activity. Admin only.
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {data && data.recruiterList.length > 1 && (
              <select
                value={recruiterId}
                onChange={(e) => setRecruiterId(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="">All recruiters</option>
                {data.recruiterList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.email}
                  </option>
                ))}
              </select>
            )}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" />
            <span className="text-zinc-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" />
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            {error === "Forbidden"
              ? "This page is only accessible to admins."
              : error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        ) : data && (
          <div className="flex flex-col gap-8">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Resumes screened"
                value={data.totalScreened.toLocaleString()}
                sub="total processed by AI"
              />
              <StatCard
                label="Passed to pipeline"
                value={data.passedToPipeline.toLocaleString()}
                sub={data.totalScreened > 0 ? `${data.passRate}% pass rate` : "no data yet"}
              />
              <StatCard
                label="Filtered out"
                value={(data.totalScreened - data.passedToPipeline).toLocaleString()}
                sub="recruiter never saw these"
              />
              <StatCard
                label="Time saved"
                value={timeSavedHours > 0 ? `~${timeSavedHours}h` : "—"}
                sub="@ 15 min per resume"
              />
            </div>

            {/* Score distribution */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Score distribution</h2>
              <BarChart data={data.scoreDistribution} />
            </div>

            {/* Daily activity */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Daily activity</h2>
              <ActivityLine data={data.recentActivity} />
              <p className="mt-2 text-xs text-zinc-400">Each bar = one calendar day</p>
            </div>

            {/* By project */}
            {data.byProject.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                  <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">By role</h2>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 text-left">
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Role</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 text-right">Screened</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 text-right">Avg score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.byProject.map((p) => (
                      <tr key={p.projectId}>
                        <td className="px-6 py-3 text-sm text-zinc-800 dark:text-zinc-200">{p.name}</td>
                        <td className="px-6 py-3 text-sm tabular-nums text-zinc-600 dark:text-zinc-400 text-right">{p.count}</td>
                        <td className="px-6 py-3 text-sm tabular-nums font-medium text-zinc-800 dark:text-zinc-200 text-right">{p.avgScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* By recruiter (only shown if multiple recruiters) */}
            {data.byRecruiter.length > 1 && (
              <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                  <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">By recruiter</h2>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800 text-left">
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Recruiter</th>
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 text-right">Screened</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.byRecruiter.map((r) => (
                      <tr key={r.userId}>
                        <td className="px-6 py-3 text-sm text-zinc-800 dark:text-zinc-200">{r.email}</td>
                        <td className="px-6 py-3 text-sm tabular-nums text-zinc-600 dark:text-zinc-400 text-right">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
