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
 *
 * Every OTHER status/stage change is now gated the same conceptual way, as
 * of 2026-07-29 (Vlad: status changes "can be accidental" and every one
 * gets logged to Activity, which "we can avoid"). Picking a value shows it
 * as pending — the select visually reflects the pick — but neither
 * `onStatusChange` nor `onStageChange` fires, and nothing is logged, until
 * an explicit Confirm click. Cancel (or picking a different value) discards
 * the pending pick with zero side effects. Archived keeps its own existing
 * gate above untouched (picking a reason already IS its confirm step,
 * doubling that up with a second Confirm click would be redundant).
 */
export function StatusStageControl({
  status,
  stage,
  onStatusChange,
  onStageChange,
  archiveReason,
  onArchiveReasonChange,
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
   * Read-only display only — Vlad's ask, 2026-07-29, redesigned same day:
   * "Transferred" is no longer something you pick from this dropdown (that
   * turned out to be the wrong shape once he tested it — see
   * components/TransferControl.tsx for the real flow, now a dedicated
   * button at the bottom of the card). This pill just needs to render
   * "Transferred" correctly and link to the destination once one has
   * already happened elsewhere.
   */
  transferredToProjectName?: string;
  /** Powers the small "view" link straight to the new screening's own full-result page — Vlad's ask: "add a link next to that chip that will transfer the user to the exact result card in that project. make it small tho." */
  transferredToScreeningId?: number;
}) {
  const [pendingArchive, setPendingArchive] = useState(false);
  // General confirm/cancel gate, 2026-07-29 — see doc comment above. Only
  // one of these is ever meaningfully set at a time in normal use (a
  // recruiter changes status OR stage, not both in the same click), but
  // they're independent so a stray pending stage pick can't get silently
  // dropped by an unrelated status change or vice versa.
  const [pendingStatus, setPendingStatus] = useState<CandidateStatus | null>(null);
  const [pendingStage, setPendingStage] = useState<TrackerStage | null>(null);
  // Vlad's ask, 2026-07-30: once a new status is picked, don't keep showing
  // its name in the pill — that reads as "already changed" and it's easy to
  // walk away thinking the click alone was enough. While a status is
  // pending, the select is replaced entirely by Confirm/Cancel (below) so
  // the ONLY thing visible is the explicit action still required. Scoped to
  // status specifically, per Vlad's wording — stage-only pending keeps its
  // existing inline label + trailing Confirm/Cancel.
  const statusPending = pendingStatus !== null;
  const gateOnReason = onArchiveReasonChange !== undefined;
  const displayStatus = pendingArchive ? "archived" : pendingStatus ?? status;
  const showStage = displayStatus === "screening" && !pendingArchive;
  const showArchiveReason = (status === "archived" || pendingArchive) && gateOnReason;
  const showTransferredLink = status === "transferred" && transferredToScreeningId != null;

  function confirmPending() {
    if (pendingStatus !== null) onStatusChange(pendingStatus);
    if (pendingStage !== null) onStageChange(pendingStage);
    setPendingStatus(null);
    setPendingStage(null);
  }

  function cancelPending() {
    setPendingStatus(null);
    setPendingStage(null);
  }
  // "Transferred" is never offered as something to pick FROM another
  // status — it only ever gets set by TransferControl's own commit flow —
  // but if a candidate already IS "transferred", it still needs to appear
  // as the select's current value (and stay pickable back to, e.g., a
  // recruiter manually reverting it), or the native <select> would show a
  // blank/mismatched value.
  const selectableStatuses = CANDIDATE_STATUSES.filter((s) => s !== "transferred" || s === status);

  return (
    <div
      className={`inline-flex shrink-0 items-center gap-0 overflow-hidden rounded-full border pr-2 text-xs font-medium ${STATUS_COLORS[displayStatus]}`}
      onClick={(e) => e.stopPropagation()}
    >
      {statusPending ? (
        // Width-preserving trick, Vlad's ask 2026-07-30: the confirm/cancel-
        // only chip was shrinking down to just the icons' width, a visibly
        // smaller/different-looking pill than every other status chip next
        // to it. An invisible copy of the CURRENT (pre-pick) status label
        // reserves the exact width that status's own chip would normally
        // take — same font/padding, just `invisible` — while the actual
        // Confirm/Cancel buttons render on top of it via absolute
        // positioning, so the pill never visibly resizes when it enters the
        // pending state.
        <span className="relative flex shrink-0 items-center py-1 pl-2.5 pr-1">
          <span className="invisible whitespace-nowrap">{CANDIDATE_STATUS_LABELS[status]}</span>
          <span className="absolute inset-0 flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); confirmPending(); }}
              title="Confirm"
              className="flex shrink-0 items-center justify-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); cancelPending(); }}
              title="Cancel"
              className="flex shrink-0 items-center justify-center text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400"
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
            // Doesn't commit yet — replaces this select with Confirm/Cancel
            // until one is clicked. See this component's doc comment.
            setPendingStatus(next);
          }}
          className="cursor-pointer appearance-none bg-transparent py-1 pl-2.5 pr-1 outline-none"
        >
          {selectableStatuses.map((s) => (
            <option key={s} value={s}>
              {CANDIDATE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
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
            value={pendingStage ?? stage ?? ""}
            onChange={(e) => {
              if (!e.target.value) return;
              const next = e.target.value as TrackerStage;
              setPendingStage(next === stage ? null : next);
            }}
            className={`cursor-pointer appearance-none bg-transparent py-1 pl-1.5 pr-1 outline-none ${(pendingStage ?? stage) ? STAGE_TEXT_COLORS[pendingStage ?? stage!] : "opacity-60"}`}
          >
            <option value="" disabled>Stage</option>
            {TRACKER_STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </>
      )}
      {/* Stage always gets its own trailing Confirm/Cancel whenever it has a
          pending pick — Vlad's ask, 2026-07-30: "make the user confirm the
          stages as well." Previously suppressed when statusPending was also
          true (to avoid a duplicate-looking pair), but that meant a stage
          pick made while a status change was ALSO pending had no visible
          confirmation gate of its own — it silently rode along on the
          status segment's Confirm/Cancel with nothing next to the stage
          value indicating it needed one too. Both rows call the same
          confirmPending()/cancelPending(), so clicking either one commits
          or discards everything pending together — showing both is about
          making each segment's pending state visible, not adding a second
          independent gate. */}
      {/* No divider before this group — Vlad's ask, 2026-07-30: "show the
          stage and the buttons on the same field to confirm the pick." A
          "|" divider here made the stage value and its own Confirm/Cancel
          read as two unrelated segments; dropping it groups "L1  ✓ ✗" as
          one field, same idea as the status-pending overlay's icons sitting
          directly where the label was. */}
      {pendingStage !== null && (
        <span className="flex shrink-0 items-center gap-2.5 py-1 pl-1 pr-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); confirmPending(); }}
            title="Confirm"
            className="flex shrink-0 items-center justify-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cancelPending(); }}
            title="Cancel"
            className="flex shrink-0 items-center justify-center text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </span>
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
