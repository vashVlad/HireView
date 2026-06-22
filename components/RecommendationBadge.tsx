import type { Recommendation } from "@/lib/types";

export function RecommendationBadge({ recommendation }: { recommendation: Recommendation | null }) {
  if (!recommendation) return null;
  const isProceed = recommendation === "proceed";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${
        isProceed ? "bg-emerald-600 dark:bg-emerald-500" : "bg-rose-600 dark:bg-rose-500"
      }`}
    >
      {isProceed ? "Proceed" : "Decline"}
    </span>
  );
}
