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

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "md" | "lg" }) {
  const styles = getScoreStyles(score);
  const radius = size === "lg" ? 44 : 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const dim = size === "lg" ? "h-28 w-28" : "h-16 w-16";
  const vb = size === "lg" ? "0 0 100 100" : "0 0 60 60";
  const cx = size === "lg" ? 50 : 30;
  const sw = size === "lg" ? 5 : 4;
  const textSize = size === "lg" ? "text-3xl" : "text-lg";

  return (
    <div className={`relative flex ${dim} shrink-0 items-center justify-center rounded-full shadow-lg ${styles.glow}`}>
      <svg className={`absolute ${dim} -rotate-90`} viewBox={vb}>
        <circle cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} className="stroke-zinc-100 dark:stroke-zinc-800" />
        <circle
          cx={cx} cy={cx} r={radius} fill="none" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className={`transition-all duration-700 ease-out ${styles.ring}`}
        />
      </svg>
      <span className={`${textSize} font-semibold tabular-nums ${styles.text}`}>{score}</span>
    </div>
  );
}
