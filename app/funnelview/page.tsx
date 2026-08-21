"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import SourceIcon from "@/components/SourceIcon";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";
import type { FunnelCandidate, FunnelData } from "@/lib/funnelview/types";
import { candidateMatchesStageKey } from "@/lib/funnelview/stageMatch";

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

// Stacked-by-source bars, added 2026-07-27 (Vlad's ask: "combine sourced/
// applied/agency [into] the main funnel... so it's easier to track stages
// for those sources with the main funnel stages") — replaces the old flat
// single-color bar. Each stage's segment widths are proportional to that
// stage's own bySource split (not the overall max), so within one bar the
// three colors always show that stage's actual source mix; segment order
// (Applied, Sourced, Agency) and colors match the legend above and the old
// standalone SourceSplit component this replaces.
//
// Hover tooltip, added 2026-07-27 (Vlad's ask: "an interactive field that
// pops up when I put a mouseover the funnel rows") — replaces the native
// `title` attribute (slow to appear, unstyled, can't show more than one line
// well) with a real on-hover popover, same pattern as this page's own
// ActivityLine tooltip on the Analytics page (hoveredIdx state, absolute-
// positioned box, role="tooltip"). Shows the stage's total plus the exact
// per-source breakdown and each source's share of that stage.
//
// Follows the cursor's exact x position, added 2026-07-27 (Vlad's follow-up:
// "have it shown on exact mouse position") — tracked via onMouseMove's
// nativeEvent.offsetX (relative to the bar container itself, since the
// listener is bound directly on it), clamped so the w-56 tooltip can't run
// past either edge of that row's own width. Vertical position stays pinned
// just above the bar (bottom-full) rather than also following Y — the bar is
// only 28px tall, so tracking Y added jitter without adding anything useful.
const TOOLTIP_HALF_WIDTH = 112; // half of w-56 (224px)

