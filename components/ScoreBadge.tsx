"use client";

import { useState } from "react";

export function ScoreBadge({
  score,
  size = "md",
  adjustedScore,
}: {
  score: number;
  size?: "md" | "lg";
  /**
   * Post-credibility-check score (score + a negative scoreDelta). When
   * present and lower than score, the ring renders as two component-color
   * segments rather than one tier-color arc — per Vlad's ask 2026-07-15
   * ("Interactive Scoring Ring"): amber/yellow for the screening score, red
   * for the cross-reference (credibility) deduction. Hovering reveals the
   * numeric breakdown of both components plus the final score. Omit or pass
   * === score for the plain single-color screening-only badge.
   */
  adjustedScore?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const hasAdjustment = adjustedScore !== undefined && adjustedScore < score;
  const displayScore = hasAdjustment ? adjustedScore : score;
  const deduction = hasAdjustment ? score - adjustedScore : 0;

  const radius = size === "lg" ? 44 : 26;
  const circumference = 2 * Math.PI * radius;
  // "After" arc — reach of the final (possibly adjusted) score.
  const displayOffset = circumference - (displayScore / 100) * circumference;
  // "Before" arc — full reach of the raw screening score.
  const screeningOffset = circumference - (score / 100) * circumference;
  const dim = size === "lg" ? "h-28 w-28" : "h-16 w-16";
  const vb = size === "lg" ? "0 0 100 100" : "0 0 60 60";
  const cx = size === "lg" ? 50 : 30;
  const sw = size === "lg" ? 5 : 4;
  const textSize = size === "lg" ? "text-3xl" : "text-lg";

  return (
    <div
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full shadow-lg shadow-amber-500/10`}>
        <svg className={`absolute ${dim} -rotate-90`} viewBox={vb}>
          <circle cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} className="stroke-zinc-100 dark:stroke-zinc-800" />
          {hasAdjustment && (
            // Cross-reference component (red) — drawn first at the raw
            // screening score's full reach. The screening component (yellow)
            // is drawn on top and only covers up to the adjusted score, so
            // the remaining red tail (adjustedScore -> score) is exactly the
            // credibility deduction — the ring's composition is legible at a
            // glance without needing the hover state.
            <circle
              cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={screeningOffset}
              className="stroke-red-500"
            />
          )}
          {/* Screening component — always the fixed "yellow" component color,
              regardless of score magnitude (replaces the old emerald/sky/
              amber/rose tier palette per Vlad's confirmed answer: ring colors
              represent score composition, not score tier). */}
          <circle
            cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={displayOffset}
            className="stroke-amber-400 transition-all duration-700 ease-out"
          />
        </svg>
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span className={`${textSize} font-semibold leading-none tabular-nums text-zinc-900 dark:text-zinc-50`}>{displayScore}</span>
          {hasAdjustment && (
            <span className="whitespace-nowrap text-[9px] font-semibold leading-none tabular-nums text-red-500 dark:text-red-400">
              {score}&#x2192;{displayScore}
            </span>
          )}
        </div>
      </div>

      {hovered && (
        <div
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-2 w-48 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2.5 text-left text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" /> Screening
            </span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{score}</span>
          </div>
          {hasAdjustment && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" /> Cross-reference
              </span>
              <span className="font-semibold tabular-nums text-red-500 dark:text-red-400">&#x2212;{deduction}</span>
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-zinc-100 pt-1.5 dark:border-zinc-700">
            <span className="text-zinc-500 dark:text-zinc-400">Final</span>
            <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{displayScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}
