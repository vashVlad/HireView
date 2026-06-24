import type { Recommendation } from "@/lib/types";

export function RecommendationBadge({
  recommendation,
  size = "md",
}: {
  recommendation: Recommendation | null;
  size?: "sm" | "md";
}) {
  if (!recommendation) return null;
  const isProceed = recommendation === "proceed";

  const sizeClass = size === "sm" ? "px-1.5 py-px text-[9px]" : "px-2 py-0.5 text-[11px]";
  const colorClass = isProceed
    ? "bg-emerald-600 dark:bg-emerald-500"
    : "bg-rose-600 dark:bg-rose-500";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md font-semibold uppercase tracking-wide text-white ${sizeClass} ${colorClass}`}
    >
      {isProceed ? "Proceed" : "Decline"}
    </span>
  );
}
