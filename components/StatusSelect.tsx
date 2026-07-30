"use client";

import { useState } from "react";
import { ARCHIVE_REASONS, CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS, type CandidateStatus } from "@/lib/types";

// Exported so StatusStageControl.tsx (the merged status+stage pill used on
// Pipeline/All Candidates cards) can color its outer border/background to
// match a standalone StatusSelect exactly, instead of duplicating this map.
export const STATUS_COLORS: Record<CandidateStatus, string> = {
  new_applicant:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  recruiter_screen:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  contacted:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  // Container status for the whole TA/L1/L2/In-Person/Offer/Reject arc as of
  // 2026-07-15 — "interview" (previously a separate status) was removed and
  // folded into this one. See decisions-log.md.
  screening:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400",
  archived:
    "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500",
  // Added 2026-07-29 — same sky-blue this project already used for the
  // (now superseded) "Moved to X" Pipeline badge, so the visual language
  // carries over to its replacement.
  transferred:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
};

export function StatusSelect({
  status,
  onChange,
  archiveReason,
  onArchiveReasonChange,
}: {
  status: CandidateStatus;
  onChange: (status: CandidateStatus) => void;
  /**
   * Optional archive-reason segment, joined onto the status pill exactly
   * like StatusStageControl's reason picker on Pipeline/All Candidates cards
   * — added 2026-07-15 because this post-screening ResultCard was the one
   * place archiving a candidate showed no reason picker at all ("it only
   * shows the status now," Vlad's report). Omit both props to keep the
   * plain single-select StatusSelect always was — every other call site of
   * this component doesn't need the reason segment.
   */
  archiveReason?: string | null;
  onArchiveReasonChange?: (reason: string) => void;
}) {
  // Archiving requires a reason before it commits — Vlad's ask, 2026-07-20
  // (same fix as StatusStageControl.tsx, see that component's doc comment
  // for the full reasoning). Picking "Archived" reveals the reason picker
  // without changing the real status yet; `onChange("archived")` only fires
  // once an actual reason is picked, alongside `onArchiveReasonChange`.
  const [pendingArchive, setPendingArchive] = useState(false);
  // General confirm/cancel gate for every OTHER status change, 2026-07-29 —
  // same reasoning and pattern as StatusStageControl.tsx (status changes
  // "can be accidental" and every one gets logged to Activity). Archived
  // keeps its own gate above untouched — picking a reason already is its
  // confirm step.
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null);
  const gateOnReason = onArchiveReasonChange !== undefined;
  const displayStatus = pendingArchive ? "archived" : pendingStatus ?? status;
  const showArchiveReason = (status === "archived" || pendingArchive) && gateOnReason;
  const showConfirmCancel = pendingStatus !== null;

  function confirmPending() {
    if (pendingStatus !== null) onChange(pendingStatus);
    setPendingStatus(null);
  }

  function cancelPending() {
    setPendingStatus(null);
  }

  // Vlad's ask, 2026-07-30: once a new status is picked, don't keep showing
  // its name — that reads as "already changed." While pending, the select
  // is replaced entirely by Confirm/Cancel (mirrors StatusStageControl.tsx's
  // statusPending treatment) so the only visible thing is the action still
  // required.
  // Width-preserving trick, Vlad's ask 2026-07-30 — see
  // StatusStageControl.tsx's matching comment for the full reasoning: an
  // invisible copy of the CURRENT status label reserves the same width that
  // status's normal chip would take, so this pill doesn't visibly shrink to
  // just the icons' width while pending.
  const statusSelect = showConfirmCancel ? (
    <span className="relative flex shrink-0 items-center py-1 pl-2.5 pr-1">
      <span className="invisible whitespace-nowrap">{CANDIDATE_STATUS_LABELS[status]}</span>
      {/* Split into two equal halves, Vlad's ask 2026-07-30 — mirrors
          StatusStageControl.tsx's matching change: Confirm and Cancel each
          center within their own half of the pill's reserved width. */}
      <span className="absolute inset-0 flex items-stretch">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); confirmPending(); }}
          title="Confirm"
          className="flex flex-1 items-center justify-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); cancelPending(); }}
          title="Cancel"
          className="flex flex-1 items-center justify-center text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
    </span>
  ) : (
    <select
      value={displayStatus}
      onChange={(e) => {
        const next = e.target.value as CandidateStatus;
        if (next === status) { setPendingStatus(null); return; }
        if (next === "archived" && gateOnReason) {
          setPendingArchive(true);
          setPendingStatus(null);
          return;
        }
        setPendingArchive(false);
        setPendingStatus(next);
      }}
      className={showArchiveReason
        ? "cursor-pointer appearance-none bg-transparent py-1 pl-2.5 pr-1 text-xs font-medium outline-none"
        : `shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium outline-none ${STATUS_COLORS[displayStatus]}`}
    >
      {CANDIDATE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {CANDIDATE_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );

  if (!showArchiveReason && !showConfirmCancel) return statusSelect;

  return (
    <div className={`inline-flex shrink-0 items-center gap-0 overflow-hidden rounded-full border pr-2 text-xs font-medium ${STATUS_COLORS[displayStatus]}`}>
      {statusSelect}
      {showArchiveReason && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-current opacity-25" />
          <select
            value={pendingArchive ? "" : (archiveReason ?? "")}
            onChange={(e) => {
              const reason = e.target.value;
              if (!reason) return;
              onArchiveReasonChange!(reason);
              if (pendingArchive) {
                onChange("archived");
                setPendingArchive(false);
              }
            }}
            title={archiveReason || "Reason"}
            className={`w-16 max-w-16 cursor-pointer appearance-none truncate bg-transparent py-1 pl-1.5 pr-1 outline-none ${archiveReason && !pendingArchive ? "" : "opacity-60"}`}
          >
            <option value="" disabled>Reason</option>
            {ARCHIVE_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
