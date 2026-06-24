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

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md font-semibold uppercase tracking-wide text-white ${
        size === "sm"
          ? "px-1.5 py-px text-[9px]"
          : "px-2 py-0.5 text-[11px]"
      } ${isProceed ? "bg-emerald-600 dark:bg-emerald-500" : "bg-rose-600 dark:bg-rose-500"}`}
    >
      {isProceed ? "Proceed" : "Decline"}
    </span>
  );
}
