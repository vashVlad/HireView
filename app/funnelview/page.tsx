"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import SourceIcon from "@/components/SourceIcon";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";
import type { FunnelCandidate, FunnelData } from "@/lib/funnelview/types";

// FunnelCandidate.source uses "inbound"/"outbound"/"agency" (kept distinct
// from lib/sourceType.ts's "applicant"/"linkedin"/"agency" naming to
// minimize churn across this file's many existing c.source checks — see
// lib/funnelview/types.ts). Maps to the shared SourceIcon's type for the
// table badge, 2026-07-20 (Vlad's ask — Applicant had no icon here, unlike
// ResultCard/Candidates/Pipeline which all show one via showApplicant).
function toSourceIconType(source: FunnelCandidate["source"]): "applicant" | "linkedin" | "agency" {
  if (source === "outbound") return "linkedin";
  if (source === "agency") return "agency";
  return "applicant";
}

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

// Three-way source split — Agency added 2026-07-20 (Vlad's ask) alongside
// Applied/Sourced (LinkedIn). Green (Applied) and red (Agency) match the
// SourceIcon fills used elsewhere on this page and on ResultCard/All
// Candidates/Pipeline; violet (Sourced/LinkedIn) is this bar's own accent,
// distinct from the LinkedIn-brand-blue SourceIcon uses for that same source.
function SourceSplit({ split }: { split: FunnelData["sourceSplit"] }) {
  const total = split.inbound + split.outbound + split.agency;
  const inboundPct = total > 0 ? Math.round((split.inbound / total) * 100) : 0;
  const outboundPct = total > 0 ? Math.round((split.outbound / total) * 100) : 0;
  const agencyPct = total > 0 ? Math.max(0, 100 - inboundPct - outboundPct) : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full bg-green-500" style={{ width: `${inboundPct}%` }} />
        <div className="h-full bg-violet-500" style={{ width: `${outboundPct}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${agencyPct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Applied
          <span className="font-semibold tabular-nums">{split.inbound.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Sourced (LinkedIn)
          <span className="font-semibold tabular-nums">{split.outbound.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Agency
          <span className="font-semibold tabular-nums">{split.agency.toLocaleString()}</span>
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
  interview: "Screening",
  archived: "Archived",
};

// "Past Stage" — 2026-07-20 fix. `previousTrackerStage` only exists once a
// candidate has actually entered the Tracker (TA/L1/L2/Offer/Reject) and
// moved between at least two of those stages, so it was always blank for
// anyone still in the pre-Tracker funnel (New Applicant → Recruiter Screen →
// Contacted → Screening) — even though those candidates clearly did come
// from somewhere. Falls back to `previousStatus` (trigger-maintained on
// every status UPDATE, same source as the funnel's own "Reached Out" logic
// in lib/funnelview/data.ts) so a candidate's most recent prior position
// shows regardless of whether that transition happened inside the Tracker
// or in the status pipeline before it.
function pastStageLabel(c: FunnelCandidate): string {
  if (c.previousTrackerStage) return c.previousTrackerStage;
  if (c.previousStatus && c.previousStatus !== c.status) {
    return STAGE_LABELS[c.previousStatus] ?? c.previousStatus;
  }
  return "—";
}

export default function FunnelViewPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | "">("");
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

  // Single selector drives the whole page — funnel, source split, candidate
  // table, and export all scope to whichever role (or "All roles") is picked
  // here, so there's one source of truth instead of separate filters drifting
  // out of sync with each other.
  const roleOptions = data ? [...data.byProject].sort((a, b) => a.projectName.localeCompare(b.projectName)) : [];
  const activeProject = data && selectedProjectId !== "" ? (data.byProject.find((p) => p.projectId === selectedProjectId) ?? null) : null;

  const activeCandidates = data
    ? selectedProjectId === "" ? data.candidates : data.candidates.filter((c) => c.projectId === selectedProjectId)
    : [];
  const activeStages = activeProject ? activeProject.stages : (data?.stages ?? []);
  const activeTotalScreened = activeProject ? activeProject.totalScreened : (data?.totalScreened ?? 0);
  const activeArchivedOrRejected = activeProject ? activeProject.archivedOrRejected : (data?.archivedOrRejected ?? 0);
  const activeSourceSplit = activeProject
    ? {
        inbound: activeCandidates.filter((c) => c.source === "inbound").length,
        outbound: activeCandidates.filter((c) => c.source === "outbound").length,
        agency: activeCandidates.filter((c) => c.source === "agency").length,
      }
    : (data?.sourceSplit ?? { inbound: 0, outbound: 0, agency: 0 });

  // Recruiter(s) working the active view — surfaced prominently in the Funnel
  // card header rather than only buried in the candidate table below. Added
  // 2026-07-15, Vlad's ask: "ensure the assigned recruiter is clearly visible
  // on the funnel view page." Dedup by email since a role can have candidates
  // screened by more than one recruiter (e.g. a handoff mid-role).
  const activeRecruiters = Array.from(
    new Map(
      activeCandidates
        .filter((c): c is typeof c & { recruiterEmail: string } => c.recruiterEmail != null)
        .map((c) => [c.recruiterEmail, c.recruiterEmail])
    ).values()
  ).sort();

  const filteredCandidates = activeCandidates.filter((c) => {
    if (!showArchived && (c.status === "archived" || c.trackerStage === "Reject")) return false;
    return true;
  });

  function handleExport() {
    if (!data) return;

    const summaryRows = activeStages.map((s) => ({
      Stage: s.label,
      Count: s.count,
      "% of Previous Stage": s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—",
    }));
    summaryRows.push({ Stage: "Archived/Rejected", Count: activeArchivedOrRejected, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Sourced (LinkedIn)", Count: activeSourceSplit.outbound, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Agency", Count: activeSourceSplit.agency, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Applied", Count: activeSourceSplit.inbound, "% of Previous Stage": "—" });
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 20 }];

    const candidateRows = activeCandidates.map((c) => {
      const archived = c.status === "archived" || c.trackerStage === "Reject";
      return {
        Name: c.candidateName,
        Role: c.projectName,
        Source: c.source === "outbound" ? "Sourced (LinkedIn)" : c.source === "agency" ? `Agency (${c.agencyName ?? "—"})` : "Applied",
        Score: c.score,
        "Current Stage": c.trackerStage ?? STAGE_LABELS[c.status] ?? c.status,
        // Past Stage stays in the Excel export only — Vlad's ask, 2026-07-20:
        // "don't show Past Stage on the Candidates tab on the FunnelView
        // page, keep it in the report and everywhere else." Removed from the
        // on-screen table below; this is now the only remaining place it renders.
        "Past Stage": pastStageLabel(c) === "—" ? "" : pastStageLabel(c),
        Recruiter: c.recruiterEmail ?? "",
        "Screened Date": new Date(c.createdAt).toLocaleDateString(),
        "Fraud Flags (Y/N)": c.hasFraudFlag ? "Y" : "N",
        "Archived (Y/N)": archived ? "Y" : "N",
      };
    });
    const candidateSheet = XLSX.utils.json_to_sheet(candidateRows);
    candidateSheet["!cols"] = [
      { wch: 24 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 18 }, { wch: 18 },
      { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, "Funnel Summary");

    // "All roles" gets a bonus per-project breakdown sheet, since that shape
    // of data only exists when nothing's filtered down to one role already.
    if (!activeProject) {
      const byProjectRows = data.byProject.flatMap((project) =>
        project.stages.map((s) => ({
          Role: project.projectName,
          "Total Screened (Role)": project.totalScreened,
          Stage: s.label,
          Count: s.count,
          "% of Previous Stage": s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—",
          "Archived/Rejected (Role)": project.archivedOrRejected,
        }))
      );
      const byProjectSheet = XLSX.utils.json_to_sheet(byProjectRows);
      byProjectSheet["!cols"] = [
        { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, byProjectSheet, "By Project");
    }

    XLSX.utils.book_append_sheet(wb, candidateSheet, activeProject ? "Candidates" : "All Candidates");

    const today = new Date().toISOString().slice(0, 10);
    const roleSlug = activeProject ? `_${activeProject.projectName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}` : "";
    XLSX.writeFile(wb, `FunnelView_Report${roleSlug}_${today}.xlsx`);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/funnelview" />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader
          icon={<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" strokeLinecap="round" strokeLinejoin="round" />}
          title="FunnelView"
          subtitle="Full candidate funnel, live from HireView data. Admin only."
          action={
            data ? (
              <div className="flex shrink-0 items-center gap-2">
                {roleOptions.length > 0 && (
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <option value="">All roles</option>
                    {roleOptions.map((project) => (
                      <option key={project.projectId} value={project.projectId}>
                        {project.projectName}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={handleExport}
                  className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
                >
                  Export Excel Report
                </button>
              </div>
            ) : undefined
          }
        />

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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Funnel {activeProject && <span className="font-normal text-zinc-400">— {activeProject.projectName}</span>}
                </h2>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">count · % of previous stage</span>
              </div>
              {activeRecruiters.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                    {activeRecruiters.length === 1 ? "Recruiter" : "Recruiters"}
                  </span>
                  {activeRecruiters.map((email) => (
                    <span
                      key={email}
                      title={email}
                      className="flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-1 pr-2.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(email)}`}
                      >
                        {avatarInitial(email)}
                      </span>
                      <span className="max-w-[10rem] truncate">{email}</span>
                    </span>
                  ))}
                </div>
              )}
              {activeTotalScreened === 0 && activeStages.every((s) => s.count === 0) ? (
                <p className="py-6 text-center text-sm text-zinc-400">
                  No screening activity yet{activeProject ? " for this role" : ""} — the funnel fills in as candidates are screened.
                </p>
              ) : (
                <StageBar stages={activeStages} />
              )}
              {activeArchivedOrRejected > 0 && (
                <p className="mt-4 border-t border-zinc-100 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  {activeArchivedOrRejected.toLocaleString()} candidate{activeArchivedOrRejected === 1 ? "" : "s"} archived or
                  rejected along the way — excluded from the bars above, counted at whichever stage they last reached.
                </p>
              )}
            </div>

            {/* Source split */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Sourced vs. Applied {activeProject && <span className="font-normal text-zinc-400">— {activeProject.projectName}</span>}
              </h2>
              {activeSourceSplit.inbound + activeSourceSplit.outbound + activeSourceSplit.agency === 0 ? (
                <p className="py-2 text-center text-sm text-zinc-400">No data yet.</p>
              ) : (
                <SourceSplit split={activeSourceSplit} />
              )}
            </div>

            {/* Candidate table */}
            <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Candidates {activeProject && <span className="font-normal text-zinc-400">— {activeProject.projectName}</span>}{" "}
                  <span className="font-normal text-zinc-400">({filteredCandidates.length})</span>
                </h2>
                <div className="flex items-center gap-2">
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
                        <td className="px-6 py-3 text-sm text-zinc-800 dark:text-zinc-200">
                          {c.projectId != null ? (
                            <Link
                              href={`/projects/${c.projectId}?tab=pipeline&candidate=${c.screeningId}`}
                              title="Open this candidate's result card"
                              className="hover:text-violet-600 hover:underline dark:hover:text-violet-400"
                            >
                              {c.candidateName}
                            </Link>
                          ) : (
                            c.candidateName
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">{c.projectName}</td>
                        <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                          {c.trackerStage ?? STAGE_LABELS[c.status] ?? c.status}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            title={c.source === "agency" ? `Agency: ${c.agencyName ?? "—"}` : undefined}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              c.source === "outbound"
                                ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400"
                                : c.source === "agency"
                                ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                                : "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                            }`}
                          >
                            <SourceIcon type={toSourceIconType(c.source)} agencyName={c.agencyName} size={11} showApplicant />
                            {c.source === "outbound" ? "Sourced" : c.source === "agency" ? (c.agencyName ?? "Agency") : "Applied"}
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
