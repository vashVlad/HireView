import type { CandidateResult, TrajectoryEntry } from "./types";

/**
 * ResultCard redesign, 2026-08-28 (Vlad's ask: collapse the career
 * trajectory below a few bullet-point highlights so a recruiter sees the
 * key facts first and can optionally expand the full narrative). Every
 * field here is derived from data scoreCandidate.ts ALREADY generates
 * (trajectoryEntries' stepDirection, strengths[]) — no new AI call, no new
 * field. Pure and deterministic, per Vlad's explicit choice between "reuse
 * existing data" and "new AI-generated field" (2026-08-28).
 */
export interface ExperienceHighlight {
  tone: "trajectory" | "role" | "strength";
  label: string;
  detail?: string;
}

/**
 * trajectoryEntries is stored in reverse-chronological order (most recent
 * role first — same order as the careerTrajectory prose, see
 * scoreCandidate.ts's SCORE_TOOL description for trajectoryEntries).
 */
function yearsSpan(entries: TrajectoryEntry[]): number | null {
  const parseYear = (d: string): number | null => {
    if (d === "present") return new Date().getFullYear();
    const y = parseInt(d.slice(0, 4), 10);
    return Number.isNaN(y) ? null : y;
  };
  const years = entries.flatMap((e) => [parseYear(e.startDate), parseYear(e.endDate)]).filter((y): y is number => y !== null);
  if (years.length === 0) return null;
  const span = Math.max(...years) - Math.min(...years);
  return span >= 0 ? span : null;
}

function directionLabel(entries: TrajectoryEntry[]): string | null {
  // Skip entirely for a single entry — "first" isn't a trend, there's
  // nothing before it to compare against (see TrajectoryEntry.stepDirection's
  // own doc comment: "first" is a marker, not a direction).
  if (entries.length < 2) return null;

  const ups = entries.filter((e) => e.stepDirection === "up").length;
  const downs = entries.filter((e) => e.stepDirection === "down").length;
  const direction = downs > ups ? "declining trajectory" : ups > 0 ? "steady upward trajectory" : "lateral moves";

  const span = yearsSpan(entries);
  return span !== null && span > 0 ? `${span} yrs, ${direction}` : direction;
}

function formatEndDate(endDate: string): string {
  return endDate === "present" ? "now" : endDate;
}

export function buildExperienceHighlights(
  result: Pick<CandidateResult, "trajectoryEntries" | "strengths">
): ExperienceHighlight[] {
  const highlights: ExperienceHighlight[] = [];
  const entries = result.trajectoryEntries ?? [];

  const direction = directionLabel(entries);
  if (direction) {
    highlights.push({ tone: "trajectory", label: direction });
  }

  for (const entry of entries.slice(0, 2)) {
    highlights.push({
      tone: "role",
      label: `${entry.title}, ${entry.company}`,
      detail: `${entry.startDate}–${formatEndDate(entry.endDate)}`,
    });
  }

  const topStrength = result.strengths?.[0];
  if (topStrength) {
    highlights.push({ tone: "strength", label: topStrength });
  }

  return highlights.slice(0, 4);
}
