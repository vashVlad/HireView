"use client";

/**
 * Roadmap 2.5.2, 2026-08-17 — hand-built timeline (divs + CSS positioning,
 * not SVG, not a charting library) rendering a candidate's structured
 * trajectoryEntries as a horizontal Gantt-style bar per role. Matches this
 * codebase's own precedent (ScoringLoader.tsx is hand-rolled SVG rather than
 * a dependency) — package.json has zero chart libraries as of this date.
 *
 * This is the "what/when" skeleton — company, title, and time range at a
 * glance. TrajectoryRenderer.tsx's markdown prose stays the "why" (company
 * fit, key signal, transition logic per role) and isn't replaced by this;
 * the two are meant to sit side by side, not compete.
 *
 * Optional comparisonRows prop renders a second, thinner bar beneath each
 * paired role showing the cross-reference document's version of the same
 * time range — used in the credibility check panel so a recruiter can see a
 * date mismatch visually, not just read it in the flagged-rows list below.
 * Without comparisonRows, this renders as the plain base graph (e.g. for a
 * future consolidated candidate card, roadmap 2.5.4).
 */

import { toMonthRange } from "@/lib/matchTrajectoryEntries";
import type { TrajectoryEntry, TrajectoryComparisonRow } from "@/lib/types";

const REFERENCE_NOW = new Date();

function formatDateLabel(date: string): string {
  const trimmed = (date ?? "").trim();
  if (trimmed.toLowerCase() === "present" || trimmed.toLowerCase() === "current") return "Present";
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIdx = parseInt(monthMatch[2], 10) - 1;
    return `${monthNames[monthIdx] ?? ""} ${monthMatch[1]}`;
  }
  return trimmed || "—";
}

const EMPLOYMENT_TYPE_LABEL: Record<TrajectoryEntry["employmentType"], string> = {
  "full-time": "Full-time",
  contract: "Contract",
  unknown: "",
};

interface GraphRow {
  entry: TrajectoryEntry;
  range: [number, number];
  comparisonEntry?: TrajectoryEntry;
  comparisonRange?: [number, number];
  hasDateDiff?: boolean;
}

export function TrajectoryGraph({
  entries,
  comparisonRows,
  className,
}: {
  entries: TrajectoryEntry[];
  /** Roadmap 2.5.2 — paired rows from a credibility check, for the overlay variant. Rows with kind "undisclosed" (no resumeEntry) are ignored here — those render in the flagged-rows list, not the graph, since there's no resume-side bar to attach them to. */
  comparisonRows?: TrajectoryComparisonRow[];
  className?: string;
}) {
  if (!entries || entries.length === 0) return null;

  const comparisonByEntry = new Map<TrajectoryEntry, TrajectoryComparisonRow>();
  if (comparisonRows) {
    for (const row of comparisonRows) {
      if (row.kind === "paired" && row.resumeEntry) comparisonByEntry.set(row.resumeEntry, row);
    }
  }

  const rows: GraphRow[] = entries.map((entry) => {
    const comparison = comparisonByEntry.get(entry);
    const comparisonEntry = comparison?.crossRefEntry;
    return {
      entry,
      range: toMonthRange(entry, REFERENCE_NOW),
      comparisonEntry,
      comparisonRange: comparisonEntry ? toMonthRange(comparisonEntry, REFERENCE_NOW) : undefined,
      hasDateDiff: comparison?.fieldDiffs?.dates,
    };
  });

  // Shared time axis across every bar (and comparison bar, when present) so
  // positions are visually comparable — a finite fallback for any
  // unparseable date (-Infinity/Infinity from toMonthRange) rather than
  // letting one bad entry blow out the whole scale.
  const allRanges = rows.flatMap((r) => (r.comparisonRange ? [r.range, r.comparisonRange] : [r.range]));
  const finiteStarts = allRanges.map((r) => r[0]).filter((n) => isFinite(n));
  const finiteEnds = allRanges.map((r) => r[1]).filter((n) => isFinite(n));
  const globalMin = finiteStarts.length > 0 ? Math.min(...finiteStarts) : 0;
  const globalMax = finiteEnds.length > 0 ? Math.max(...finiteEnds) : globalMin + 12;
  const span = Math.max(1, globalMax - globalMin);

  function toPercent(range: [number, number]): { left: number; width: number } {
    const start = isFinite(range[0]) ? range[0] : globalMin;
    const end = isFinite(range[1]) ? range[1] : globalMax;
    const left = ((start - globalMin) / span) * 100;
    const width = Math.max(1.5, ((end - start) / span) * 100);
    return { left: Math.max(0, Math.min(100, left)), width: Math.min(100 - Math.max(0, left), width) };
  }

  return (
    <div className={`flex flex-col gap-2.5 ${className ?? ""}`}>
      {rows.map(({ entry, range, comparisonEntry, comparisonRange, hasDateDiff }, i) => {
        const bar = toPercent(range);
        const comparisonBar = comparisonRange ? toPercent(comparisonRange) : null;
        const typeLabel = EMPLOYMENT_TYPE_LABEL[entry.employmentType] || "";
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                {entry.title} <span className="text-zinc-400 dark:text-zinc-500">· {entry.company}</span>
              </span>
              <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                {formatDateLabel(entry.startDate)} – {formatDateLabel(entry.endDate)}
                {typeLabel ? ` · ${typeLabel}` : ""}
              </span>
            </div>
            <div className="relative h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`absolute top-0 h-2.5 rounded-full ${
                  hasDateDiff ? "bg-amber-400 dark:bg-amber-500" : "bg-blue-500 dark:bg-blue-400"
                }`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                title={`${formatDateLabel(entry.startDate)} – ${formatDateLabel(entry.endDate)}`}
              />
            </div>
            {comparisonBar && comparisonEntry && (
              <div className="relative h-1.5 rounded-full bg-transparent">
                <div
                  className={`absolute top-0 h-1.5 rounded-full border-2 border-dashed bg-transparent ${
                    hasDateDiff ? "border-amber-400 dark:border-amber-500" : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  style={{ left: `${comparisonBar.left}%`, width: `${comparisonBar.width}%` }}
                  title={`Cross-reference: ${formatDateLabel(comparisonEntry.startDate)} – ${formatDateLabel(comparisonEntry.endDate)}`}
                />
              </div>
            )}
          </div>
        );
      })}
      {comparisonRows && comparisonRows.some((r) => r.kind === "paired" && r.crossRefEntry) && (
        <div className="flex items-center gap-3 pt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-blue-500 dark:bg-blue-400" /> Resume</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full border border-dashed border-zinc-400" /> Cross-reference</span>
        </div>
      )}
    </div>
  );
}
