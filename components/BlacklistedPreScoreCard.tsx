"use client";

import { useState } from "react";
import type { BlacklistEntry } from "@/lib/types";

interface BlacklistedPreScoreCardProps {
  fileName: string;
  blacklistMatch: BlacklistEntry;
  /**
   * Undefined after a batch-results restore (sessionStorage, see ScreenTab
   * in app/projects/[id]/page.tsx) — the raw File object can't be persisted
   * across a remount. Same pattern as AlreadyScreenedCard.tsx's identical
   * `file` prop — "Score anyway" is disabled instead, with the same
   * "try re-uploading" tooltip.
   */
  file?: File;
  onForceScore: (file: File) => void;
}

/**
 * Set-aside card for a batch upload that the free, local
 * extractNameHeuristic() pre-check (app/api/screen-resumes/check-existing)
 * matched against the system-wide blacklist BEFORE any Claude call ran —
 * 2026-08-20, fixing a real cost/correctness bug Claude Code's full-system
 * audit flagged: a blacklisted candidate was getting fully re-scored (a real
 * Claude API call) every single time they were re-uploaded, with the
 * blacklist warning only ever showing up after the fact. Modeled directly on
 * AlreadyScreenedCard.tsx's "set aside before it costs anything, but let the
 * recruiter override" shape — the one real difference is there's no
 * `existing` saved screening to show here (this candidate was never scored
 * in THIS project), just the matched blacklist entry itself.
 */
export function BlacklistedPreScoreCard({ fileName, blacklistMatch, file, onForceScore }: BlacklistedPreScoreCardProps) {
  const [scoring, setScoring] = useState(false);

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-zinc-950 bg-zinc-950 p-5 text-white dark:border-white dark:bg-white dark:text-zinc-950">
      <div className="flex items-start gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5 shrink-0">
          <circle cx="12" cy="12" r="9" strokeLinecap="round" />
          <path d="M5.5 5.5 18.5 18.5" strokeLinecap="round" />
        </svg>
        <div>
          <p className="font-semibold">
            <span className="font-bold uppercase tracking-wide">Blacklisted</span> — {blacklistMatch.candidateName}
          </p>
          <p className="mt-0.5 text-sm opacity-90">
            {blacklistMatch.projectName ? <>Archived from <strong>{blacklistMatch.projectName}</strong></> : "Archived elsewhere"}
            {blacklistMatch.reason ? <> — &#x201C;{blacklistMatch.reason}&#x201D;</> : " — no reason recorded"}. Skipped scoring — no Claude call made.
          </p>
          <p className="mt-1 text-xs opacity-70">
            {blacklistMatch.confidence === "name_and_resume" ? (
              <>Same resume on file — high-confidence match.</>
            ) : (
              <>Name match only, found in the resume text before scoring — could be a different person with the same name.</>
            )}
          </p>
          <p className="mt-1 text-xs opacity-70">Uploaded as {fileName}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={scoring || !file}
          title={!file ? "Original file no longer available — try re-uploading" : undefined}
          onClick={() => {
            if (!file) return;
            setScoring(true);
            onForceScore(file);
          }}
          className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-950/30 dark:text-zinc-950 dark:hover:bg-zinc-950/10"
        >
          {scoring ? "Scoring…" : "Score anyway"}
        </button>
      </div>
    </li>
  );
}
