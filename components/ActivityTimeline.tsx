"use client";

import type { ActionType, ScreeningAction } from "@/lib/screeningActions";
import { CANDIDATE_STATUS_LABELS, type CandidateStatus } from "@/lib/types";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";

// Extracted 2026-07-29 from app/projects/[id]/page.tsx's inline "Attribution
// timeline" block (Pipeline tab only) — this was the only place a
// candidate's activity history rendered, so the full-view cards added
// 2026-07-28 (the durable batch-results page and the candidate full page,
// both rendering ResultCard.tsx) never showed it at all. Now a shared
// component so both places render identically and any future readability
// fix only has to happen once. Same underlying data (getActionTimeline,
// GET /api/history/[id]/actions) and formatActionText logic as before,
// moved here unchanged; the additions are relative timestamps (full date on
// hover) and a small per-action-type icon, per Vlad's ask for easier-to-read
// activity.

export function formatActionText(a: ScreeningAction, candidateName: string): string {
  switch (a.actionType) {
    case "created": return `screened ${candidateName}`;
    case "status_change": return `moved ${candidateName} to ${CANDIDATE_STATUS_LABELS[a.toValue as CandidateStatus] ?? a.toValue}`;
    case "stage_change": return `moved ${candidateName} to ${a.toValue} stage`;
    case "flagged": return `flagged ${candidateName}`;
    case "unflagged": return `removed the flag from ${candidateName}`;
    case "note": return `added a note on ${candidateName}`;
    case "credibility_check": return `ran a credibility check on ${candidateName}`;
    case "rescreen": return `rescreened ${candidateName}`;
    default: return `updated ${candidateName}`;
  }
}

// Relative time, matching the pattern app/projects/[id]/page.tsx already
// uses elsewhere (formatStatusDate) — kept as its own small copy here
// rather than exported/shared, since that original is a local, unexported
// function and this component is meant to be self-contained. Full absolute
// date is always available via the title attribute on hover, so nothing is
// lost by leading with the relative form.
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// One small glyph per action type so the list is scannable without reading
// every sentence — same 13x13 inline-SVG convention CredibilitySection.tsx
// already uses for its row icons.
function ActionIcon({ type }: { type: ActionType }) {
  const common = { width: 11, height: 11, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "created":
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "status_change":
    case "stage_change":
      return <svg {...common}><path d="M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4" /></svg>;
    case "flagged":
      return <svg {...common}><path d="M5 21V4a1 1 0 0 1 1-1h11l-2 5 2 5H6" /></svg>;
    case "unflagged":
      return <svg {...common}><path d="M5 3v18M2 2l20 20" /></svg>;
    case "note":
      return <svg {...common}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" /></svg>;
    case "credibility_check":
      return <svg {...common}><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "rescreen":
      return <svg {...common}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

export function ActivityTimeline({
  actions,
  candidateName,
  label = "Activity",
}: {
  /** "loading" while the fetch is in flight, undefined before it's started. */
  actions: ScreeningAction[] | "loading" | undefined;
  candidateName: string;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</p>
      {actions === undefined || actions === "loading" ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Loading…</p>
      ) : actions.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">No activity recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {/* getActionTimeline returns oldest-first (a stable contract other
              consumers, e.g. the tracker export, may rely on) — reversed
              only here, at render time, since a log reading newest-first is
              what's actually easier to scan. */}
          {[...actions].reverse().map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(a.userEmail)}`}>
                {avatarInitial(a.userEmail)}
              </span>
              <span className="flex min-w-0 flex-1 items-start gap-1.5">
                <span className="mt-0.5 shrink-0 text-zinc-400 dark:text-zinc-500"><ActionIcon type={a.actionType} /></span>
                <span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">{a.userEmail}</span>{" "}
                  {formatActionText(a, candidateName)}{" "}
                  <span title={formatFullDate(a.createdAt)} className="cursor-default">
                    {formatRelativeTime(a.createdAt)}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
