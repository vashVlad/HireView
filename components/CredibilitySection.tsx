"use client";

import { useState } from "react";
import type { CredibilityAssessment, CredibilityRow, CredibilitySignal } from "@/lib/types";

const SIGNAL_CONFIG: Record<CredibilitySignal, { label: string; className: string }> = {
  clean: {
    label: "Clean",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  minor_concerns: {
    label: "Minor concerns",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  },
  significant_concerns: {
    label: "Significant concerns",
    className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  },
};

function CredibilityRowItem({ row }: { row: CredibilityRow }) {
  const isMatch = row.status === "match";
  const isDiscrepancy = row.status === "discrepancy";

  const containerClass = isDiscrepancy
    ? "border-l-2 border-amber-400 bg-amber-50 dark:border-amber-500/70 dark:bg-amber-500/8"
    : isMatch
    ? "border-l-2 border-emerald-400 bg-emerald-50/40 dark:border-emerald-500/50 dark:bg-emerald-500/5"
    : "border-l-2 border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/30";

  const icon = isDiscrepancy ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-500 dark:text-amber-400">
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : isMatch ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 dark:text-emerald-400">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const fieldClass = isDiscrepancy
    ? "font-semibold text-amber-800 dark:text-amber-300"
    : isMatch
    ? "font-medium text-zinc-700 dark:text-zinc-300"
    : "font-medium text-zinc-500 dark:text-zinc-400";

  return (
    <div className={`flex gap-2.5 rounded-lg px-3 py-2.5 ${containerClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-xs ${fieldClass}`}>{row.field}</span>
        {isMatch ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{row.resume}</span>
        ) : (
          <div className="flex flex-col gap-0.5 text-xs">
            <span>
              <span className="font-medium text-zinc-500 dark:text-zinc-400">Resume: </span>
              <span className="text-zinc-600 dark:text-zinc-300">{row.resume}</span>
            </span>
            <span>
              <span className="font-medium text-zinc-500 dark:text-zinc-400">LinkedIn: </span>
              <span className="text-zinc-600 dark:text-zinc-300">{row.linkedIn}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CredibilitySection({ assessment }: { assessment: CredibilityAssessment }) {
  const { label, className } = SIGNAL_CONFIG[assessment.overallSignal] ?? SIGNAL_CONFIG.minor_concerns;
  const [tab, setTab] = useState<"flags" | "matches">("flags");

  const rows = assessment.rows ?? [];
  const flags = rows.filter((r) => r.status === "discrepancy");
  const matches = rows.filter((r) => r.status === "match");

  const activeRows = tab === "flags" ? flags : matches;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Credibility check
        </span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
          {label}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setTab("flags")}
          className={`flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors ${
            tab === "flags"
              ? "border-amber-500 text-amber-600 dark:text-amber-400"
              : "border-transparent text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
        >
          Flags
          <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${tab === "flags" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
            {flags.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("matches")}
          className={`flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors ${
            tab === "matches"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          }`}
        >
          Matches
          <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${tab === "matches" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
            {matches.length}
          </span>
        </button>
      </div>

      {/* Rows */}
      <div className="flex flex-col gap-1.5">
        {activeRows.length > 0 ? (
          activeRows.map((row, i) => <CredibilityRowItem key={i} row={row} />)
        ) : (
          <p className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {tab === "flags" ? "No flags — everything checked out." : "No verified matches."}
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
        <span className="font-semibold text-zinc-400 dark:text-zinc-500">Industry</span>
        <span className="text-zinc-600 dark:text-zinc-400">{assessment.industryNote}</span>
        <span className="font-semibold text-zinc-400 dark:text-zinc-500">Trajectory</span>
        <span className="text-zinc-600 dark:text-zinc-400">{assessment.trajectoryNote}</span>
        {assessment.resumeDelta && (
          <>
            <span className="font-semibold text-zinc-400 dark:text-zinc-500">Δ Resume</span>
            <span className="text-zinc-600 dark:text-zinc-400">{assessment.resumeDelta}</span>
          </>
        )}
      </div>
    </div>
  );
}
