"use client";

import { useState } from "react";
import { ScoreBadge } from "@/components/ScoreBadge";
import { CrossReferenceChecker } from "@/components/CredibilityChecker";
import type { CheckExistingResult, CredibilityAssessment } from "@/lib/types";

interface AlreadyScreenedCardProps {
  fileName: string;
  status: "duplicate" | "possible_update";
  existing: NonNullable<CheckExistingResult["existing"]>;
  file: File;
  roleContext: string;
  onForceRescore: (file: File) => void;
}

/**
 * Set-aside card for a batch upload that matched an existing screening in
 * this project before any Claude call ran (see
 * app/api/screen-resumes/check-existing/route.ts). Two flavors:
 *
 *   "duplicate" — exact same resume content already screened here. Nothing
 *   to compare, so the only real option is "Re-screen anyway" for a recruiter
 *   who has a specific reason to force a fresh pass (rubric/threshold changed).
 *
 *   "possible_update" — same filename, different content. Might be a
 *   genuinely edited resume, might be coincidence. Offers a credibility
 *   comparison (reusing the existing Credibility Checker, pre-filled with
 *   this upload as the cross-reference doc) instead of guessing either way.
 */
export function AlreadyScreenedCard({
  fileName,
  status,
  existing,
  file,
  roleContext,
  onForceRescore,
}: AlreadyScreenedCardProps) {
  const [assessment, setAssessment] = useState<CredibilityAssessment | null>(null);
  const [rescoring, setRescoring] = useState(false);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ScoreBadge score={existing.score} size="md" />
          <div>
            <p className="font-semibold text-zinc-900 dark:text-zinc-50">{existing.candidateName}</p>
            <p className="mt-0.5 text-sm text-amber-700 dark:text-amber-400">
              {status === "duplicate"
                ? "Already screened in this project — identical resume, skipped scoring."
                : "Filename matches a candidate already screened in this project — resume content differs."}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Uploaded as {fileName}</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">{existing.summary}</p>

      {status === "possible_update" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Compare against the previous resume
          </p>
          <CrossReferenceChecker
            screeningId={existing.id}
            roleContext={roleContext}
            initialFile={file}
            currentAssessment={assessment ?? undefined}
            onComplete={setAssessment}
          />
        </div>
      )}

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
