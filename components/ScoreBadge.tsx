function getScoreStyles(score: number) {
  if (score >= 80) {
    return {
      ring: "stroke-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      glow: "shadow-emerald-500/20",
    };
  }
  if (score >= 60) {
    return {
      ring: "stroke-sky-500",
      text: "text-sky-600 dark:text-sky-400",
      glow: "shadow-sky-500/20",
    };
  }
  if (score >= 40) {
    return {
      ring: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      glow: "shadow-amber-500/20",
    };
  }
  return {
    ring: "stroke-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    glow: "shadow-rose-500/20",
  };
}

export function ScoreBadge({
  score,
  size = "md",
  adjustedScore,
}: {
  score: number;
  size?: "md" | "lg";
  /**
   * Post-credibility-check score (score + a negative scoreDelta). When
   * present and lower than score, the ring renders both: the original
   * score's reach in a muted rose arc, and the adjusted score's reach in
   * the normal tier color drawn on top of it — same circle, before/after in
   * two colors, per Vlad's ask 2026-07-15. The big number shown is always
   * the adjusted score, since that's the one that reflects what's actually
   * been verified. Omit or pass === score for the plain single-ring badge.
   */
  adjustedScore?: number;
}) {
  const hasAdjustment = adjustedScore !== undefined && adjustedScore < score;
  const displayScore = hasAdjustment ? adjustedScore : score;
  const styles = getScoreStyles(displayScore);
  const radius = size === "lg" ? 44 : 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayScore / 100) * circumference;
  const originalOffset = circumference - (score / 100) * circumference;
  const dim = size === "lg" ? "h-28 w-28" : "h-16 w-16";
  const vb = size === "lg" ? "0 0 100 100" : "0 0 60 60";
  const cx = size === "lg" ? 50 : 30;
  const sw = size === "lg" ? 5 : 4;
  const textSize = size === "lg" ? "text-3xl" : "text-lg";

  return (
    <div className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full shadow-lg ${styles.glow}`}>
      <svg className={`absolute ${dim} -rotate-90`} viewBox={vb}>
        <circle cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} className="stroke-zinc-100 dark:stroke-zinc-800" />
        {hasAdjustment && (
          // "Before" arc — the original fit score's full reach, in a muted
          // rose tone. Drawn first so the "after" arc paints over the shared
          // portion, leaving only the deducted tail (adjustedScore -> score)
          // visible in rose — that tail is the credibility deduction.
          <circle
            cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={originalOffset}
            className="stroke-rose-300 dark:stroke-rose-500/40"
          />
        )}
        <circle
          cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className={`transition-all duration-700 ease-out ${styles.ring}`}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={`${textSize} font-semibold tabular-nums ${styles.text}`}>{displayScore}</span>
        {hasAdjustment && (
          <span className="text-[10px] font-semibold tabular-nums text-rose-500 dark:text-rose-400">
            {score}&#x2192;{displayScore}
          </span>
        )}
      </div>
    </div>
  );
}
