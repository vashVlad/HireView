"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ScoringLoader } from "@/components/ScoringLoader";
import { CalibrationButtons } from "@/components/CalibrationButtons";
import { CrossReferenceChecker } from "@/components/CredibilityChecker";
import { FraudRiskChecker } from "@/components/FraudRiskChecker";
import { InsightList } from "@/components/InsightList";
import { ScreeningStepper } from "@/components/ScreeningStepper";
import { AttributePills } from "@/components/AttributePills";
import { ExperienceHighlightsList } from "@/components/ExperienceHighlightsList";
import { buildScreeningSteps, buildAttributePills } from "@/lib/reasonedSignalPills";
import { buildExperienceHighlights } from "@/lib/experienceHighlights";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { StatusStageControl } from "@/components/StatusStageControl";
import { computeMatchClusters, type MatchCluster } from "@/lib/matchClusters";
import SourceIcon from "@/components/SourceIcon";
import { getSourceType, type SourceType } from "@/lib/sourceType";
import type { ScreeningAction } from "@/lib/screeningActions";
import {
  CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS,
  type CandidateStatus, type CredibilityAssessment, type CredibilitySignal,
  type FraudRiskAssessment, type ProjectSummary, type ScreeningRecord, type TrackerStage,
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
  suppressHistoryAlert = false,
  isNonFraudCluster = false,
  hiddenAsCollapsedSibling = false,
  clusterExpanded = false,
  onStatusChange,
  onStageChange,
  onArchiveReasonChange,
  onBlacklistChange,
  onFlagToggle,
  onDelete,
  onSaveNotes,
  onCredibilityComplete,
  onFraudRiskComplete,
  onSourceChange,
  matchedTerms,
}: {
  screening: ScreeningRecord;
  projectName?: string;
  projectId?: number;
  trackerStage?: TrackerStage;
  /**
   * Global talent search, 2026-08-17 (roadmap 2.5.9) — the query terms that
   * literally appear in this candidate's summary/strengths/concerns,
   * computed server-side (lib/candidateSearch.ts's highlightQueryOverlap).
   * Only present while a semantic search is active (see CandidatesPage's
   * semanticResults state) — undefined the rest of the time, same as every
   * other optional display-only prop on this card. Decoration, not the
   * ranking signal — an empty array is a valid, expected result when a
   * match is purely semantic (query and candidate text share no literal
   * words), not rendered as an error or a weak match.
   */
  matchedTerms?: string[];
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
  /**
   * Vlad's ask, 2026-07-30: hides this card's own "Previously seen"/"Known
   * fraud pattern" badge when it's not the most recently screened member of
   * its merged cluster — see suppressedHistoryAlertIds in CandidatesPage.
   * Purely a display decision; historyAlertType itself is untouched.
   */
  suppressHistoryAlert?: boolean;
  /**
   * "Multiple roles" collapsed profile, 2026-07-30 (Vlad's ask) — mirrors
   * app/projects/[id]/page.tsx's PipelineTab exactly. A merged cluster with
   * no real fraud signal (plain "previously_seen" cross-project match, or a
   * same-project nameMatchId) only shows its most recent member by default;
   * the "Multiple roles · N" toggle bar that reveals the rest lives in the
   * parent's render loop (a full-width bar above this card, same footprint
   * as the "Possible duplicate" banner — see CandidatesPage), not inside
   * this component.
   */
  isNonFraudCluster?: boolean;
  /** True for non-"first" members of a non-fraud cluster while it's collapsed — rendered but visually hidden so expanding is instant. */
  hiddenAsCollapsedSibling?: boolean;
  clusterExpanded?: boolean;
  onStatusChange: (id: number, status: CandidateStatus) => void;
  onStageChange: (id: number, stage: TrackerStage) => void;
  onArchiveReasonChange: (id: number, reason: string) => void;
  onBlacklistChange: (id: number, blacklisted: boolean, reason: string | null) => void;
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
  onSourceChange: (id: number, linkedInMode: boolean, agencyName: string, referrerName?: string) => void;
  onFraudRiskComplete: (id: number, assessment: FraudRiskAssessment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingFlag, setPendingFlag] = useState(false);
  const [pendingFlagNote, setPendingFlagNote] = useState("");
  const [pendingSource, setPendingSource] = useState(false);
  const [pendingSourceType, setPendingSourceType] = useState<SourceType>(getSourceType(s));
  const [pendingSourceAgencyName, setPendingSourceAgencyName] = useState(s.agencyName ?? "");
  const [pendingSourceReferrerName, setPendingSourceReferrerName] = useState(s.referrerName ?? "");
  const [noteText, setNoteText] = useState(s.notes ?? "");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [credibility, setCredibility] = useState<CredibilityAssessment | undefined>(s.credibility);
  // Manual fraud risk check, added 2026-07-30 to match ResultCard.tsx/
  // PipelineTab — this page's card never had it at all (see this
  // component's other 2026-07-30 comments for the "look the same as
  // Pipeline" ask this closes out). Same score >= 75 gate as both.
  const [fraudRisk, setFraudRisk] = useState<FraudRiskAssessment | undefined>(s.fraudRisk);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Share link, 2026-08-02 (Vlad's ask) — copies this candidate's durable
  // /candidates/[id] page URL (the same "shareable, bookmarkable" page a
  // batch already has at /projects/[id]/batches/[batchId], just per
  // candidate instead of per batch).
  const [linkCopied, setLinkCopied] = useState(false);
  async function handleCopyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/candidates/${s.id}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }
  const [actions, setActions] = useState<ScreeningAction[] | "loading" | undefined>(undefined);
  // 2026-07-30 follow-up (Vlad's ask): the "Multiple roles" toggle moved
  // from an inline chip into a full-width bar sitting on top of the card
  // (rendered by the parent), mirroring the "Possible duplicate" banner —
  // so a non-fraud cluster's "first" member ALWAYS has something above it
  // now (collapsed or expanded), same as a fraud cluster does. Only a true
  // "solo" card is fully isolated (normal full rounding). Mirrors
  // PipelineTab exactly.
  const showsAsIsolated = mergePosition === "solo";
  // The collapsed "first" member of a non-fraud cluster has no visible
  // sibling below it (still hidden), so it's the last visible thing in its
  // stack and needs a rounded bottom — flips to flat once expanded and an
  // actual sibling appears below it.
  const roundedBottomWhileCollapsed = isNonFraudCluster && mergePosition === "first" && !clusterExpanded;
  // Any middle/last member of a non-fraud cluster toggles between `hidden`
  // and visible as clusterExpanded changes — plays the slow reveal
  // animation (see .animate-reveal-down in globals.css) every time it
  // becomes visible, since display:none->block always restarts a CSS
  // animation. Mirrors PipelineTab exactly.
  const isCollapsibleSibling = isNonFraudCluster && mergePosition !== "first" && mergePosition !== "solo";

  // Lazy-load the attribution timeline the first time this card is expanded —
  // same pattern as PipelineTab's actionsMap in app/projects/[id]/page.tsx,
  // just scoped to this card's own local state instead of a page-level map,
  // since this component already manages everything else (credibility,
  // notes) locally per-card rather than via a parent-held map.
  useEffect(() => {
    if (!expanded || actions !== undefined) return;
    setActions("loading");
    fetch(`/api/history/${s.id}/actions`)
      .then((res) => res.json())
      .then((data) => setActions(data.actions ?? []))
      .catch(() => setActions([]));
  }, [expanded, actions, s.id]);

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
      className={`${hiddenAsCollapsedSibling ? "hidden" : isCollapsibleSibling ? "animate-reveal-down" : ""} ${!showsAsIsolated ? "-mt-3" : ""} bg-white transition-all hover:shadow-md dark:bg-zinc-900 ${
        showsAsIsolated ? "rounded-2xl"
        : roundedBottomWhileCollapsed ? "rounded-t-none rounded-b-2xl"
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
            {/* Blacklist badge, 2026-07-31 (Vlad's ask) — deliberately
                styled to "pop" harder than every other badge on this row
                (solid black fill vs. the rose/amber/zinc tints below),
                shown first since it's the strongest signal. */}
            {s.blacklisted && (
              <span
                title={s.blacklistReason ? `Blacklisted — ${s.blacklistReason}` : "Blacklisted"}
                className="shrink-0 rounded-full bg-zinc-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-white dark:text-zinc-950"
              >
                Blacklisted
              </span>
            )}
            {s.duplicateFlag && (
              <span
                title="Duplicate detected — matches another candidate's content fingerprint"
                className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
              >
                Duplicate detected
              </span>
            )}
            {s.historyAlertType && !suppressHistoryAlert && !isNonFraudCluster && (
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
            {/* "Multiple roles" toggle lives as a full-width bar above the
                card now (2026-07-30) — see the <li> rendered just before
                this card in CandidatesPage's map. */}
            <button type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (pendingSource) { setPendingSource(false); return; }
                setPendingSourceType(getSourceType(s));
                setPendingSourceAgencyName(s.agencyName ?? "");
                setPendingSourceReferrerName(s.referrerName ?? "");
                setPendingSource(true);
              }}
              title="Click to set source"
              className="shrink-0 rounded-full transition-opacity hover:opacity-70">
              <SourceIcon type={getSourceType(s)} agencyName={s.agencyName} referrerName={s.referrerName} contentIsLinkedIn={s.resumeIsLinkedIn} showApplicant />
            </button>
            {/* Visible agency name, added 2026-07-27 (Vlad's ask) — matches
                the same addition on ResultCard.tsx and the Pipeline tab
                card, so all three source-badge surfaces stay in sync.
                Visible referrer name added 2026-08-26, exact mirror. */}
            {!pendingSource && getSourceType(s) === "agency" && s.agencyName && (
              <span className="shrink-0 truncate text-[11px] font-medium text-orange-600 dark:text-orange-400">
                {s.agencyName}
              </span>
            )}
            {!pendingSource && getSourceType(s) === "referred" && s.referrerName && (
              <span className="shrink-0 truncate text-[11px] font-medium text-teal-600 dark:text-teal-400">
                {s.referrerName}
              </span>
            )}
            {pendingSource && (
              <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <div className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
                {getSourceType(s) !== "applicant" && (
                  <button type="button" title="Applicant"
                    onClick={() => { setPendingSource(false); onSourceChange(s.id, false, ""); }}
                    className="rounded-full p-0.5 opacity-40 transition-opacity hover:opacity-100">
                    <SourceIcon type="applicant" size={13} showApplicant />
                  </button>
                )}
                {getSourceType(s) !== "linkedin" && (
                  <button type="button" title="Sourced"
                    onClick={() => { setPendingSource(false); onSourceChange(s.id, true, ""); }}
                    className="rounded-full p-0.5 opacity-40 transition-opacity hover:opacity-100">
                    <SourceIcon type="linkedin" size={13} />
                  </button>
                )}
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
                    className="w-28 rounded-full border border-orange-300 bg-white px-2 py-0.5 text-[11px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-orange-500 dark:border-orange-500/40 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                ) : (
                  <button type="button" title="Agency"
                    onClick={() => setPendingSourceType("agency")}
                    className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "agency" ? "ring-2 ring-orange-400" : "opacity-40 hover:opacity-100"}`}>
                    <SourceIcon type="agency" agencyName={s.agencyName} size={13} />
                  </button>
                )}
                {/* Referred, added 2026-08-26 (Vlad's ask), exact mirror of Agency directly above. */}
                {pendingSourceType === "referred" ? (
                  <input
                    autoFocus
                    type="text"
                    value={pendingSourceReferrerName}
                    onChange={(e) => setPendingSourceReferrerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pendingSourceReferrerName.trim()) { setPendingSource(false); onSourceChange(s.id, false, "", pendingSourceReferrerName); }
                      if (e.key === "Escape") setPendingSource(false);
                    }}
                    onBlur={() => {
                      if (pendingSourceReferrerName.trim()) { setPendingSource(false); onSourceChange(s.id, false, "", pendingSourceReferrerName); }
                      else setPendingSource(false);
                    }}
                    placeholder="Referred by…"
                    className="w-28 rounded-full border border-teal-300 bg-white px-2 py-0.5 text-[11px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-teal-500 dark:border-teal-500/40 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                ) : (
                  <button type="button" title="Referred"
                    onClick={() => setPendingSourceType("referred")}
                    className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "referred" ? "ring-2 ring-teal-400" : "opacity-40 hover:opacity-100"}`}>
                    <SourceIcon type="referred" referrerName={s.referrerName} size={13} />
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
          {/* Talent search match chips, 2026-08-17 — see matchedTerms prop
              comment above. Only rendered while a semantic search is active
              AND there's at least one literal overlap to show; a semantic-
              only match (empty matchedTerms) renders nothing here rather
              than an empty/awkward "Matched on:" label. */}
          {matchedTerms && matchedTerms.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400 dark:text-violet-500">Matched:</span>
              {matchedTerms.map((term) => (
                <span key={term} className="rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">{term}</span>
              ))}
            </div>
          )}
          {/* Status row */}
          <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <StatusStageControl
              status={s.status}
              stage={trackerStage ?? null}
              onStatusChange={(status) => onStatusChange(s.id, status)}
              onStageChange={(stage) => onStageChange(s.id, stage)}
              archiveReason={s.archiveReason}
              onArchiveReasonChange={(reason) => onArchiveReasonChange(s.id, reason)}
              blacklisted={s.blacklisted}
              blacklistReason={s.blacklistReason}
              onBlacklistChange={(next, reason) => onBlacklistChange(s.id, next, reason)}
            />
          </div>
        </div>

        {/* Resume + Notes buttons, 2026-08-02 (Vlad's ask: "There are no
            View Resume nor Notes buttons on those cards") — the collapsed
            row here had neither, unlike the Pipeline tab's collapsed row
            (which shows both directly, no expand needed). Same popup-window
            behavior/positioning as Pipeline's own Resume+Notes buttons. */}
        <button type="button"
          onClick={(e) => {
            e.stopPropagation();
            const sw = window.screen.availWidth;
            const sh = window.screen.availHeight;
            const halfW = Math.floor(sw / 2);
            window.open(`/interview/${s.id}/document?mime=${encodeURIComponent(s.resumeMimeType)}&name=${encodeURIComponent(s.fileName)}`, `iv_doc_${s.id}`, `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
          }}
          aria-label="Open resume" title="Open resume"
          className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button type="button"
          onClick={(e) => {
            e.stopPropagation();
            const sw = window.screen.availWidth;
            const sh = window.screen.availHeight;
            const halfW = Math.floor(sw / 2);
            const halfH = Math.floor(sh / 2);
            window.open(`/interview/${s.id}`, `iv_notes_${s.id}`, `width=${halfW},height=${halfH},left=${sw - halfW},top=0,menubar=no,toolbar=no,location=no,status=no`);
          }}
          aria-label="Open interview notes" title="Open interview notes"
          className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

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

          {/* Reasoned screening-progress stepper + attribute pills,
              2026-08-28 (task #98) — same components/functions as
              ResultCard.tsx and the Pipeline tab card, so this page's own
              third independent copy of the card markup doesn't drift. */}
          <ScreeningStepper steps={buildScreeningSteps(s)} />
          <AttributePills pills={buildAttributePills(s)} />

          {/* ── Experience at a glance ──────────────────────────────── */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Experience at a glance</p>
              {credibility && (() => {
                const sig = SIGNAL_BADGE[credibility.overallSignal] ?? SIGNAL_BADGE.minor_concerns;
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sig.className}`}>
                    {sig.icon} {sig.label}
                  </span>
                );
              })()}
            </div>
            <ExperienceHighlightsList
              highlights={buildExperienceHighlights(s)}
              trajectoryText={s.careerTrajectory ?? s.summary}
              className="text-sm"
              hideLabel
            />
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
            checklistEvaluation={s.checklistEvaluation}
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

          {/* ── Fraud risk check ──────────────────────────────────────── */}
          {(s.score >= 75 || fraudRisk !== undefined) && (
            <FraudRiskChecker
              screeningId={s.id}
              roleContext={projectName}
              currentAssessment={fraudRisk}
              onComplete={async (assessment) => {
                try {
                  const res = await fetch(`/api/history/${s.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fraudRisk: assessment }),
                  });
                  if (!res.ok) return false;
                  setFraudRisk(assessment);
                  onFraudRiskComplete(s.id, assessment);
                  return true;
                } catch {
                  return false;
                }
              }}
            />
          )}

          {/* ── Assessment ────────────────────────────────────────────── */}
          {/* Bare "Must-have X / Nice-to-have Y" badges REMOVED 2026-08-28
              (task #98) — already covered by the reasoned "Domain fit"
              attribute pill at the top of this expanded detail, same
              underlying mustHaveScore. Kept as its own comment block (not
              deleted silently) since a future reader might otherwise wonder
              where this section went. */}

          <InsightList label="Strengths" items={s.strengths} variant="positive" />
          <InsightList label="Concerns" items={s.concerns} variant="warning" screeningId={s.id} />

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Notes</span>
                {/* View Resume, 2026-08-02 (Vlad's ask) — same popup-window
                    behavior as the "View resume" button in the Actions row
                    below, just placed right next to Notes too (matching the
                    Pipeline tab, where Resume and Notes buttons sit side by
                    side) so a recruiter can glance at the resume while
                    writing notes without hunting for the button lower down. */}
                <button type="button"
                  onClick={() => {
                    const sw = window.screen.availWidth;
                    const sh = window.screen.availHeight;
                    const halfW = Math.floor(sw / 2);
                    window.open(`/interview/${s.id}/document?mime=${encodeURIComponent(s.resumeMimeType)}&name=${encodeURIComponent(s.fileName)}`, `iv_doc_${s.id}`, `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
                  }}
                  aria-label="Open resume" title="Open resume"
                  className="rounded-full p-1 text-zinc-300 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              {noteSaveState === "saving" && <span className="text-xs text-zinc-400">Saving...</span>}
              {noteSaveState === "saved" && <span className="text-xs text-emerald-500">Saved</span>}
            </div>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              onBlur={(e) => handleSaveNotes(e.target.value)}
              placeholder="Add notes about this candidate..." rows={3}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-900" />
          </div>

          {/* ── Attribution timeline ──────────────────────────────────── */}
          {/* Vlad's ask, 2026-07-30 ("make sure the result cards look the
              same as the ones from the Pipeline"): this used to be a
              hand-rolled copy predating the 2026-07-29 extraction of
              components/ActivityTimeline.tsx — no relative timestamps, no
              per-action-type icon, out of sync with ResultCard.tsx and
              PipelineTab. Same actions data either way, just the shared
              component now. */}
          <ActivityTimeline actions={actions} candidateName={s.candidateName} />

          {/* Calibration feedback */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Calibrate
            </span>
            <CalibrationButtons screeningId={s.id} />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
              {/* Share link, 2026-08-02 (Vlad's ask) — copies a direct link
                  to this candidate's own /candidates/[id] page, same idea as
                  the existing durable/shareable batch-results page. */}
              <button type="button" onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                {linkCopied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Share link
                  </>
                )}
              </button>
            </div>
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
  // "Multiple roles" collapsed-profile toggle, 2026-07-30 (Vlad's ask) —
  // mirrors app/projects/[id]/page.tsx's PipelineTab exactly. A merged
  // cluster with no real fraud signal only shows its most recent member by
  // default; older siblings stay mounted (instant expand, no re-fetch) but
  // hidden until the cluster is expanded via its "Multiple roles · N" chip.
  // Keyed by matchClusters' cluster.index.
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());

  // Search — redesigned 2026-08-17 (Vlad's ask: two separate always-visible
  // search boxes read as clutter). One text input, one small mode toggle
  // instead of a second box. "name" = the original instant substring filter
  // over already-loaded candidates (unchanged behavior). "skills" = the
  // roadmap 2.5.9 semantic/embeddings search — explicit submit (Enter or
  // the inline Search button), server-side, since it's a real API call, not
  // a live filter. Switching modes clears both the text and any active
  // semantic results, so the box never shows text that means something
  // different than what's currently displayed.
  const [searchText, setSearchText] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "skills">("name");
  const [semanticSearching, setSemanticSearching] = useState(false);
  // null = not currently searching (every other filter/sort behaves exactly
  // as before this feature existed). An empty array is a real "search ran,
  // zero matches" result, not the same as null.
  const [semanticResults, setSemanticResults] = useState<{ screeningId: number; similarity: number; matchedTerms: string[] }[] | null>(null);
  const [semanticError, setSemanticError] = useState<string | null>(null);

  // Multi-select — was a single CandidateStatus | null before 2026-07-16's
  // enhanced filter bar. A Set lets a recruiter e.g. view "Contacted" and
  // "Screening" together instead of clicking back and forth.
  const [statusFilter, setStatusFilter] = useState<Set<CandidateStatus>>(new Set());
  const [projectFilter, setProjectFilter] = useState<number | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  // Fraud signals toggle — matches any of the same three signals the badges
  // in CandidateCard render (duplicateFlag, historyAlertType, nameMatchId).
  const [fraudOnly, setFraudOnly] = useState(false);
  // Blacklist filter, 2026-07-31 (Vlad's ask) — sits next to the Archived
  // status chip since that's where a candidate gets blacklisted from.
  const [blacklistOnly, setBlacklistOnly] = useState(false);
  // Safety net for the checkbox above being hidden whenever Archived isn't
  // an active status filter, 2026-08-02 — without this, unchecking Archived
  // while Blacklisted-only was on would leave the list silently filtered
  // with no visible control left to turn it back off.
  useEffect(() => {
    if (!statusFilter.has("archived") && blacklistOnly) setBlacklistOnly(false);
  }, [statusFilter, blacklistOnly]);
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState<"default" | "desc" | "asc">("default");

  // Filters panel, redesigned 2026-08-17 (Vlad's ask: collapse the
  // always-visible chip/range row into one "Filters" button) — same
  // ref + outside-click-to-close pattern as SiteHeader.tsx's account menu,
  // reused here rather than inventing a second dropdown convention.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function runSemanticSearch() {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setSemanticSearching(true);
    setSemanticError(null);
    try {
      const res = await fetch("/api/candidates/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Scoped to the active project filter when one is set, same as
        // every other filter on this page — "-1" (No role) isn't a real
        // projectId, so it's deliberately excluded here rather than sent
        // through as a nonsensical filter value.
        body: JSON.stringify({
          query: trimmed,
          projectId: projectFilter && projectFilter > 0 ? projectFilter : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Search failed");
      setSemanticResults(
        (data.results ?? []).map((r: { id: number; similarity: number; matchedTerms?: string[] }) => ({
          screeningId: r.id,
          similarity: r.similarity,
          matchedTerms: r.matchedTerms ?? [],
        }))
      );
    } catch (err) {
      setSemanticError(err instanceof Error ? err.message : "Search failed — try again.");
      setSemanticResults(null);
    } finally {
      setSemanticSearching(false);
    }
  }

  /** alsoClearText: false for the mode-preserving "narrow further" case (unused today, kept for clarity); true resets the box entirely — mode toggle, the inline Clear button, and the global "Clear filters" all want the full reset. */
  function clearSemanticSearch(alsoClearText = true) {
    setSemanticResults(null);
    setSemanticError(null);
    if (alsoClearText) setSearchText("");
  }

  function toggleSearchMode() {
    setSearchMode((m) => (m === "name" ? "skills" : "name"));
    clearSemanticSearch(true);
  }

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

  // Vlad's ask, 2026-07-30 (screenshot: two merged Srinath Venkatesan cards
  // both showing "Previously seen" reads as noisy, especially stacked right
  // under the "Possible duplicate" cluster banner). Within a merged cluster,
  // only the most recently screened member keeps its own historyAlertType
  // badge — mirrors the identical fix on app/projects/[id]/page.tsx's
  // PipelineTab. Doesn't touch historyAlertType itself, purely a display
  // dedup for this one badge.
  const suppressedHistoryAlertIds = useMemo(() => {
    const byCluster = new Map<number, ScreeningRecord[]>();
    for (const s of screenings) {
      if (s.historyAlertType == null) continue;
      const cluster = matchClusters.get(s.id);
      if (!cluster) continue;
      const list = byCluster.get(cluster.index) ?? [];
      list.push(s);
      byCluster.set(cluster.index, list);
    }
    const suppressed = new Set<number>();
    for (const members of byCluster.values()) {
      if (members.length <= 1) continue;
      const latest = members.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
      for (const m of members) if (m.id !== latest.id) suppressed.add(m.id);
    }
    return suppressed;
  }, [screenings, matchClusters]);

  // Card merging, 2026-07-20 (Vlad's ask) — mirrors the same change on
  // app/projects/[id]/page.tsx's PipelineTab. Every matchClusters group now
  // merges into one visual card instead of separate cards linked by a
  // clickable Ring badge; this only decides the merged header/border tint
  // (rose for a real fraud signal, neutral gray otherwise).
  function clusterHasFraudSignal(cluster: MatchCluster | undefined): boolean {
    if (!cluster) return false;
    return cluster.memberIds.some((id) => {
      const m = screenings.find((r) => r.id === id);
      // Narrowed 2026-07-30 (Vlad's ask): a plain "previously_seen" cross-
      // project match is the same real person under two different roles/
      // projects, not fraud — only a real duplicateFlag or the more serious
      // "known_fraud_pattern" alert should still read as a fraud signal.
      // Mirrors the identical fix on app/projects/[id]/page.tsx's PipelineTab.
      return m?.duplicateFlag || m?.historyAlertType === "known_fraud_pattern";
    });
  }

  // Vlad's ask, 2026-07-30 (screenshot: a duplicate pair from Jul 16/Jul 30
  // sitting pinned above every other, more recent candidate): "Ring
  // grouping" used to sort every merged cluster to the top of the page via
  // cluster index as the PRIMARY sort key, regardless of how old its
  // members were. Replaced with item-based grouping — a cluster becomes one
  // "queue item" (its members, most recent first) positioned wherever that
  // MOST RECENT member naturally belongs by date/score, with older siblings
  // connected directly beneath it rather than the whole group jumping to
  // the top. Grouping into items before sorting (instead of sorting raw
  // screenings with a cluster tiebreaker) guarantees a cluster's members
  // can never end up interleaved with an unrelated candidate that happens
  // to share the anchor's score/date. Mirrors the identical fix on
  // app/projects/[id]/page.tsx's PipelineTab.
  function buildQueueItems(list: ScreeningRecord[]): ScreeningRecord[][] {
    const itemsByClusterIndex = new Map<number, ScreeningRecord[]>();
    const items: ScreeningRecord[][] = [];
    for (const s of list) {
      const cluster = matchClusters.get(s.id);
      if (!cluster) { items.push([s]); continue; }
      let item = itemsByClusterIndex.get(cluster.index);
      if (!item) { item = []; itemsByClusterIndex.set(cluster.index, item); items.push(item); }
      item.push(s);
    }
    for (const item of items) item.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }

  // Global talent search, 2026-08-17 — when active, restricts the list to
  // just the matched screening ids and drives sort order by relevance
  // instead of sortOrder/date. Stacks with every other filter below rather
  // than replacing them, per the 2026-08-15 design decision ("results stack
  // with whatever filters are already active"). null = not searching, every
  // line below behaves exactly as it did before this feature existed.
  const semanticRankById = useMemo(() => {
    if (!semanticResults) return null;
    const map = new Map<number, number>();
    semanticResults.forEach((r, i) => map.set(r.screeningId, i));
    return map;
  }, [semanticResults]);

  const semanticTermsById = useMemo(() => {
    const map = new Map<number, string[]>();
    if (semanticResults) for (const r of semanticResults) map.set(r.screeningId, r.matchedTerms);
    return map;
  }, [semanticResults]);

  const filtered = buildQueueItems(
    screenings.filter((s) => {
      if (semanticRankById && !semanticRankById.has(s.id)) return false;
      if (searchMode === "name" && searchText && !s.candidateName.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (statusFilter.size > 0 && !statusFilter.has(s.status)) return false;
      if (projectFilter && s.projectId !== projectFilter) return false;
      if (flaggedOnly && !s.flagged) return false;
      // Narrowed 2026-07-30 (Vlad's ask): the "Multiple roles" cases (a
      // plain "previously_seen" cross-project match, or a same-project
      // nameMatchId) aren't fraud signals — matches clusterHasFraudSignal's
      // definition so this filter and the banner/toggle agree on what
      // counts as "fraud."
      if (fraudOnly && !(s.duplicateFlag || s.historyAlertType === "known_fraud_pattern")) return false;
      if (blacklistOnly && !s.blacklisted) return false;
      if (scoreMin !== "" && s.score < Number(scoreMin)) return false;
      if (scoreMax !== "" && s.score > Number(scoreMax)) return false;
      if (dateFrom && new Date(s.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(s.createdAt) > new Date(`${dateTo}T23:59:59`)) return false;
      return true;
    })
  )
    .sort((itemA, itemB) => {
      // Each item's first member is its most recent — the anchor this
      // item's position is decided by.
      const a = itemA[0];
      const b = itemB[0];
      if (semanticRankById) return (semanticRankById.get(a.id) ?? 0) - (semanticRankById.get(b.id) ?? 0);
      if (sortOrder === "desc") return b.score - a.score;
      if (sortOrder === "asc") return a.score - b.score;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .flat();

  const flaggedCount = screenings.filter((s) => s.flagged).length;
  const blacklistCount = screenings.filter((s) => s.blacklisted).length;

  // Badge count for the collapsed Filters button, 2026-08-17 — deliberately
  // excludes search (name and skills search both have their own visible
  // state right in the search box — a result count / Clear button — so
  // counting them here too would double-report the same thing two ways)
  // and projectFilter (a separate, always-visible control in the page
  // header, not part of this panel).
  const activeFilterCount =
    statusFilter.size + (flaggedOnly ? 1 : 0) + (fraudOnly ? 1 : 0) + (blacklistOnly ? 1 : 0)
    + (scoreMin !== "" ? 1 : 0) + (scoreMax !== "" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

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

  // Blacklist, 2026-07-31 (Vlad's ask) — mirrors handleArchiveReasonChange above.
  function handleBlacklistChange(id: number, blacklisted: boolean, blacklistReason: string | null) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, blacklisted, blacklistReason: blacklistReason ?? undefined } : s));
    fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blacklisted, blacklistReason }) }).catch(() => {});
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
  // optimistic-update-with-rollback shape. referrerName param added
  // 2026-08-26 (Vlad's ask), exact mirror of agencyName.
  function handleSourceChange(id: number, linkedInMode: boolean, agencyName: string, referrerName: string = "") {
    const trimmedAgencyName = linkedInMode ? "" : agencyName.trim();
    const trimmedReferrerName = linkedInMode ? "" : referrerName.trim();
    const previous = screenings.find((s) => s.id === id);
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, linkedInMode, agencyName: trimmedAgencyName || undefined, referrerName: trimmedReferrerName || undefined } : s));
    fetch(`/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedInMode, agencyName: trimmedAgencyName, referrerName: trimmedReferrerName }),
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

  function handleFraudRiskComplete(id: number, assessment: FraudRiskAssessment) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, fraudRisk: assessment } : s));
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

        {/* Filters — redesigned 2026-08-17 (Vlad's ask: two search boxes was
            clutter, and the always-visible chip/range row should collapse
            behind one button). Everything below fits in two rows now: one
            search box with a mode toggle, and a Filters button + sort
            dropdown next to it. */}
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* Unified search box — mode toggle redesigned twice on
                2026-08-17. v1 was a single icon-only button (Vlad: "hard to
                recognize" — no hint it was even clickable). v2 tried a
                two-segment "Name / Skills" control instead (Vlad: didn't
                like it, wanted the single-button idea back, just made
                readable). This is that: one button, same click-to-switch
                behavior as v1, but now shows the CURRENT mode as a text
                label plus a small swap icon — so it reads as "you're in
                Name mode, click to switch" rather than an unlabeled glyph.
                "Name" (default) = instant substring filter, unchanged
                behavior. "Skills" = roadmap 2.5.9's semantic search,
                explicit submit since it's a real API call. */}
            <div className={`relative flex flex-1 items-center rounded-xl border pl-1 pr-3 transition-colors ${
              searchMode === "skills"
                ? "border-violet-200 bg-violet-50/40 dark:border-violet-500/30 dark:bg-violet-500/5"
                : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            } focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100`}>
              <button type="button" onClick={toggleSearchMode}
                title={searchMode === "name" ? "Searching by name — click to search by skill or experience instead" : "Searching by skill/experience — click to search by name instead"}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${searchMode === "skills" ? "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}>
                {searchMode === "name" ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                    <path d="M12 2l1.6 4.9L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.1L12 2z" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="19" cy="17" r="2.5" /><path d="m21 19 2 2" strokeLinecap="round" />
                  </svg>
                )}
                {searchMode === "name" ? "Name" : "Skills"}
                {/* Small swap icon — the one thing v1 was missing: a visual hint this button toggles something, not just a static mode label. */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 opacity-50">
                  <path d="M7 3v14M7 17l-3-3M7 17l3-3M17 21V7M17 7l3 3M17 7l-3 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && searchMode === "skills") runSemanticSearch(); }}
                placeholder={searchMode === "name" ? "Search by name..." : 'Search by skill or experience — e.g. "led a Kubernetes migration"'}
                className="flex-1 bg-transparent py-2.5 pl-2.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
              {searchMode === "skills" && (
                semanticSearching ? (
                  <ScoringLoader className="h-4 w-10 shrink-0" strokeWidth={9} stroke="#7c3aed" />
                ) : semanticResults !== null ? (
                  <button type="button" onClick={() => clearSemanticSearch(true)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-500/15">
                    Clear
                  </button>
                ) : (
                  <button type="button" onClick={runSemanticSearch} disabled={!searchText.trim()}
                    className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
                    Search
                  </button>
                )
              )}
            </div>

            {/* Filters button + panel — collapses what used to be an
                always-visible chip/range row. Badge shows the active count
                so the recruiter gets feedback without opening it. */}
            <div className="relative" ref={filtersRef}>
              <button type="button" onClick={() => setFiltersOpen((v) => !v)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${activeFilterCount > 0 ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
              </button>

              {filtersOpen && (
                // Anchored left-0, not right-0 — 2026-08-17 fix (Vlad: "fix
                // this tab"). This button sits mid-row, not at the page's
                // right edge, so a right-anchored panel grew leftward off
                // an arbitrary point and looked misaligned/adrift from its
                // own trigger. Left-anchored, the panel's edge always lines
                // up with the button that opened it, like a standard
                // dropdown. Also added: a proper header (title + inline
                // "Clear" so it's reachable without hunting for it at the
                // bottom) and divide lines between sections — the previous
                // version was just gap-3'd sections with no visual
                // separation, reading as one undifferentiated block of
                // pills.
                <div className="absolute left-0 top-12 z-50 w-[min(360px,90vw)] rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                    <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Filters</span>
                    {activeFilterCount > 0 && (
                      <button type="button"
                        onClick={() => {
                          setStatusFilter(new Set()); setFlaggedOnly(false); setFraudOnly(false); setBlacklistOnly(false);
                          setScoreMin(""); setScoreMax(""); setDateFrom(""); setDateTo("");
                        }}
                        className="text-xs font-medium text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
                        Clear ({activeFilterCount})
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col divide-y divide-zinc-100 px-4 dark:divide-zinc-800">
                    {/* Flagged / Fraud toggles */}
                    <div className="flex flex-wrap gap-2 py-3">
                      <button type="button" onClick={() => setFlaggedOnly((v) => !v)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${flaggedOnly ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill={flaggedOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 22V15" strokeLinecap="round" />
                        </svg>
                        Flagged{flaggedCount > 0 && ` (${flaggedCount})`}
                      </button>

                      {/* Fraud signals — matches duplicateFlag or a "known_fraud_pattern" historyAlertType only. Narrowed 2026-07-30: plain "previously_seen"/nameMatchId matches ("Multiple roles") are the same real person, not fraud, so they no longer trip this filter. */}
                      <button type="button" onClick={() => setFraudOnly((v) => !v)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${fraudOnly ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-400" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Fraud signals
                      </button>
                    </div>

                    {/* Status filters — multi-select */}
                    <div className="flex flex-wrap gap-2 py-3">
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

                    {/* Score + date-screened ranges — label-above layout,
                        2026-08-17 fix (Vlad: the date row didn't fit). Root
                        cause: native <input type="date"> has a real
                        intrinsic minimum width (~140px in Chrome/Edge for
                        the mm/dd/yyyy + calendar-icon layout) that CSS width
                        can't shrink below — a fixed-width label sitting
                        inline to the left of two of them left nowhere near
                        enough of the panel's ~288px content width for both
                        to fit, so the second one got pushed past the edge.
                        Moving the label onto its own line above frees the
                        full row width for the two inputs; min-w-0 lets flex
                        actually enforce the split evenly instead of each
                        input demanding its full intrinsic size. */}
                    <div className="flex flex-col gap-3 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Score</span>
                        <div className="flex items-center gap-1.5">
                          <input type="number" min={0} max={100} value={scoreMin} onChange={(e) => setScoreMin(e.target.value)}
                            placeholder="Min"
                            className="w-0 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                          <span className="shrink-0 text-xs text-zinc-300 dark:text-zinc-600">–</span>
                          <input type="number" min={0} max={100} value={scoreMax} onChange={(e) => setScoreMax(e.target.value)}
                            placeholder="Max"
                            className="w-0 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">Screened</span>
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                            className="w-0 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 [color-scheme:light] dark:[color-scheme:dark]" />
                          <span className="shrink-0 text-xs text-zinc-300 dark:text-zinc-600">–</span>
                          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                            className="w-0 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 [color-scheme:light] dark:[color-scheme:dark]" />
                        </div>
                      </div>
                    </div>

                    {/* Blacklist filter, 2026-07-31 (Vlad's ask) — only
                        meaningful while the Archived status filter is
                        active. A useEffect above resets this back to false
                        the moment Archived is turned off, so it can never
                        silently keep filtering from inside a closed panel.
                        Own divided section so it doesn't look glued to the
                        date range above it when visible. */}
                    {statusFilter.has("archived") && (
                      <label className="flex w-fit cursor-pointer items-center gap-2 py-3 text-sm text-zinc-500 dark:text-zinc-400">
                        <input type="checkbox" checked={blacklistOnly} onChange={(e) => setBlacklistOnly(e.target.checked)}
                          className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 accent-rose-600 dark:border-zinc-600" />
                        Blacklisted only{blacklistCount > 0 && ` (${blacklistCount})`}
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sort */}
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

          {semanticError && (
            <p className="text-xs text-rose-500 dark:text-rose-400">{semanticError}</p>
          )}
          {semanticResults !== null && !semanticSearching && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {semanticResults.length === 0
                ? `No matches for "${searchText}".`
                : `${semanticResults.length} match${semanticResults.length !== 1 ? "es" : ""} for "${searchText}", ranked by relevance.`}
            </p>
          )}

          {/* Overall active-filter summary — covers everything, including
              search, so there's always feedback even with the panel closed. */}
          {(activeFilterCount > 0 || (searchMode === "name" && searchText) || semanticResults !== null) && (
            <button type="button"
              onClick={() => {
                setStatusFilter(new Set()); setFlaggedOnly(false); setFraudOnly(false); setBlacklistOnly(false);
                setScoreMin(""); setScoreMax(""); setDateFrom(""); setDateTo("");
                setSearchText(""); clearSemanticSearch(false);
              }}
              className="self-start text-xs text-violet-500 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
              Clear all · {filtered.length} of {screenings.length} shown
            </button>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            <ScoringLoader className="h-10 w-72" />
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
              // "Multiple roles" collapsed profile, 2026-07-30 — see
              // expandedClusters' doc comment above. Mirrors PipelineTab.
              const isNonFraudCluster = isMergeable && !clusterIsFraud;
              const clusterExpanded = cluster != null && expandedClusters.has(cluster.index);
              const hiddenAsCollapsedSibling = isNonFraudCluster && mergePosition !== "first" && mergePosition !== "solo" && !clusterExpanded;
              return (
                <Fragment key={s.id}>
                  {/* Vlad's ask, 2026-07-30: hide this banner for plain
                      "Same person" resubmissions with no real duplicate/
                      fraud signal — see the matching change in
                      app/projects/[id]/page.tsx's PipelineTab for the full
                      reasoning. Only a real clusterIsFraud still gets a
                      labeled header above the merged group. */}
                  {mergePosition === "first" && clusterIsFraud && (
                    <li aria-hidden className="flex items-center gap-1.5 rounded-t-2xl border border-b-0 border-rose-200 bg-rose-50/70 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                        <circle cx="9" cy="9" r="4" /><circle cx="15" cy="15" r="4" />
                      </svg>
                      Possible duplicate · {mergeGroupSize} submissions
                    </li>
                  )}
                  {/* "Multiple roles" toggle, redesigned 2026-07-30 (Vlad's
                      ask): moved out of the inline badge row into a
                      full-width bar sitting on top of the card — same
                      footprint as the "Possible duplicate" banner above, but
                      neutral-toned (this isn't a fraud signal) and itself
                      clickable across its full width. Stays visible whether
                      collapsed or expanded, acting as a persistent header
                      for "one profile, multiple submissions." Mirrors
                      PipelineTab exactly. */}
                  {mergePosition === "first" && isNonFraudCluster && (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          const idx2 = cluster!.index;
                          setExpandedClusters((prev) => {
                            const next = new Set(prev);
                            if (next.has(idx2)) next.delete(idx2); else next.add(idx2);
                            return next;
                          });
                        }}
                        title={clusterExpanded ? "Hide older submissions" : "This candidate has other submissions — click to show them"}
                        className="flex w-full items-center gap-1.5 rounded-t-2xl border border-b-0 border-zinc-200 bg-zinc-50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        Multiple roles · {mergeGroupSize} submissions
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`ml-auto shrink-0 transition-transform ${clusterExpanded ? "rotate-180" : ""}`}>
                          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </li>
                  )}
                  <CandidateCard screening={s}
                    projectName={proj?.name}
                    projectId={proj?.id}
                    matchedTerms={semanticTermsById.get(s.id)}
                    trackerStage={stagesMap[s.id]}
                    mergePosition={mergePosition}
                    clusterIsFraud={clusterIsFraud}
                    suppressHistoryAlert={suppressedHistoryAlertIds.has(s.id)}
                    isNonFraudCluster={isNonFraudCluster}
                    hiddenAsCollapsedSibling={hiddenAsCollapsedSibling}
                    clusterExpanded={clusterExpanded}
                    onStatusChange={handleStatusChange}
                    onStageChange={handleStageChange}
                    onArchiveReasonChange={handleArchiveReasonChange}
                    onBlacklistChange={handleBlacklistChange}
                    onFlagToggle={handleFlagToggle}
                    onDelete={handleDelete}
                    onSaveNotes={handleSaveNotes}
                    onCredibilityComplete={handleCredibilityComplete}
                    onFraudRiskComplete={handleFraudRiskComplete}
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
