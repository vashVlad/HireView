"use client";

import { ARCHIVE_REASONS, CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS, TRACKER_STAGES, type CandidateStatus, type TrackerStage } from "@/lib/types";
import { STATUS_COLORS } from "./StatusSelect";

const STAGE_TEXT_COLORS: Record<TrackerStage, string> = {
  TA: "text-blue-700 dark:text-blue-400",
  L1: "text-violet-700 dark:text-violet-400",
  L2: "text-indigo-700 dark:text-indigo-400",
  "In-Person": "text-amber-700 dark:text-amber-400",
  Offer: "text-emerald-700 dark:text-emerald-400",
  Reject: "text-rose-700 dark:text-rose-400",
};

/**
 * Merged status + tracker-stage control. Replaces what used to be two
 * separate, visually unrelated dropdown pills (StatusSelect + the now-
 * removed TrackerStageSelect) rendered side by side on the Pipeline and
 * All Candidates cards — Vlad's ask, 2026-07-15: "make the interview data
 * connected with the indicator, so it looks like it's one thing instead of
 * two separate ones."
 *
 * Renders as a single bordered pill colored by status. When status is
 * "screening" (the container for the whole TA/L1/L2/In-Person/Offer/Reject
 * arc, since "interview" was removed as a separate status — see
 * decisions-log.md), a second segment for the TrackerStage appears joined
 * onto the same pill with a thin divider, instead of a second, disconnected
 * pill. First pass on the visual treatment — iterate based on how it reads
 * in practice.
 *
 * StatusSelect itself is untouched and still used standalone where there's
 * no tracker stage concept yet (e.g. ResultCard.tsx's freshly-scored,
 * not-yet-in-tracker view).
 *
 * When status is "archived", a reason segment appears the same way the
 * stage segment does for "screening" — Vlad's ask, 2026-07-15: capture why
 * a candidate was archived using a fixed reason list (ARCHIVE_REASONS),
 * mirroring the Reject stage's reason field but inline on the status pill
 * itself, since Archived is reachable from any status (not just from within
 * the Tracker). `archiveReason`/`onArchiveReasonChange` are optional so
 * callers that don't care about this yet don't have to wire it up.
 */
export function StatusStageControl({
  status,
  stage,
  onStatusChange,
  onStageChange,
  archiveReason,
  onArchiveReasonChange,
}: {
  status: CandidateStatus;
  stage: TrackerStage | null;
  onStatusChange: (status: CandidateStatus) => void;
  onStageChange: (stage: TrackerStage) => void;
  archiveReason?: string | null;
  onArchiveReasonChange?: (reason: string) => void;
}) {
  const showStage = status === "screening";
  const showArchiveReason = status === "archived" && onArchiveReasonChange !== undefined;

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-0 overflow-hidden rounded-full border pr-2 text-xs font-medium ${STATUS_COLORS[status]}`}
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={status}
        onChange={(e) => onStatusChange(e.target.value as CandidateStatus)}
        className="cursor-pointer appearance-none bg-transparent py-1 pl-2.5 pr-1 outline-none"
      >
        {CANDIDATE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CANDIDATE_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {showStage && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-current opacity-25" />
          <select
            value={stage ?? ""}
            onChange={(e) => { if (e.target.value) onStageChange(e.target.value as TrackerStage); }}
            className={`cursor-pointer appearance-none bg-transparent py-1 pl-1.5 pr-1 outline-none ${stage ? STAGE_TEXT_COLORS[stage] : "opacity-60"}`}
          >
            <option value="" disabled>Stage</option>
            {TRACKER_STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </>
      )}
      {showArchiveReason && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-current opacity-25" />
          <select
            value={archiveReason ?? ""}
            onChange={(e) => { if (e.target.value) onArchiveReasonChange!(e.target.value); }}
            title={archiveReason || "Reason"}
            className={`w-16 max-w-16 cursor-pointer appearance-none truncate bg-transparent py-1 pl-1.5 pr-1 outline-none ${archiveReason ? "" : "opacity-60"}`}
          >
            <option value="" disabled>Reason</option>
            {ARCHIVE_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </>
      )}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="pointer-events-none ml-0.5 shrink-0 opacity-50">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
