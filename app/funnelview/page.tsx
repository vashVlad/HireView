"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { SiteHeader } from "@/components/SiteHeader";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";
import type { FunnelData } from "@/lib/funnelview/types";

function StageBar({ stages }: { stages: FunnelData["stages"] }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  return (
    <div className="flex flex-col gap-3">
      {stages.map((s) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.label}</span>
          <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-lg bg-violet-500 dark:bg-violet-600 transition-all"
              style={{ width: `${Math.max((s.count / max) * 100, s.count > 0 ? 2 : 0)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
            {s.count.toLocaleString()}
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
            {s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function SourceSplit({ split }: { split: FunnelData["sourceSplit"] }) {
  const total = split.inbound + split.outbound;
  const inboundPct = total > 0 ? Math.round((split.inbound / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full bg-blue-500" style={{ width: `${inboundPct}%` }} />
        <div className="h-full bg-violet-500" style={{ width: `${100 - inboundPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Inbound
          <span className="font-semibold tabular-nums">{split.inbound.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Outbound (LinkedIn)
          <span className="font-semibold tabular-nums">{split.outbound.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  new_applicant: "New Applicant",
  recruiter_screen: "Recruiter Screen",
  contacted: "Contacted",
  screening: "Screening",
  interview: "Interview",
  archived: "Archived",
};

export default function FunnelViewPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/funnelview");
      if (cancelled) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Error ${res.status}`);
        setLoading(false);
        return;
      }
      setData(await res.json());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectNames = data
    ? Array.from(new Set(data.candidates.map((c) => c.projectName))).sort()
    : [];

  const filteredCandidates = data
    ? data.candidates.filter((c) => {
        if (projectFilter && c.projectName !== projectFilter) return false;
        if (!showArchived && (c.status === "archived" || c.trackerStage === "Reject")) return false;
        return true;
      })
    : [];

  function handleExport() {
    if (!data) return;

    const summaryRows = data.stages.map((s) => ({
      Stage: s.label,
      Count: s.count,
      "% of Previous Stage": s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—",
    }));
    summaryRows.push({ Stage: "Archived/Rejected", Count: data.archivedOrRejected, "% of Previous Stage": "—" });
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 20 }];

    const candidateRows = data.candidates.map((c) => {
      const archived = c.status === "archived" || c.trackerStage === "Reject";
      return {
        Name: c.candidateName,
        Source: c.source === "outbound" ? "Outbound" : "Inbound",
        Score: c.score,
        "Current Stage": c.trackerStage ?? STAGE_LABELS[c.status] ?? c.status,
        "Previous Stage": c.previousTrackerStage ?? "",
        Recruiter: c.recruiterEmail ?? "",
        "Screened Date": new Date(c.createdAt).toLocaleDateString(),
        "Fraud Flags (Y/N)": c.hasFraudFlag ? "Y" : "N",
        "Archived (Y/N)": archived ? "Y" : "N",
      };
    });
    const candidateSheet = XLSX.utils.json_to_sheet(candidateRows);
    candidateSheet["!cols"] = [
      { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 18 }, { wch: 18 },
      { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Funnel Summary");
    XLSX.utils.book_append_sheet(wb, candidateSheet, "All Candidates");

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `FunnelView_Report_${today}.xlsx`);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/funnelview" />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">FunnelView</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Full candidate funnel, live from HireView data. Admin only.
            </p>
          </div>
          {data && (
            <button
              onClick={handleExport}
              className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
            >
              Export Excel Report
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            {error === "Forbidden" ? "This page is only accessible to admins." : error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-4">
            <div className="h-80 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-40 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ) : data && (
          <div className="flex flex-col gap-8">
            {/* Funnel */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Funnel</h2>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">count · % of previous stage</span>
              </div>
              {data.totalScreened === 0 && data.stages.every((s) => s.count === 0) ? (
                <p className="py-6 text-center text-sm text-zinc-400">
                  No screening activity yet — the funnel fills in as candidates are screened.
                </p>
              ) : (
                <StageBar stages={data.stages} />
              )}
              {data.archivedOrRejected > 0 && (
                <p className="mt-4 border-t border-zinc-100 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  {data.archivedOrRejected.toLocaleString()} candidate{data.archivedOrRejected === 1 ? "" : "s"} archived or
                  rejected along the way — excluded from the bars above, counted at whichever stage they last reached.
                </p>
              )}
            </div>

            {/* Source split */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Source split</h2>
              {data.sourceSplit.inbound + data.sourceSplit.outbound === 0 ? (
                <p className="py-2 text-center text-sm text-zinc-400">No data yet.</p>
              ) : (
                <SourceSplit split={data.sourceSplit} />
              )}
            </div>

            {/* Candidate table */}
            <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Candidates <span className="font-normal text-zinc-400">({filteredCandidates.length})</span>
                </h2>
                <div className="flex items-center gap-2">
                  {projectNames.length > 1 && (
                    <select
                      value={projectFilter}
                      onChange={(e) => setProjectFilter(e.target.value)}
                      className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      <option value="">All roles</option>
                      {projectNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                      className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600"
                    />
                    Show archived/rejected
                  </label>
                </div>
              </div>

              {filteredCandidates.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-zinc-400">No candidates match this filter.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left dark:border-zinc-800">
                      <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Candidate</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Role</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Stage</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Source</th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Recruiter</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredCandidates.map((c) => (
                      <tr key={c.screeningId}>
                        <td className="px-6 py-3 text-sm text-zinc-800 dark:text-zinc-200">{c.candidateName}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">{c.projectName}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {c.trackerStage ?? STAGE_LABELS[c.status] ?? c.status}
                          {c.previousTrackerStage && c.trackerStage && c.previousTrackerStage !== c.trackerStage && (
                            <span className="ml-1.5 text-xs text-zinc-400">
                              (from {c.previousTrackerStage})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              c.source === "outbound"
                                ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                            }`}
                          >
                            {c.source === "outbound" ? "Outbound" : "Inbound"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {c.recruiterEmail ? (
                            <span className="flex items-center gap-2" title={c.recruiterEmail}>
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(c.recruiterEmail)}`}
                              >
                                {avatarInitial(c.recruiterEmail)}
                              </span>
                              <span className="truncate">{c.recruiterEmail}</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
