"use client";

import { useState } from "react";
import { ScoreBadge } from "@/components/ScoreBadge";
import { STATUS_COLORS, StatusSelect } from "@/components/StatusSelect";
import { CANDIDATE_STATUS_LABELS, type CandidateStatus, type CheckExistingResult } from "@/lib/types";

interface AlreadyScreenedCardProps {
  fileName: string;
  existing: NonNullable<CheckExistingResult["existing"]>;
  file: File;
  onForceRescore: (file: File) => void;
  /**
   * Vlad's ask, 2026-07-20: "let me also change the status instead of just
   * showing it to me" — this card used to render a read-only copy of
   * StatusSelect's joined status+reason pill (see the comment this replaced,
   * dated 2026-07-17). Both optional so the card still renders fine (falls
   * back to the old static pill) if a future call site doesn't wire them up.
   */
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  onArchiveReasonChange?: (id: number, archiveReason: string) => void;
}

/**
 * Set-aside card for a batch upload that exactly matched an existing
 * screening's content in this project before any Claude call ran (see
 * app/api/screen-resumes/check-existing/route.ts) — nothing new to learn, so
 * the only real option is "Re-screen anyway" for a recruiter who has a
 * specific reason to force a fresh pass (rubric/threshold changed).
 *
 * Used to also handle a "possible_update" (filename-only match) flavor with
 * its own credibility-comparison UI — removed 2026-07-15 along with the
 * filename-matching signal itself (see decisions-log.md). This card is now
 * exact-content-duplicate only, matching the one remaining CheckExistingResult
 * status that ever reaches it (app/projects/[id]/page.tsx only ever routes
 * "duplicate" here).
 */
export function AlreadyScreenedCard({
  fileName,
  existing,
  file,
  onForceRescore,
  onStatusChange,
  onArchiveReasonChange,
}: AlreadyScreenedCardProps) {
  const [rescoring, setRescoring] = useState(false);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ScoreBadge score={existing.score} size="md" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{existing.candidateName}</p>
              {onStatusChange ? (
                // Editable, 2026-07-20 (Vlad's ask) — same StatusSelect used
                // on the post-screening ResultCard and Pipeline/All
                // Candidates cards, so a recruiter can move this candidate
                // straight from a re-upload without switching to the
                // Pipeline tab. onClick stopPropagation matches every other
                // StatusSelect call site (this card isn't itself clickable,
                // but keeps the pattern consistent).
                <div onClick={(e) => e.stopPropagation()}>
                  <StatusSelect
                    status={existing.status}
                    onChange={(status) => onStatusChange(existing.id, status)}
                    archiveReason={existing.archiveReason}
                    onArchiveReasonChange={
                      onArchiveReasonChange ? (reason) => onArchiveReasonChange(existing.id, reason) : undefined
                    }
                  />
                </div>
              ) : (
                // Fallback: read-only equivalent of StatusSelect's joined
                // status+reason pill, kept for any call site that doesn't
                // wire up onStatusChange. Same visual grammar (single
                // rounded pill, `·`-divider via a low-opacity currentColor
                // rule) as the editable version above.
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[existing.status]}`}
                >
                  {CANDIDATE_STATUS_LABELS[existing.status]}
                  {existing.status === "archived" && existing.archiveReason && (
                    <>
                      <span className="h-2.5 w-px shrink-0 bg-current opacity-25" />
                      {existing.archiveReason}
                    </>
                  )}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-400">
              Already screened in this project — identical resume, skipped scoring.
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Uploaded as {fileName}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">{existing.summary}</p>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={rescoring}
          onClick={() => {
            setRescoring(true);
            onForceRescore(file);
          }}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {rescoring ? "Re-screening…" : "Re-screen anyway"}
        </button>
      </div>
    </li>
  );
}