// Made every row clickable, 2026-08-04 (Vlad's ask: "when i press on the row
// of funnel tab the candidates of that status must show up in the bottom
// block of all candidates ... witch exact number"). `onSelectStage` toggles
// the same key back off if the already-selected row is clicked again — see
// the page component's `selectedStageKey` state and `candidateMatchesStageKey`
// (lib/funnelview/stageMatch.ts) for how the Candidates table below turns
// this into an exact-match drill-down list.
function StageBar({
  stages,
  selectedKey,
  onSelectStage,
}: {
  stages: FunnelData["stages"];
  selectedKey: string | null;
  onSelectStage: (key: string) => void;
}) {
  const [hover, setHover] = useState<{ key: string; x: number } | null>(null);
  const max = Math.max(...stages.map((s) => s.count), 1);

  function updateHoverX(key: string, e: MouseEvent<HTMLDivElement>) {
    const width = e.currentTarget.clientWidth;
    const x = Math.min(Math.max(e.nativeEvent.offsetX, TOOLTIP_HALF_WIDTH), Math.max(width - TOOLTIP_HALF_WIDTH, TOOLTIP_HALF_WIDTH));
    setHover({ key, x });
  }

  return (
    <div className="flex flex-col gap-1">
      {stages.map((s) => {
        const barWidthPct = Math.max((s.count / max) * 100, s.count > 0 ? 2 : 0);
        const inboundPct = s.count > 0 ? (s.bySource.inbound / s.count) * 100 : 0;
        const outboundPct = s.count > 0 ? (s.bySource.outbound / s.count) * 100 : 0;
        const agencyPct = s.count > 0 ? Math.max(0, 100 - inboundPct - outboundPct) : 0;
        const isHovered = hover?.key === s.key;
        const isSelected = selectedKey === s.key;
        return (
          <div
            key={s.key}
            role="button"
            tabIndex={0}
            onClick={() => onSelectStage(s.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectStage(s.key);
              }
            }}
            title={`Show candidates in ${s.label}`}
            className={`-mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1 transition-colors ${
              isSelected ? "bg-violet-50 dark:bg-violet-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            }`}
          >
            <span className={`w-32 shrink-0 text-xs font-medium ${isSelected ? "text-violet-700 dark:text-violet-400" : "text-zinc-500 dark:text-zinc-400"}`}>{s.label}</span>
            <div
              className="relative h-7 flex-1 overflow-visible rounded-lg bg-zinc-100 dark:bg-zinc-800"
              onMouseEnter={(e) => updateHoverX(s.key, e)}
              onMouseMove={(e) => updateHoverX(s.key, e)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="h-full overflow-hidden rounded-lg">
                <div className="flex h-full rounded-lg transition-all" style={{ width: `${barWidthPct}%` }}>
                  {/* Colors updated 2026-07-27 (Vlad's ask) — gray/LinkedIn-blue/orange
                      everywhere a source is shown, not just here; see SourceIcon.tsx's
                      header comment for the full token list and reasoning. */}
                  {s.bySource.inbound > 0 && <div className="h-full bg-zinc-400 dark:bg-zinc-500" style={{ width: `${inboundPct}%` }} />}
                  {s.bySource.outbound > 0 && <div className="h-full bg-[#0A66C2]" style={{ width: `${outboundPct}%` }} />}
                  {s.bySource.agency > 0 && <div className="h-full bg-orange-500" style={{ width: `${agencyPct}%` }} />}
                </div>
              </div>
              {isHovered && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                  style={{ left: hover.x }}
                >
                  <p className="mb-1.5">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                      {s.label} — {s.count.toLocaleString()}
                    </span>
                    {s.conversionFromPrevious != null && (
                      <span className="block font-normal text-zinc-400 dark:text-zinc-500">{s.conversionFromPrevious}% of previous</span>
                    )}
                  </p>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" /> Applied
                      </span>
                      <span className="tabular-nums">
                        {s.bySource.inbound.toLocaleString()} ({Math.round(inboundPct)}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[#0A66C2]" /> Sourced
                      </span>
                      <span className="tabular-nums">
                        {s.bySource.outbound.toLocaleString()} ({Math.round(outboundPct)}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" /> Agency
                      </span>
                      <span className="tabular-nums">
                        {s.bySource.agency.toLocaleString()} ({Math.round(agencyPct)}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
              {s.count.toLocaleString()}
            </span>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
              {s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Small color legend for StageBar's segments — shown once above the funnel
// instead of repeating labels on every row. Same colors/order as the old
// standalone SourceSplit section this replaces.
function SourceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-400 dark:bg-zinc-500" /> Applied
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#0A66C2]" /> Sourced
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Agency
      </span>
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
  // Funnel row drill-down, 2026-08-04 (Vlad's ask). Deliberately NOT reset
  // when selectedProjectId changes — staying applied across a role switch is
  // exactly "responsive to the selected role": since the candidate list this
  // drives is filtered from `activeCandidates` (already role-scoped, see
  // below), picking a different role while a stage is selected just updates
  // the drill-down to that role's own matching candidates instead of losing
  // the selection outright.
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");

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

  // Stage drill-down, 2026-08-04 (Vlad's ask). Deliberately filters from
  // `activeCandidates` (role-scoped, but NOT the `showArchived` list) rather
  // than `filteredCandidates` — a selected stage's whole point is to show
  // the EXACT set behind that row's count (e.g. "Reached Out" includes
  // candidates later archived after real engagement), so it can't be
  // silently narrowed further by an unrelated archived/rejected toggle. The
  // toggle itself is hidden while a stage is selected (see the table header
  // below) so there's no control on screen implying it still applies.
  const selectedStage = selectedStageKey ? activeStages.find((s) => s.key === selectedStageKey) ?? null : null;
  const stageCandidates = selectedStageKey
    ? activeCandidates.filter((c) => candidateMatchesStageKey(c, selectedStageKey))
    : filteredCandidates;

  // Small search field, 2026-08-04 (Vlad's ask) — narrows whichever list is
  // currently showing (default candidate list or a stage drill-down) by
  // name. Applied last, on top of everything else, so the header count
  // always reflects exactly what's rendered below it.
  const searchedCandidates = candidateSearch.trim()
    ? stageCandidates.filter((c) => c.candidateName.toLowerCase().includes(candidateSearch.trim().toLowerCase()))
    : stageCandidates;

  function handleSelectStage(key: string) {
    setSelectedStageKey((prev) => {
      const next = prev === key ? null : key;
      // Jump to the Candidates table on selection (not on deselect) — a nice-
      // to-have for smaller screens where the funnel card can push it below
      // the fold, same pattern already used for the Pipeline drawer's
      // scroll-to-expanded-card behavior.
      if (next) {
        requestAnimationFrame(() => {
          document.getElementById("funnel-candidates")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return next;
    });
  }

  function handleExport() {
    if (!data) return;

    const summaryRows = activeStages.map((s) => ({
      Stage: s.label,
      Count: s.count,
      "% of Previous Stage": s.conversionFromPrevious != null ? `${s.conversionFromPrevious}%` : "—",
    }));
    summaryRows.push({ Stage: "Archived/Rejected", Count: activeArchivedOrRejected, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Sourced", Count: activeSourceSplit.outbound, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Agency", Count: activeSourceSplit.agency, "% of Previous Stage": "—" });
    summaryRows.push({ Stage: "Applied", Count: activeSourceSplit.inbound, "% of Previous Stage": "—" });
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 20 }];

    // Column set rebuilt 2026-08-04 (Vlad's exact spec): Name, Current
    // Company, Current Title, Score, Current Status, Past Stage, Screened
    // Date, Total experience, Recruiter — replaces the old Role/Source/
    // Fraud Flags/Archived set. Role is added back ONLY for the "All roles"
    // export (activeProject null) — a sheet spanning every role needs some
    // way to tell candidates apart by role, which a single-role export
    // (the normal case, per Vlad's own on-screen dropdown) doesn't need.
    // LinkedIn added 2026-08-06, slotted right after Current Title.
    const candidateRows = activeCandidates.map((c) => ({
      Name: c.candidateName,
      ...(activeProject ? {} : { Role: c.projectName }),
      "Current Company": c.currentCompany ?? "",
      "Current Title": c.currentTitle ?? "",
      // Added 2026-08-06 (Vlad's ask: a LinkedIn link column) — genuinely
      // blank for candidates whose resume never listed a profile URL, same
      // "expected absence, not a bug" note as currentCompany/currentTitle.
      LinkedIn: c.linkedinUrl ?? "",
      Score: c.score,
      "Current Status": c.trackerStage ?? STAGE_LABELS[c.status] ?? c.status,
      // Past Stage stays in the Excel export only — Vlad's ask, 2026-07-20:
      // "don't show Past Stage on the Candidates tab on the FunnelView
      // page, keep it in the report and everywhere else." Removed from the
      // on-screen table below; this is now the only remaining place it renders.
      "Past Stage": pastStageLabel(c) === "—" ? "" : pastStageLabel(c),
      "Screened Date": new Date(c.createdAt).toLocaleDateString(),
      // "Signals" replaces "Total experience", 2026-08-15 (Vlad's ask) —
      // strongest strength + weakest concern instead of a longer prose
      // sentence. See lib/funnelview/types.ts's topStrength/topConcern.
      Signals: [c.topStrength, c.topConcern].filter(Boolean).join(" · ") || "",
      Recruiter: c.recruiterEmail ?? "",
    }));
    const candidateSheet = XLSX.utils.json_to_sheet(candidateRows);
    candidateSheet["!cols"] = [
      { wch: 24 },
      ...(activeProject ? [] : [{ wch: 22 }]),
      { wch: 22 }, { wch: 22 }, { wch: 32 }, { wch: 8 }, { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 32 }, { wch: 28 },
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
          subtitle="Full candidate funnel, live from Cirot data. Admin only."
          action={
            data ? (
              <div className="flex shrink-0 items-center gap-2">
                {roleOptions.length > 0 && (
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value === "" ? "" : Number(e.target.value))}
                    title={selectedProjectId !== "" ? (roleOptions.find((p) => p.projectId === selectedProjectId)?.projectName ?? "All roles") : "All roles"}
                    className="w-32 truncate rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
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
              {/* Source legend, added 2026-07-27 — each bar below is now
                  itself split by source (see StageBar), replacing the old
                  standalone "Sourced vs. Applied" section. */}
              <div className="mb-4">
                <SourceLegend />
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
                <StageBar stages={activeStages} selectedKey={selectedStageKey} onSelectStage={handleSelectStage} />
              )}
            </div>

            {/* Candidate table */}
            <div id="funnel-candidates" className="scroll-mt-6 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Candidates {activeProject && <span className="font-normal text-zinc-400">— {activeProject.projectName}</span>}
                  {selectedStage && <span className="font-normal text-violet-600 dark:text-violet-400"> — {selectedStage.label}</span>}{" "}
                  <span className="font-normal text-zinc-400">({searchedCandidates.length})</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Small search field, 2026-08-04 (Vlad's ask) — narrows
                      whatever's currently shown (default list or a stage
                      drill-down) by candidate name. */}
                  <input
                    type="text"
                    value={candidateSearch}
                    onChange={(e) => setCandidateSearch(e.target.value)}
                    placeholder="Search candidates…"
                    className="w-36 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 placeholder:text-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  />
                  {selectedStage ? (
                    // Replaces the archived toggle while a stage is selected
                    // — that toggle doesn't apply to a drill-down list (see
                    // stageCandidates' own comment above), so showing it here
                    // would imply a filter that isn't actually in effect.
                    <button
                      type="button"
                      onClick={() => setSelectedStageKey(null)}
                      className="flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:hover:bg-violet-500/25"
                    >
                      {selectedStage.label}
                      <span aria-hidden>×</span>
                    </button>
                  ) : (
                    <label className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                        className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500 dark:border-zinc-600"
                      />
                      Show archived/rejected
                    </label>
                  )}
                </div>
              </div>

              {searchedCandidates.length === 0 ? (
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
                    {searchedCandidates.map((c) => (
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
                                ? "bg-[#0A66C2]/10 text-[#0A66C2] dark:bg-[#0A66C2]/20 dark:text-[#5B9BD5]"
                                : c.source === "agency"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-500/20 dark:text-zinc-400"
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
