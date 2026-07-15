"use client";

import { useState } from "react";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { CheckExistingResult } from "@/lib/types";

interface AlreadyScreenedCardProps {
  fileName: string;
  existing: NonNullable<CheckExistingResult["existing"]>;
  file: File;
  onForceRescore: (file: File) => void;
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
}: AlreadyScreenedCardProps) {
  const [rescoring, setRescoring] = useState(false);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ScoreBadge score={existing.score} size="md" />
          <div>
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">{existing.candidateName}</p>
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
