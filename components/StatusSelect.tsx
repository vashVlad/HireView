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
  const gateOnReason = onArchiveReasonChange !== undefined;
  const displayStatus = pendingArchive ? "archived" : status;
  const showArchiveReason = (status === "archived" || pendingArchive) && gateOnReason;

  const statusSelect = (
    <select
      value={displayStatus}
      onChange={(e) => {
        const next = e.target.value as CandidateStatus;
        if (next === "archived" && gateOnReason) {
          setPendingArchive(true);
          return;
        }
        setPendingArchive(false);
        onChange(next);
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

  if (!showArchiveReason) return statusSelect;

  return (
    <div className={`inline-flex shrink-0 items-center gap-0 overflow-hidden rounded-full border pr-2 text-xs font-medium ${STATUS_COLORS[displayStatus]}`}>
      {statusSelect}
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
    </div>
  );
}
