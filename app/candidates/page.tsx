"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { CalibrationButtons } from "@/components/CalibrationButtons";
import { CrossReferenceChecker } from "@/components/CredibilityChecker";
import { InsightList } from "@/components/InsightList";
import { TrajectoryRenderer } from "@/components/TrajectoryRenderer";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { StatusStageControl } from "@/components/StatusStageControl";
import { computeMatchClusters, type MatchCluster } from "@/lib/matchClusters";
import SourceIcon from "@/components/SourceIcon";
import { getSourceType, type SourceType } from "@/lib/sourceType";
import {
  CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS,
  type CandidateStatus, type CredibilityAssessment, type CredibilitySignal,
  type ProjectSummary, type ScreeningRecord, type TrackerStage,
} from "@/lib/types";

// ── Credibility signal inline badge ───────────────────────────────────────

const SIGNAL_BADGE: Record<CredibilitySignal, { label: string; className: string; icon: string }> = {
  clean:                { label: "Cross-ref clean",          className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400", icon: "✓" },
  minor_concerns:       { label: "Cross-ref minor concerns", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",          icon: "⚠" },
  significant_concerns: { label: "Cross-ref flags",         className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",              icon: "⛔" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatStatusDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Candidate card ─────────────────────────────────────────────────────────

function CandidateCard({
  screening: s,
  projectName,
  projectId,
  trackerStage,
  mergePosition = "solo",
  clusterIsFraud,
  onStatusChange,
  onStageChange,
  onArchiveReasonChange,
  onFlagToggle,
  onDelete,
  onSaveNotes,
  onCredibilityComplete,
  onSourceChange,
}: {
  screening: ScreeningRecord;
  projectName?: string;
  projectId?: number;
  trackerStage?: TrackerStage;
  /**
   * Card merging, 2026-07-20 (Vlad's ask): replaces the old Ring-badge +
   * click-to-highlight mechanic (isHighlighted/isDimmed/onClusterClick,
   * cluster prop) entirely, mirroring the same change already made on
   * app/projects/[id]/page.tsx's PipelineTab. Candidates sharing a
   * matchClusters group (duplicate/history-alert/name-match — see
   * lib/matchClusters.ts) render as one merged card instead of separate
   * cards linked by a clickable Ring chip. "solo" (default) = unaffected,
   * renders exactly as before this feature existed.
   */
  mergePosition?: "solo" | "first" | "middle" | "last";
  /** Only meaningful when mergePosition !== "solo" — tints the merged card's border/header rose instead of neutral gray when the cluster carries a real duplicateFlag/historyAlertType. */
  clusterIsFraud?: boolean;
  onStatusChange: (id: number, status: CandidateStatus) => void;
  onStageChange: (id: number, stage: TrackerStage) => void;
  onArchiveReasonChange: (id: number, reason: string) => void;
  onFlagToggle: (id: number, current: boolean, note?: string) => void;
  onDelete: (id: number) => void;
  onSaveNotes: (id: number, text: string) => void;
  onCredibilityComplete: (id: number, assessment: CredibilityAssessment) => void;
  /**
   * Editable source, 2026-07-20 (Vlad's ask): older candidates (screened
   * before the Agency/LinkedIn source feature existed, or any plain default
   * candidate) had no way to set a source here at all — `SourceIcon` never
   * rendered anything for "applicant" (the default), and even if it had,
   * this page had no click-to-edit affordance the way PipelineTab does.
   * Mirrors PipelineTab's handleSourceChange exactly (same PATCH shape).
   */
  onSourceChange: (id: number, linkedInMode: boolean, agencyName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingFlag, setPendingFlag] = useState(false);
  const [pendingFlagNote, setPendingFlagNote] = useState("");
  const [pendingSource, setPendingSource] = useState(false);
  const [pendingSourceType, setPendingSourceType] = useState<SourceType>(getSourceType(s));
  const [pendingSourceAgencyName, setPendingSourceAgencyName] = useState(s.agencyName ?? "");
  const [noteText, setNoteText] = useState(s.notes ?? "");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [credibility, setCredibility] = useState<CredibilityAssessment | undefined>(s.credibility);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSaveNotes(text: string) {
    setNoteSaveState("saving");
    onSaveNotes(s.id, text);
    await fetch(`/api/history/${s.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: text }),
    }).catch(() => {});
    setNoteSaveState("saved");
    setTimeout(() => setNoteSaveState("idle"), 2000);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/history/${s.id}`, { method: "DELETE" });
      if (res.ok) onDelete(s.id);
    } catch { /* non-fatal */ }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  return (
    <li id={`candidate-${s.id}`}
      className={`${mergePosition !== "solo" ? "-mt-3" : ""} bg-white transition-all hover:shadow-md dark:bg-zinc-900 ${
        mergePosition === "solo" ? "rounded-2xl"
        : mergePosition === "first" ? "rounded-none"
        : mergePosition === "last" ? "rounded-t-none rounded-b-2xl"
        : "rounded-none"
      } ${
        // Fraud-cluster merged cards get a rose border instead of the
        // default gray, so a merged group still reads as flagged at a
        // glance (replaces the old per-click Ring highlight, which card
        // merging supersedes entirely — 2026-07-20).
        mergePosition !== "solo" && clusterIsFraud
          ? "border border-rose-200 dark:border-rose-500/30"
          : "border border-zinc-200 dark:border-zinc-800"
      } ${
        // Card Visuals, 2026-07-15 (Vlad's ask): archived candidates are
        // "toned out" so the eye skips past them in a mixed list — darker
        // border/bg, reduced opacity + saturation. Archived-only per
        // confirmed scope (not "undefined" status, which doesn't apply to
        // CandidateStatus anyway). Hover restores near-full opacity so the
        // card is still fully readable on demand.
        // 2026-07-15 follow-up: an opened card shouldn't stay dimmed either —
        // `expanded` fully clears the toned-out treatment while reading it.
        s.status === "archived" && !expanded ? "opacity-50 saturate-[0.6] hover:opacity-90" : ""
      }`}>
      {/* Row */}
      <div role="button" tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left">
        <ScoreBadge
          score={s.score}
          adjustedScore={credibility?.scoreDelta ? s.score + credibility.scoreDelta : undefined}
        />

        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
          {/* Name row */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{s.candidateName}</span>
            {s.duplicateFlag && (
              <span
                title="Duplicate detected — matches another candidate's content fingerprint"
                className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
              >
                Duplicate detected
              </span>
            )}
            {s.historyAlertType && (
              <Link
                href={s.historyAlertMatchProjectId != null ? `/projects/${s.historyAlertMatchProjectId}?tab=pipeline` : "#"}
                onClick={(e) => e.stopPropagation()}
                title={
                  s.historyAlertMatchCandidateName && s.historyAlertMatchProjectName
                    ? `Matches ${s.historyAlertMatchCandidateName} in ${s.historyAlertMatchProjectName}`
                    : s.historyAlertType === "known_fraud_pattern"
                    ? "Known fraud pattern — matches a flagged candidate in another project"
                    : "Previously seen in another project"
                }
                className={
                  s.historyAlertType === "known_fraud_pattern"
                    ? "shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                    : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25"
                }
              >
                {s.historyAlertType === "known_fraud_pattern" ? "Known fraud pattern" : "Previously seen"}
              </Link>
            )}
            {s.nameMatchId != null && mergePosition === "solo" && (
              <span
                title="A different resume file for this candidate already exists in the same project"
                className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400"
              >
                Name match
              </span>
            )}
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (pendingSource) { setPendingSource(false); return; }
                setPendingSourceType(getSourceType(s));
                setPendingSourceAgencyName(s.agencyName ?? "");
                setPendingSource(true);
              }}
              title="Click to set source"
              className="shrink-0 rounded-full transition-opacity hover:opacity-70">
              <SourceIcon type={getSourceType(s)} agencyName={s.agencyName} showApplicant />
            </button>
            {pendingSource && (
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
                <button type="button" title="Applicant"
                  onClick={() => { setPendingSource(false); onSourceChange(s.id, false, ""); }}
                  className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "applicant" ? "ring-2 ring-green-400" : "opacity-40 hover:opacity-100"}`}>
                  <SourceIcon type="applicant" size={13} showApplicant />
                </button>
                <button type="button" title="Sourced (LinkedIn)"
                  onClick={() => { setPendingSource(false); onSourceChange(s.id, true, ""); }}
                  className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "linkedin" ? "ring-2 ring-violet-400" : "opacity-40 hover:opacity-100"}`}>
                  <SourceIcon type="linkedin" size={13} />
                </button>
                {pendingSourceType === "agency" ? (
                  <input
                    autoFocus
                    type="text"
                    value={pendingSourceAgencyName}
                    onChange={(e) => setPendingSourceAgencyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pendingSourceAgencyName.trim()) { setPendingSource(false); onSourceChange(s.id, false, pendingSourceAgencyName); }
                      if (e.key === "Escape") setPendingSource(false);
                    }}
                    onBlur={() => {
                      if (pendingSourceAgencyName.trim()) { setPendingSource(false); onSourceChange(s.id, false, pendingSourceAgencyName); }
                      else setPendingSource(false);
                    }}
                    placeholder="Agency name…"
                    className="w-28 rounded-full border border-red-300 bg-white px-2 py-0.5 text-[11px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-red-500 dark:border-red-500/40 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                ) : (
                  <button type="button" title="Agency"
                    onClick={() => setPendingSourceType("agency")}
                    className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "agency" ? "ring-2 ring-red-400" : "opacity-40 hover:opacity-100"}`}>
                    <SourceIcon type="agency" agencyName={s.agencyName} size={13} />
                  </button>
                )}
              </div>
            )}
            {s.flagged && s.flagNote && (
              <span className="truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">{s.flagNote}</span>
            )}
          </div>
          {/* Meta row — role link · date · notes */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {projectName && projectId ? (
                <Link href={`/projects/${projectId}?tab=pipeline`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-violet-500 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300">
                  {projectName}
                </Link>
              ) : (
                <span className="text-zinc-300 dark:text-zinc-600">No role</span>
              )}
              {" · "}{formatDate(s.createdAt)}
              {s.statusUpdatedAt && <> · {formatStatusDate(s.statusUpdatedAt)}</>}
            </span>
            {noteText && (
              <span className="rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">notes</span>
            )}
          </div>
          {/* Status row */}
          <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <StatusStageControl
              status={s.status}
              stage={trackerStage ?? null}
              onStatusChange={(status) => onStatusChange(s.id, status)}
              onStageChange={(stage) => onStageChange(s.id, stage)}
              archiveReason={s.archiveReason}
              onArchiveReasonChange={(reason) => onArchiveReasonChange(s.id, reason)}
            />
          </div>
        </div>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />

        <button type="button"
          onClick={(e) => { e.stopPropagation(); s.flagged ? onFlagToggle(s.id, true) : setPendingFlag((p) => !p); }}
          aria-label={s.flagged ? "Remove flag" : "Flag"}
          className={`shrink-0 rounded-full p-1.5 transition-colors ${s.flagged ? "text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10" : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill={s.flagged ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 22V15" strokeLinecap="round" />
          </svg>
        </button>

        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Flag note input */}
      {pendingFlag && !s.flagged && (
        <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/50 px-5 py-3 dark:border-amber-500/20 dark:bg-amber-500/5"
          onClick={(e) => e.stopPropagation()}>
          <input autoFocus type="text" value={pendingFlagNote} onChange={(e) => setPendingFlagNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onFlagToggle(s.id, false, pendingFlagNote.trim() || undefined); setPendingFlag(false); setPendingFlagNote(""); }
              if (e.key === "Escape") { setPendingFlag(false); setPendingFlagNote(""); }
            }}
            placeholder="Reason to come back? (optional)"
            className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm outline-none placeholder:text-zinc-400 focus:border-amber-400 dark:border-amber-500/30 dark:bg-zinc-900" />
          <button type="button" onClick={() => { onFlagToggle(s.id, false, pendingFlagNote.trim() || undefined); setPendingFlag(false); setPendingFlagNote(""); }}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">Flag</button>
          <button type="button" onClick={() => { setPendingFlag(false); setPendingFlagNote(""); }}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancel</button>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">

          {/* ── Career story ─────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Career story</p>
              {credibility && (() => {
                const sig = SIGNAL_BADGE[credibility.overallSignal] ?? SIGNAL_BADGE.minor_concerns;
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sig.className}`}>
                    {sig.icon} {sig.label}
                  </span>
                );
              })()}
            </div>
            <TrajectoryRenderer text={s.careerTrajectory ?? s.summary} className="text-sm" />
            {credibility && (
              <div className="mt-2.5 flex flex-col gap-1 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Cross-ref trajectory: </span>
                  {credibility.trajectoryNote}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  <span className="font-medium text-zinc-500 dark:text-zinc-400">Industry: </span>
                  {credibility.industryNote}
                </p>
                {credibility.resumeDelta && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    <span className="font-medium text-zinc-500 dark:text-zinc-400">Δ Resume: </span>
                    {credibility.resumeDelta}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Cross-reference check ─────────────────────────────────── */}
          <CrossReferenceChecker
            screeningId={s.id}
            currentAssessment={credibility}
            onComplete={async (assessment) => {
              try {
                const res = await fetch(`/api/history/${s.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ credibility: assessment }),
                });
                if (!res.ok) return false;
                setCredibility(assessment);
                onCredibilityComplete(s.id, assessment);
                return true;
              } catch {
                return false;
              }
            }}
          />

          {/* ── Assessment ────────────────────────────────────────────── */}
          {(s.mustHaveScore !== undefined || s.niceToHaveScore !== undefined) && (
            <div className="flex items-center gap-1.5">
              {s.mustHaveScore !== undefined && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Must-have {s.mustHaveScore}</span>
              )}
              {s.niceToHaveScore !== undefined && (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">Nice-to-have {s.niceToHaveScore}</span>
              )}
            </div>
          )}

          <InsightList label="Strengths" items={s.strengths} variant="positive" />
          <InsightList label="Concerns" items={s.concerns} variant="warning" screeningId={s.id} />

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Notes</span>
              {noteSaveState === "saving" && <span className="text-xs text-zinc-400">Saving...</span>}
              {noteSaveState === "saved" && <span className="text-xs text-emerald-500">Saved</span>}
            </div>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              onBlur={(e) => handleSaveNotes(e.target.value)}
              placeholder="Add notes about this candidate..." rows={3}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-900" />
          </div>

          {/* Calibration feedback */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Calibrate
            </span>
            <CalibrationButtons screeningId={s.id} />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button type="button"
              onClick={() => {
                const sw = window.screen.availWidth;
                const sh = window.screen.availHeight;
                const halfW = Math.floor(sw / 2);
                window.open(`/interview/${s.id}/document?mime=${encodeURIComponent(s.resumeMimeType)}&name=${encodeURIComponent(s.fileName)}`, `iv_doc_${s.id}`, `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3.5 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              View resume
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">Delete?</span>
                <button type="button" onClick={handleDelete} disabled={deleting}
                  className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
                  {deleting ? "Deleting..." : "Confirm"}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12ZM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CandidatesPage() {
  const [screenings, setScreenings] = useState<ScreeningRecord[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [stagesMap, setStagesMap] = useState<Record<number, TrackerStage>>({});

  // Filters
  const [query, setQuery] = useState("");
  // Multi-select — was a single CandidateStatus | null before 2026-07-16's
  // enhanced filter bar. A Set lets a recruiter e.g. view "Contacted" and
  // "Screening" together instead of clicking back and forth.
  const [statusFilter, setStatusFilter] = useState<Set<CandidateStatus>>(new Set());
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  // Fraud signals toggle — matches any of the same three signals the badges
  // in CandidateCard render (duplicateFlag, historyAlertType, nameMatchId).
  const [fraudOnly, setFraudOnly] = useState(false);
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"default" | "desc" | "asc">("default");

  useEffect(() => {
    Promise.all([
      fetch("/api/history").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ])
      .then(([historyData, projectsData]) => {
        const allScreenings: ScreeningRecord[] = historyData.screenings ?? [];
        setScreenings(allScreenings);
        setProjects(projectsData.projects ?? []);
        // "screening" status = actively in the Tracker (TA/L1/L2/In-Person/Offer
        // arc) — was "interview" before that status was removed 2026-07-15.
        const trackerIds = allScreenings.filter((s) => s.status === "screening").map((s) => s.id);
        if (trackerIds.length > 0) {
          fetch(`/api/tracker?ids=${trackerIds.join(",")}`)
            .then((r) => r.json())
            .then((d) => {
              const entries: Record<string, { stage?: TrackerStage }> = d.entries ?? {};
              const stages: Record<number, TrackerStage> = {};
              for (const [sid, entry] of Object.entries(entries)) {
                if (entry.stage) stages[Number(sid)] = entry.stage;
              }
              setStagesMap(stages);
            })
            .catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));
  const matchClusters = useMemo(() => computeMatchClusters(screenings), [screenings]);

  // Card merging, 2026-07-20 (Vlad's ask) — mirrors the same change on
  // app/projects/[id]/page.tsx's PipelineTab. Every matchClusters group now
  // merges into one visual card instead of separate cards linked by a
  // clickable Ring badge; this only decides the merged header/border tint
  // (rose for a real fraud signal, neutral gray otherwise).
  function clusterHasFraudSignal(cluster: MatchCluster | undefined): boolean {
    if (!cluster) return false;
    return cluster.memberIds.some((id) => {
      const m = screenings.find((r) => r.id === id);
      return m?.duplicateFlag || m?.historyAlertType != null;
    });
  }

  const filtered = screenings
    .filter((s) => {
      if (query && !s.candidateName.toLowerCase().includes(query.toLowerCase())) return false;
      if (statusFilter.size > 0 && !statusFilter.has(s.status)) return false;
      if (projectFilter && s.projectId !== projectFilter) return false;
      if (flaggedOnly && !s.flagged) return false;
      if (fraudOnly && !(s.duplicateFlag || s.historyAlertType != null || s.nameMatchId != null)) return false;
      if (scoreMin !== "" && s.score < Number(scoreMin)) return false;
      if (scoreMax !== "" && s.score > Number(scoreMax)) return false;
      if (dateFrom && new Date(s.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(s.createdAt) > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      // Ring grouping, 2026-07-17 (Vlad's ask): candidates sharing a fraud-
      // signal Ring used to be scattered throughout the list at whatever
      // position their score happened to land them — findable via the
      // highlight, but not actually adjacent. Primary sort key is now
      // cluster index (Ring 1's members together, then Ring 2's, etc.);
      // candidates with no cluster sink to the end via Infinity. The score
      // sort below still applies as the tiebreaker within a ring (and among
      // the ungrouped candidates, same as before this change).
      const clusterA = matchClusters.get(a.id)?.index ?? Infinity;
      const clusterB = matchClusters.get(b.id)?.index ?? Infinity;
      if (clusterA !== clusterB) return clusterA - clusterB;
      if (sortOrder === "desc") return b.score - a.score;
      if (sortOrder === "asc") return a.score - b.score;
      return 0;
    });

  const flaggedCount = screenings.filter((s) => s.flagged).length;

  function handleStatusChange(id: number, status: CandidateStatus) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, status, statusUpdatedAt: new Date().toISOString() } : s));
    fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => {});
  }

  function handleStageChange(id: number, stage: TrackerStage) {
    setStagesMap((prev) => ({ ...prev, [id]: stage }));
    fetch(`/api/tracker/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) }).catch(() => {});
  }

  function handleArchiveReasonChange(id: number, archiveReason: string) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, archiveReason } : s));
    fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archiveReason }) }).catch(() => {});
  }

  function handleFlagToggle(id: number, current: boolean, note?: string) {
    const next = !current;
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, flagged: next, flagNote: next ? note : undefined } : s));
    fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flagged: next, flagNote: note }) }).catch(() => {});
  }

  function handleDelete(id: number) {
    setScreenings((prev) => prev.filter((s) => s.id !== id));
  }

  // Editable source, 2026-07-20 (Vlad's ask) — mirrors PipelineTab's
  // handleSourceChange (app/projects/[id]/page.tsx) exactly, including the
  // optimistic-update-with-rollback shape.
  function handleSourceChange(id: number, linkedInMode: boolean, agencyName: string) {
    const trimmedAgencyName = linkedInMode ? "" : agencyName.trim();
    const previous = screenings.find((s) => s.id === id);
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, linkedInMode, agencyName: trimmedAgencyName || undefined } : s));
    fetch(`/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedInMode, agencyName: trimmedAgencyName }),
    }).catch(() => {
      if (previous) setScreenings((prev) => prev.map((s) => s.id === id ? previous : s));
    });
  }

  function handleSaveNotes(id: number, text: string) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, notes: text } : s));
  }

  function handleCredibilityComplete(id: number, assessment: CredibilityAssessment) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, credibility: assessment } : s));
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/candidates" />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
        <PageHeader
          icon={<>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
          </>}
          title="All Candidates"
          subtitle={
            loading ? "Loading..." : projectFilter && projectFilter !== -1
              ? `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""} in ${projects.find((p) => p.id === projectFilter)?.name ?? "this role"}`
              : projectFilter === -1
              ? `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""} with no role`
              : `${screenings.length} candidate${screenings.length !== 1 ? "s" : ""} across all roles`
          }
          action={
            projects.length > 0 ? (
              <select
                value={projectFilter ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setProjectFilter(v === "" ? null : v === "-1" ? -1 : parseInt(v, 10));
                }}
                className="max-w-[200px] truncate rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="">All roles</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
                <option value="-1">No role</option>
              </select>
            ) : undefined
          }
        />

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-3">
          {/* Search + sort row */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name..."
                className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-4 text-sm text-zinc-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
                <path d="M3 6h18M6 12h12M10 18h4" strokeLinecap="round"/>
              </svg>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "default" | "desc" | "asc")}
                className="bg-transparent text-sm font-medium text-zinc-500 outline-none dark:text-zinc-400"
              >
                <option value="default">Default</option>
                <option value="desc">Score ↓</option>
                <option value="asc">Score ↑</option>
              </select>
            </div>
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-2">
            {/* Flagged */}
            <button type="button" onClick={() => setFlaggedOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${flaggedOnly ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill={flaggedOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 22V15" strokeLinecap="round" />
              </svg>
              Flagged{flaggedCount > 0 && ` (${flaggedCount})`}
            </button>

            {/* Fraud signals — matches duplicateFlag, historyAlertType, or nameMatchId, same signals as the CandidateCard badges. */}
            <button type="button" onClick={() => setFraudOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${fraudOnly ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Fraud signals
            </button>

            {/* Status filters — multi-select */}
            {CANDIDATE_STATUSES.map((status) => (
              <button key={status} type="button"
                onClick={() => setStatusFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(status)) next.delete(status); else next.add(status);
                  return next;
                })}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${statusFilter.has(status) ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                {CANDIDATE_STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          {/* Score + date-screened ranges */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Score</span>
              <input type="number" min={0} max={100} value={scoreMin} onChange={(e) => setScoreMin(e.target.value)}
                placeholder="Min"
                className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
              <span className="text-xs text-zinc-300 dark:text-zinc-600">–</span>
              <input type="number" min={0} max={100} value={scoreMax} onChange={(e) => setScoreMax(e.target.value)}
                placeholder="Max"
                className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Screened</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
              <span className="text-xs text-zinc-300 dark:text-zinc-600">–</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
            </div>
          </div>

          {/* Active filter summary */}
          {(statusFilter.size > 0 || projectFilter || flaggedOnly || fraudOnly || query || scoreMin !== "" || scoreMax !== "" || dateFrom || dateTo) && (
            <button type="button"
              onClick={() => {
                setStatusFilter(new Set()); setProjectFilter(null); setFlaggedOnly(false); setFraudOnly(false);
                setQuery(""); setScoreMin(""); setScoreMax(""); setDateFrom(""); setDateTo("");
              }}
              className="self-start text-xs text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
              Clear filters · {filtered.length} of {screenings.length} shown
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
          </div>
        ) : screenings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">No candidates yet.</p>
            <Link href="/projects"
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Go to Projects
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">No candidates match the current filters.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {filtered.map((s, idx) => {
              const proj = s.projectId ? projectMap[s.projectId] : undefined;
              // Card merging, 2026-07-20: the existing "Ring grouping" sort
              // tiebreaker above already places every member of the same
              // cluster adjacent to each other, so merge position is read
              // straight off array neighbors — same technique as
              // PipelineTab. A lone visible member (its match filtered out)
              // renders solo, unchanged.
              const cluster = matchClusters.get(s.id);
              const isMergeable = cluster != null;
              const prevSameCluster = isMergeable && idx > 0 && matchClusters.get(filtered[idx - 1].id)?.index === cluster!.index;
              const nextSameCluster = isMergeable && idx < filtered.length - 1 && matchClusters.get(filtered[idx + 1].id)?.index === cluster!.index;
              const mergePosition: "solo" | "first" | "middle" | "last" =
                !isMergeable || (!prevSameCluster && !nextSameCluster) ? "solo"
                : !prevSameCluster ? "first"
                : nextSameCluster ? "middle"
                : "last";
              const clusterIsFraud = clusterHasFraudSignal(cluster);
              let mergeGroupSize = 0;
              if (mergePosition === "first") {
                for (let j = idx; j < filtered.length && matchClusters.get(filtered[j].id)?.index === cluster!.index; j++) mergeGroupSize++;
              }
              return (
                <Fragment key={s.id}>
                  {mergePosition === "first" && (
                    <li aria-hidden className={`flex items-center gap-1.5 rounded-t-2xl border border-b-0 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${
                      clusterIsFraud
                        ? "border-rose-200 bg-rose-50/70 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                        : "border-zinc-200 bg-zinc-50/70 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-500"
                    }`}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                        <circle cx="9" cy="9" r="4" /><circle cx="15" cy="15" r="4" />
                      </svg>
                      {clusterIsFraud ? "Possible duplicate" : "Same person"} · {mergeGroupSize} submissions
                    </li>
                  )}
                  <CandidateCard screening={s}
                    projectName={proj?.name}
                    projectId={proj?.id}
                    trackerStage={stagesMap[s.id]}
                    mergePosition={mergePosition}
                    clusterIsFraud={clusterIsFraud}
                    onStatusChange={handleStatusChange}
                    onStageChange={handleStageChange}
                    onArchiveReasonChange={handleArchiveReasonChange}
                    onFlagToggle={handleFlagToggle}
                    onDelete={handleDelete}
                    onSaveNotes={handleSaveNotes}
                    onCredibilityComplete={handleCredibilityComplete}
                    onSourceChange={handleSourceChange}
                  />
                </Fragment>
              );
            })}
          </ul>
        )}
      </main>
      <ScrollToTopButton />
    </div>
  );
}
