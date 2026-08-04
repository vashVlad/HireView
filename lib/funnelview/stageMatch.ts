import type { CandidateStatus, TrackerStage } from "@/lib/types";
import type { FunnelCandidate } from "./types";

/**
 * Single source of truth for the funnel's stage predicates — split out of
 * lib/funnelview/data.ts 2026-08-04 (Vlad's ask: clicking a funnel row
 * should drill into the exact candidates behind that row's count). Both
 * data.ts's server-side aggregate counts AND app/funnelview/page.tsx's
 * client-side row-click filter import from here, so the drill-down list's
 * length can never silently drift from the bar's own displayed count —
 * they're now the same function, not two hand-maintained copies of the
 * same logic.
 *
 * Deliberately its own file rather than re-exported from data.ts: data.ts
 * imports lib/supabase (server-only), and this needs to be safely
 * importable from a "use client" page without dragging that into the
 * client bundle.
 */

export const TRACKER_ORDER: TrackerStage[] = ["TA", "L1", "L2", "In-Person", "Offer"];

export const ACTIVE_ENGAGEMENT_STATUSES: CandidateStatus[] = ["recruiter_screen", "contacted", "screening"];

const STAGE_INDEX = new Map(TRACKER_ORDER.map((s, i) => [s, i]));

/** Same slugging data.ts already used for each tracker stage's `key`. */
export function stageKeyFor(stage: TrackerStage): string {
  return stage.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/**
 * Does this candidate count toward the given funnel stage's total? `key`
 * matches FunnelStageCount.key exactly: "screened", "passed_threshold",
 * "reached_out", or one of the tracker-stage slugs ("ta", "l1", "l2",
 * "in_person", "offer").
 */
export function candidateMatchesStageKey(c: FunnelCandidate, key: string): boolean {
  if (key === "screened") return true;
  if (key === "passed_threshold") return c.passedThreshold;
  if (key === "reached_out") {
    return (
      ACTIVE_ENGAGEMENT_STATUSES.includes(c.status) ||
      (c.status === "archived" && c.previousStatus != null && ACTIVE_ENGAGEMENT_STATUSES.includes(c.previousStatus))
    );
  }
  const stage = TRACKER_ORDER.find((s) => stageKeyFor(s) === key);
  if (!stage) return false;
  const idx = STAGE_INDEX.get(stage)!;
  const reached = c.furthestStage;
  if (!reached) return false;
  const reachedIdx = STAGE_INDEX.get(reached);
  return reachedIdx != null && reachedIdx >= idx;
}
