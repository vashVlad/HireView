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

export function ScoreBadge({ score }: { score: number }) {
  const styles = getScoreStyles(score);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full shadow-lg ${styles.glow}`}>
      <svg className="absolute h-16 w-16 -rotate-90" viewBox="0 0 60 60">
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          strokeWidth="4"
          className="stroke-zinc-100 dark:stroke-zinc-800"
        />
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-700 ease-out ${styles.ring}`}
        />
      </svg>
      <span className={`text-lg font-semibold tabular-nums ${styles.text}`}>{score}</span>
    </div>
  );
}
