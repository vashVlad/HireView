import { CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS, type CandidateStatus } from "@/lib/types";

// Exported so StatusStageControl.tsx (the merged status+stage pill used on
// Pipeline/All Candidates cards) can color its outer border/background to
// match a standalone StatusSelect exactly, instead of duplicating this map.
export const STATUS_COLORS: Record<CandidateStatus, string> = {
  new_applicant:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  recruiter_screen:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  contacted:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  // Container status for the whole TA/L1/L2/In-Person/Offer/Reject arc as of
  // 2026-07-15 — "interview" (previously a separate status) was removed and
  // folded into this one. See decisions-log.md.
  screening:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400",
  archived:
    "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500",
};

export function StatusSelect({
  status,
  onChange,
}: {
  status: CandidateStatus;
  onChange: (status: CandidateStatus) => void;
}) {
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as CandidateStatus)}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium outline-none ${STATUS_COLORS[status]}`}
    >
      {CANDIDATE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {CANDIDATE_STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
