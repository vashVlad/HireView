import { companiesLooselyMatch } from "./matchTrajectoryEntries";
import type { ChecklistItemResult, TrajectoryEntry } from "./types";

/**
 * Roadmap 2.5.2 follow-up, 2026-08-18 — Vlad wanted the credibility panel's
 * graph to show real "ups and downs" per role instead of a flat timeline.
 * The candidate's SCORE has no history (it's one number, computed once, over
 * the whole resume — there's no "score in 2022"), so a literal score-over-
 * time line isn't something the data can produce without inventing values.
 * What IS real: which specific role each fired checklist item's evidence
 * came from (evaluateChecklist.ts's new evidenceSource field). Summing that
 * per role gives an honest, evidence-grounded "how much did THIS job
 * contribute" number — a role that's a strong match spikes up, an unrelated
 * one sits near zero. That's the metric TrajectoryGraph plots now.
 *
 * Pure, deterministic, zero-AI-cost — same "code-level diff, not AI" pattern
 * as lib/matchTrajectoryEntries.ts. The only judgment call is which role a
 * free-text evidenceSource string refers to, done via the exact same
 * companiesLooselyMatch used to pair trajectoryEntries against a cross-
 * reference document, not a second heuristic invented for this.
 */

export interface RolePoints {
  entry: TrajectoryEntry;
  points: number;
}

/**
 * Returns one entry per role in `entries`, in the same order, each with the
 * sum of every FIRED checklist item whose evidenceSource loosely matches
 * that role's company. A fired item with no evidenceSource (general/skills-
 * section evidence, not tied to one role) or one that matches no role at all
 * contributes to nothing — it's simply not represented on the per-role
 * graph, same as it already isn't represented as a specific line in
 * TrajectoryRenderer's prose breakdown. If an evidenceSource string loosely
 * matches more than one role (e.g. two stints at the same company), it's
 * attributed to the FIRST matching role in resume order — good enough for a
 * visual "which chapter of the career was this signal in" read, not meant to
 * be forensically precise between two identically-named roles.
 */
export function attributeChecklistPointsToRoles(
  results: ChecklistItemResult[],
  entries: TrajectoryEntry[]
): RolePoints[] {
  const points = entries.map(() => 0);

  for (const result of results) {
    if (!result.fired) continue;
    const source = result.evidenceSource?.trim();
    if (!source) continue;
    const matchIndex = entries.findIndex((entry) => companiesLooselyMatch(source, entry.company));
    if (matchIndex === -1) continue;
    points[matchIndex] += result.points;
  }

  return entries.map((entry, i) => ({ entry, points: points[i] }));
}

/**
 * Phase 2.6 Tier 4 (2026-08-20) — same matching logic as
 * attributeChecklistPointsToRoles above, but returns the actual fired
 * ChecklistItemResult objects per role instead of just their point sum.
 * Added for TrajectoryGraph.tsx's new hover/click detail (decisions-log.md,
 * 2026-08-19: "which checklist items fired during that role... checklist
 * evidence is now supporting detail shown on demand, not what drives the
 * line's height") — the graph's Y-axis no longer needs the point sum at
 * all, but the recruiter still benefits from seeing WHICH items fired
 * where. Deliberately a separate function rather than changing
 * attributeChecklistPointsToRoles's return shape — that function is
 * already unit-tested (test_attribute_checklist_to_roles.mjs) and used
 * elsewhere for the point sum alone; no reason to risk or complicate it
 * for a caller that needs different output.
 */
export interface RoleChecklistDetail {
  entry: TrajectoryEntry;
  points: number;
  firedItems: ChecklistItemResult[];
}

export function attributeChecklistItemsToRoles(
  results: ChecklistItemResult[],
  entries: TrajectoryEntry[]
): RoleChecklistDetail[] {
  const points = entries.map(() => 0);
  const firedItems: ChecklistItemResult[][] = entries.map(() => []);

  for (const result of results) {
    if (!result.fired) continue;
    const source = result.evidenceSource?.trim();
    if (!source) continue;
    const matchIndex = entries.findIndex((entry) => companiesLooselyMatch(source, entry.company));
    if (matchIndex === -1) continue;
    points[matchIndex] += result.points;
    firedItems[matchIndex].push(result);
  }

  return entries.map((entry, i) => ({ entry, points: points[i], firedItems: firedItems[i] }));
}
