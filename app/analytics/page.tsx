"use client";

import { useEffect, useState, useCallback } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";

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

// Matches the stat-card pattern from the admin/users redesign: soft accent
// wash on hover + a small lift, rather than a flat static box.
function StatCard({
  label, value, sub, icon, accent,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${accent}`} />
      <div className="relative flex items-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={accent.split(" ").slice(-2).join(" ")}>
          {icon}
        </svg>
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      </div>
      <p className="relative mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</p>
      {sub && <p className="relative mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</p>}
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

function formatShortDate(iso: string) {
  // iso is "YYYY-MM-DD" — parse manually rather than `new Date(iso)` to
  // avoid UTC/local timezone drift shifting the displayed day by one.
  const [, m, d] = iso.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function ActivityLine({ data }: { data: { date: string; count: number; avgScore: number }[] }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  if (data.length === 0) return <p className="py-4 text-center text-sm text-zinc-400">No activity in range.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1" style={{ height: "5rem" }}>
      {data.map((d, i) => (
        <div
          key={d.date}
          className="relative flex h-full flex-1 flex-col items-center justify-end"
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {hoveredIdx === i && (
            <div
              role="tooltip"
              className="absolute bottom-full left-1/2 z-20 mb-1.5 w-max -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
            >
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">{d.count} screened</p>
              {d.avgScore > 0 && (
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500">avg {d.avgScore}</p>
              )}
            </div>
          )}
          <div
            className={`w-full rounded-t transition-colors ${
              hoveredIdx === i
                ? "bg-violet-500 dark:bg-violet-400"
                : "bg-violet-400/60 dark:bg-violet-500/50"
            }`}
            style={{ height: `${Math.round((d.count / max) * 60)}px`, minHeight: "2px" }}
          />
          <span className="mt-1 whitespace-nowrap text-[9px] leading-none text-zinc-400 dark:text-zinc-500">
            {formatShortDate(d.date)}
          </span>
        </div>
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

      <main className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader
          icon={<><path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" /><path d="M18 17V9M13 17V5M8 17v-3" strokeLinecap="round" strokeLinejoin="round" /></>}
          title="Analytics"
          subtitle="Team-wide screening activity. Admin only."
          action={
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
          }
        />

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
                icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" /></>}
                accent="from-violet-500/10 to-transparent text-violet-600 dark:text-violet-400"
              />
              <StatCard
                label="Passed to pipeline"
                value={data.passedToPipeline.toLocaleString()}
                sub={data.totalScreened > 0 ? `${data.passRate}% pass rate` : "no data yet"}
                icon={<path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />}
                accent="from-emerald-500/10 to-transparent text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                label="Filtered out"
                value={(data.totalScreened - data.passedToPipeline).toLocaleString()}
                sub="recruiter never saw these"
                icon={<><circle cx="12" cy="12" r="10" /><path d="M8 12h8" strokeLinecap="round" /></>}
                accent="from-rose-500/10 to-transparent text-rose-600 dark:text-rose-400"
              />
              <StatCard
                label="Time saved"
                value={timeSavedHours > 0 ? `~${timeSavedHours}h` : "—"}
                sub="@ 15 min per resume"
                icon={<path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />}
                accent="from-sky-500/10 to-transparent text-sky-600 dark:text-sky-400"
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
