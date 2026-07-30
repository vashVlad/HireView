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
   * Post-credibility-check score (score + a scoreDelta that can now be
   * negative, positive, or zero — see CredibilityAssessment.scoreDelta,
   * lib/types.ts). When present and different from score, the ring renders
   * as two component-color segments rather than one tier-color arc — per
   * Vlad's ask 2026-07-15 ("Interactive Scoring Ring"): amber/yellow for the
   * screening score, red for a credibility deduction, or (added 2026-07-29)
   * emerald for a credibility bonus from resolvedConcerns — never both at
   * once, since scoreDelta is already netted before this prop is computed
   * (see ResultCard.tsx's combinedScoreDelta). Hovering reveals the numeric
   * breakdown plus the final score. Omit or pass === score for the plain
   * single-color screening-only badge. Clamped to [0, 100] for the ring —
   * a large bonus stacked on an already-high score can't visually exceed a
   * full ring, though the numeric label still shows the true final score.
   */
  adjustedScore?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const hasDeduction = adjustedScore !== undefined && adjustedScore < score;
  const hasBonus = adjustedScore !== undefined && adjustedScore > score;
  const hasAdjustment = hasDeduction || hasBonus;
  const displayScore = hasAdjustment ? (adjustedScore as number) : score;
  const clampedDisplayScore = Math.max(0, Math.min(100, displayScore));
  const deduction = hasDeduction ? score - displayScore : 0;
  const bonus = hasBonus ? displayScore - score : 0;

  const radius = size === "lg" ? 44 : 26;
  const circumference = 2 * Math.PI * radius;
  // "After" arc — reach of the final (possibly adjusted) score.
  const displayOffset = circumference - (clampedDisplayScore / 100) * circumference;
  // "Before" arc — full reach of the raw screening score.
  const screeningOffset = circumference - (score / 100) * circumference;
  // The two arcs always share the same start point (0), so whichever of the
  // two values is bigger has the smaller strokeDashoffset (more of the
  // circle painted). Drawing that one first, then the smaller-reach one on
  // top, reveals exactly the delta between them as a colored "tail" —
  // works identically whether the bigger value is the raw score (a
  // deduction pulled the display value down) or the display value (a bonus
  // pushed it up), so no separate branching is needed for the two cases.
  const outerOffset = Math.min(screeningOffset, displayOffset);
  const innerOffset = Math.max(screeningOffset, displayOffset);
  const adjustmentColorClass = hasDeduction ? "stroke-red-500" : "stroke-emerald-500";
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
            // Adjustment component — red for a deduction, emerald for a
            // bonus (added 2026-07-29) — drawn first at the bigger of the
            // two reaches (outerOffset). The screening component (amber) is
            // drawn on top at the smaller reach (innerOffset), so whichever
            // color has the bigger reach shows through as the remaining
            // tail — the ring's composition is legible at a glance without
            // needing the hover state.
            <circle
              cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={outerOffset}
              className={adjustmentColorClass}
            />
          )}
          {/* Screening component — always the fixed "yellow" component color,
              regardless of score magnitude (replaces the old emerald/sky/
              amber/rose tier palette per Vlad's confirmed answer: ring colors
              represent score composition, not score tier). Drawn at
              innerOffset (the smaller reach) when there's an adjustment so
              the tail above is visible; at its own full reach otherwise. */}
          <circle
            cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={hasAdjustment ? innerOffset : displayOffset}
            className="stroke-amber-400 transition-all duration-700 ease-out"
          />
        </svg>
        <div className="flex flex-col items-center justify-center gap-0.5">
          <span className={`${textSize} font-semibold leading-none tabular-nums text-zinc-900 dark:text-zinc-50`}>{displayScore}</span>
          {hasAdjustment && (
            <span className={`whitespace-nowrap text-[9px] font-semibold leading-none tabular-nums ${hasDeduction ? "text-red-500 dark:text-red-400" : "text-emerald-500 dark:text-emerald-400"}`}>
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
                <span className={`h-2 w-2 shrink-0 rounded-full ${hasDeduction ? "bg-red-500" : "bg-emerald-500"}`} /> Cross-reference
              </span>
              <span className={`font-semibold tabular-nums ${hasDeduction ? "text-red-500 dark:text-red-400" : "text-emerald-500 dark:text-emerald-400"}`}>
                {hasDeduction ? "−" : "+"}{hasDeduction ? deduction : bonus}
              </span>
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
