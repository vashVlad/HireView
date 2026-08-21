import { toMonthRange } from "./matchTrajectoryEntries";
import type { TrajectoryEntry } from "./types";

/**
 * Phase 2.6 Tier 4 (2026-08-20, roadmap 2.6.7/2.6.8) — pure, deterministic,
 * zero-AI-cost employment-gap detection off a candidate's own
 * trajectoryEntries dates. One of the two "both-objective signals" that
 * drive TrajectoryGraph.tsx's redesigned Y-axis (decisions-log.md,
 * 2026-08-19 "later, same session" entry): (a) the AI-judged stepDirection
 * field (lib/scoreCandidate.ts/lib/assessCredibility.ts), and (b) this — a
 * real gap between two consecutive roles' dates, which forces a visible dip
 * on the graph regardless of what stepDirection said for the role after the
 * gap. Directly answers Vlad's "I don't know how to make it decrease"
 * without inventing a fuzzy, unreliable "company prestige" heuristic.
 *
 * Reuses parseYearMonth/toMonthRange from lib/matchTrajectoryEntries.ts
 * (already exported specifically for reuse, per that file's own comment on
 * parseYearMonth) rather than reimplementing date parsing a third time —
 * same "reuse, don't reimplement" precedent TrajectoryGraph.tsx's own use
 * of toMonthRange already established.
 */

export interface EmploymentGap {
  /**
   * Index into the CHRONOLOGICALLY SORTED (oldest-first) entries array this
   * function returns alongside — the gap sits between sortedEntries[index]
   * (the role ending) and sortedEntries[index + 1] (the role starting after
   * the gap). Always a valid index < sortedEntries.length - 1.
   */
  index: number;
  /** Whole months between the end of the earlier role and the start of the later one. Always > toleranceMonths (see detectEmploymentGaps). */
  gapMonths: number;
}

/**
 * Same ~2-month tolerance lib/matchTrajectoryEntries.ts's datesLooselyMatch
 * already uses for LinkedIn/resume month-granularity slop — reused here for
 * consistency rather than picking a new number. A gap of 2 months or less
 * reads as normal rounding/notice-period noise, not a real employment gap.
 */
const DEFAULT_TOLERANCE_MONTHS = 2;

/**
 * Returns the chronologically-sorted (oldest-first) entries alongside the
 * gaps found between consecutive roles in that sorted order — sorting is
 * done here (not assumed of the caller) since trajectoryEntries is always
 * generated reverse-chronological (most-recent-first) by both
 * scoreCandidate.ts and assessCredibility.ts's extraction, and gap
 * detection only makes sense walking forward in time.
 *
 * Entries with an unparseable date (NaN from parseYearMonth — a model
 * deviation from the requested format) are excluded from gap comparison
 * entirely rather than treated as an infinite/zero-width gap, which could
 * otherwise fabricate a gap that isn't real. They're still included in the
 * returned sortedEntries (so the graph can still plot them), just never
 * flagged as either side of a gap.
 */
export function detectEmploymentGaps(
  entries: TrajectoryEntry[],
  referenceNow: Date,
  toleranceMonths: number = DEFAULT_TOLERANCE_MONTHS
): { sortedEntries: TrajectoryEntry[]; gaps: EmploymentGap[] } {
  const withRange = entries.map((entry) => ({ entry, range: toMonthRange(entry, referenceNow) }));
  withRange.sort((a, b) => {
    const aStart = isFinite(a.range[0]) ? a.range[0] : -Infinity;
    const bStart = isFinite(b.range[0]) ? b.range[0] : -Infinity;
    return aStart - bStart;
  });
  const sortedEntries = withRange.map((r) => r.entry);

  const gaps: EmploymentGap[] = [];
  for (let i = 0; i < withRange.length - 1; i++) {
    const prevEnd = withRange[i].range[1];
    const nextStart = withRange[i + 1].range[0];
    if (!isFinite(prevEnd) || !isFinite(nextStart)) continue;
    const gapMonths = nextStart - prevEnd;
    if (gapMonths > toleranceMonths) {
      gaps.push({ index: i, gapMonths });
    }
  }

  return { sortedEntries, gaps };
}
