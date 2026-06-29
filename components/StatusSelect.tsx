import { CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS, type CandidateStatus } from "@/lib/types";

const STATUS_COLORS: Record<CandidateStatus, string> = {
  new_applicant:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  recruiter_screen:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  contacted:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  screening:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400",
  interview:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
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
