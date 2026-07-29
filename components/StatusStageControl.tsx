"use client";

import { useState } from "react";
import Link from "next/link";
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
 *
 * Archiving now REQUIRES a reason before it actually commits — Vlad's ask,
 * 2026-07-20: picking "Archived" used to flip the real status immediately
 * (and, filtered to a status like "Recruiter Screen," made the card vanish
 * from view right then), with the reason only capturable as a disconnected
 * follow-up afterward. Now, when `onArchiveReasonChange` is wired up,
 * picking "Archived" just reveals the reason picker without committing
 * anything yet — the status select visually shows "Archived" as chosen, but
 * `onStatusChange` doesn't fire (and the candidate doesn't move) until an
 * actual reason is picked from the second dropdown, at which point both the
 * status and the reason commit together in one step. Picking any other
 * status while this pending state is showing just cancels it normally.
 */
export function StatusStageControl({
  status,
  stage,
  onStatusChange,
  onStageChange,
  archiveReason,
  onArchiveReasonChange,
  transferProjects,
  onTransfer,
  transferredToProjectName,
  transferredToScreeningId,
}: {
  status: CandidateStatus;
  stage: TrackerStage | null;
  onStatusChange: (status: CandidateStatus) => void;
  onStageChange: (stage: TrackerStage) => void;
  archiveReason?: string | null;
  onArchiveReasonChange?: (reason: string) => void;
  /**
   * Projects this recruiter/admin can transfer INTO — already scoped by the
   * caller (recruiter: own team only, admin: everything — GET /api/projects
   * via teamIdsFilter, see lib/auth.ts), current project already excluded.
   * Omit (or pass an empty array) to keep "Transferred" from ever
   * committing — same "no picker wired up, nothing happens" convention as
   * archiveReason/onArchiveReasonChange above.
   */
  transferProjects?: { id: number; name: string }[];
  /**
   * Vlad's ask, 2026-07-29: "add an option to transfer the candidate to
   * another project from the status dropdown." Picking "Transferred" from
   * the status select doesn't commit anything by itself (same gated
   * pattern as Archived's reason picker below) — it reveals a project
   * picker, and only once a destination is actually chosen does this fire.
   * Real async work happens server-side (a new, separately-scored screening
   * gets created in the destination project) before the status here
   * actually flips — so this is awaited, with its own loading/error state,
   * same convention as ResultCard.tsx's existing handleTransfer for the
   * Fit Suggestion's "Transfer to X" button.
   */
  onTransfer?: (projectId: number) => Promise<void>;
  /** Only meaningful when status === "transferred". Rendered as a small, non-editable link once a transfer has actually completed — not a re-pickable dropdown, since re-transferring isn't a supported flow yet. */
  transferredToProjectName?: string;
  /** Powers the small "view" link straight to the new screening's own full-result page — Vlad's ask: "add a link next to that chip that will transfer the user to the exact result card in that project. make it small tho." */
  transferredToScreeningId?: number;
}) {
  const [pendingArchive, setPendingArchive] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const gateOnReason = onArchiveReasonChange !== undefined;
  const gateOnTransfer = onTransfer !== undefined && !!transferProjects?.length;
  const displayStatus = pendingArchive ? "archived" : pendingTransfer ? "transferred" : status;
  const showStage = status === "screening" && !pendingArchive && !pendingTransfer;
  const showArchiveReason = (status === "archived" || pendingArchive) && gateOnReason;
  // Only while genuinely pending a destination pick — once status is
  // already "transferred" server-side, the small link view below replaces
  // this segment instead of a re-editable select.
  const showTransferPicker = pendingTransfer && gateOnTransfer;
  const showTransferredLink = status === "transferred" && !pendingTransfer && transferredToScreeningId != null;

  async function commitTransfer(projectId: number) {
    if (!onTransfer || transferring) return;
    setTransferring(true);
    setTransferError(null);
    try {
      await onTransfer(projectId);
      setPendingTransfer(false);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-0 overflow-hidden rounded-full border pr-2 text-xs font-medium ${STATUS_COLORS[displayStatus]}`}
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={displayStatus}
        onChange={(e) => {
          const next = e.target.value as CandidateStatus;
          if (next === "archived" && gateOnReason) {
            setPendingTransfer(false);
            setPendingArchive(true);
            return;
          }
          if (next === "transferred" && gateOnTransfer) {
            setPendingArchive(false);
            setPendingTransfer(true);
            setTransferError(null);
            return;
          }
          setPendingArchive(false);
          setPendingTransfer(false);
          onStatusChange(next);
        }}
        className="cursor-pointer appearance-none bg-transparent py-1 pl-2.5 pr-1 outline-none"
      >
        {CANDIDATE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CANDIDATE_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {showTransferPicker && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-current opacity-25" />
          {transferError && (
            <span className="truncate px-1 text-[10px] text-rose-500" title={transferError}>
              {transferError}
            </span>
          )}
          <select
            value=""
            disabled={transferring}
            onChange={(e) => {
              const projectId = Number(e.target.value);
              if (projectId) commitTransfer(projectId);
            }}
            className="w-20 max-w-20 cursor-pointer appearance-none truncate bg-transparent py-1 pl-1.5 pr-1 opacity-60 outline-none disabled:cursor-wait"
          >
            <option value="" disabled>{transferring ? "Transferring…" : "To project…"}</option>
            {transferProjects!.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </>
      )}
      {showTransferredLink && (
        <>
          <span className="h-3.5 w-px shrink-0 bg-current opacity-25" />
          <Link
            href={`/candidates/${transferredToScreeningId}`}
            onClick={(e) => e.stopPropagation()}
            title={`View the result card in "${transferredToProjectName ?? "that project"}"`}
            className="max-w-20 truncate py-1 pl-1.5 pr-1 text-[10px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
          >
            {transferredToProjectName ?? "View"}
          </Link>
        </>
      )}
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
            value={pendingArchive ? "" : (archiveReason ?? "")}
            onChange={(e) => {
              const reason = e.target.value;
              if (!reason) return;
              onArchiveReasonChange!(reason);
              // Completes the gated transition: status only actually becomes
              // "archived" once a reason is picked — see this component's
              // doc comment above.
              if (pendingArchive) {
                onStatusChange("archived");
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
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="pointer-events-none ml-0.5 shrink-0 opacity-50">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
