"use client";

import { TRACKER_STAGES, type TrackerStage } from "@/lib/types";

const STAGE_COLORS: Record<TrackerStage, string> = {
  TA: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30",
  L1: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/30",
  L2: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/30",
  "In-Person": "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30",
  Offer: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
  Reject: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30",
};

export function TrackerStageSelect({
  stage,
  onChange,
}: {
  stage: TrackerStage | null;
  onChange: (stage: TrackerStage) => void;
}) {
  const color = stage ? STAGE_COLORS[stage] : "bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";

  return (
    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <select
        value={stage ?? ""}
        onChange={(e) => { if (e.target.value) onChange(e.target.value as TrackerStage); }}
        className={`cursor-pointer appearance-none rounded-full border px-3 py-1 pr-6 text-xs font-semibold transition-colors ${color}`}
      >
        <option value="" disabled>Stage</option>
        {TRACKER_STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-current opacity-60">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
