"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalibrationButtons } from "@/components/CalibrationButtons";
import { CrossReferenceChecker } from "@/components/CredibilityChecker";
import { InsightList } from "@/components/InsightList";
import { TrajectoryRenderer } from "@/components/TrajectoryRenderer";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusStageControl } from "@/components/StatusStageControl";
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
  onStatusChange,
  onStageChange,
  onArchiveReasonChange,
  onFlagToggle,
  onDelete,
  onSaveNotes,
  onCredibilityComplete,
}: {
  screening: ScreeningRecord;
  projectName?: string;
  projectId?: number;
  trackerStage?: TrackerStage;
  onStatusChange: (id: number, status: CandidateStatus) => void;
  onStageChange: (id: number, stage: TrackerStage) => void;
  onArchiveReasonChange: (id: number, reason: string) => void;
  onFlagToggle: (id: number, current: boolean, note?: string) => void;
  onDelete: (id: number) => void;
  onSaveNotes: (id: number, text: string) => void;
  onCredibilityComplete: (id: number, assessment: CredibilityAssessment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingFlag, setPendingFlag] = useState(false);
  const [pendingFlagNote, setPendingFlagNote] = useState("");
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
      className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
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
            {s.nameMatchId != null && (
              <span
                title="A different resume file for this candidate already exists in the same project"
                className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-400"
              >
                Name match
              </span>
            )}
            {s.linkedInMode && (
              <span className="shrink-0 rounded bg-blue-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">LI</span>
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
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | null>(null);
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
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

  const filtered = screenings
    .filter((s) => {
      if (query && !s.candidateName.toLowerCase().includes(query.toLowerCase())) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (projectFilter && s.projectId !== projectFilter) return false;
      if (flaggedOnly && !s.flagged) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
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

  function handleSaveNotes(id: number, text: string) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, notes: text } : s));
  }

  function handleCredibilityComplete(id: number, assessment: CredibilityAssessment) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, credibility: assessment } : s));
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/candidates" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">All Candidates</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {loading ? "Loading..." : projectFilter && projectFilter !== -1
                ? `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""} in ${projects.find((p) => p.id === projectFilter)?.name ?? "this role"}`
                : projectFilter === -1
                ? `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""} with no role`
                : `${screenings.length} candidate${screenings.length !== 1 ? "s" : ""} across all roles`}
            </p>
          </div>
          {projects.length > 0 && (
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
          )}
        </div>

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

            {/* Status filters */}
            {CANDIDATE_STATUSES.map((status) => (
              <button key={status} type="button"
                onClick={() => setStatusFilter((prev) => prev === status ? null : status)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${statusFilter === status ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                {CANDIDATE_STATUS_LABELS[status]}
              </button>
            ))}
          </div>


          {/* Active filter summary */}
          {(statusFilter || projectFilter || flaggedOnly || query) && (
            <button type="button"
              onClick={() => { setStatusFilter(null); setProjectFilter(null); setFlaggedOnly(false); setQuery(""); }}
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
            {filtered.map((s) => {
              const proj = s.projectId ? projectMap[s.projectId] : undefined;
              return (
                <CandidateCard key={s.id} screening={s}
                  projectName={proj?.name}
                  projectId={proj?.id}
                  trackerStage={stagesMap[s.id]}
                  onStatusChange={handleStatusChange}
                  onStageChange={handleStageChange}
                  onArchiveReasonChange={handleArchiveReasonChange}
                  onFlagToggle={handleFlagToggle}
                  onDelete={handleDelete}
                  onSaveNotes={handleSaveNotes}
                  onCredibilityComplete={handleCredibilityComplete}
                />
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
