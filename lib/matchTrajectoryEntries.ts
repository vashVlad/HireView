import type { TrajectoryEntry, TrajectoryComparisonRow } from "./types";

/**
 * Roadmap 2.5.2, 2026-08-17 — pure, deterministic, zero-AI-cost diff between
 * two TrajectoryEntry[] arrays (a candidate's own trajectory, and a fresh
 * extraction from a cross-reference document). This is the "code-level diff,
 * not AI" step from the 2026-08-14 plan — see decisions-log.md's 2026-08-17
 * entry for the full design.
 *
 * Pairing is by IDENTITY (company + title similarity), with date overlap as
 * a secondary signal — deliberately NOT by date-range overlap alone. A date
 * fabrication (same employer/title, wrong dates) is exactly the case a
 * date-only pairing strategy would miss entirely: the fabricated entry would
 * never overlap its real counterpart, so it would silently vanish as two
 * unrelated orphans instead of surfacing as a flagged discrepancy. Pairing
 * on identity first means a date mismatch between two otherwise-identical
 * roles becomes a fieldDiff on a real pair, not a missed row.
 *
 * This function's only job is to separate the CONFIDENT matches (a paired
 * entry with zero fieldDiffs) from everything that needs a human-tuned
 * judgment call — real-world knowledge like staffing-agency naming patterns
 * or title-phrasing differences can't be decided by string comparison alone.
 * See rowsNeedingJudgment() below and lib/assessCredibility.ts for the AI
 * step that handles those.
 */

/** Exported for components/TrajectoryGraph.tsx — same date parsing used for pairing here is reused for the graph's timeline scale, deliberately not reimplemented a second time. */
export function parseYearMonth(date: string, referenceNow: Date): { year: number; month: number | null } {
  const trimmed = (date ?? "").trim().toLowerCase();
  if (trimmed === "present" || trimmed === "current") {
    return { year: referenceNow.getFullYear(), month: referenceNow.getMonth() + 1 };
  }
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) return { year: parseInt(monthMatch[1], 10), month: parseInt(monthMatch[2], 10) };
  const yearMatch = /^(\d{4})$/.exec(trimmed);
  if (yearMatch) return { year: parseInt(yearMatch[1], 10), month: null };
  // Unparseable date (model deviated from the requested YYYY-MM/YYYY/"present"
  // shape) — treat as unbounded rather than crashing; downstream comparisons
  // degrade to "can't confirm a difference," never a false positive.
  return { year: NaN, month: null };
}

/**
 * Converts a TrajectoryEntry's start/end into a comparable [startIndex,
 * endIndex] month-count range. A bare year is treated as spanning the whole
 * year (Jan–Dec) — the most permissive interpretation for OVERLAP purposes,
 * since a "2021" role could plausibly be any month of that year.
 */
/** Exported for components/TrajectoryGraph.tsx — see parseYearMonth's export comment above. */
export function toMonthRange(entry: TrajectoryEntry, referenceNow: Date): [number, number] {
  const start = parseYearMonth(entry.startDate, referenceNow);
  const end = parseYearMonth(entry.endDate, referenceNow);
  const startIdx = isNaN(start.year) ? -Infinity : start.year * 12 + (start.month ?? 1) - 1;
  const endIdx = isNaN(end.year) ? Infinity : end.year * 12 + (end.month ?? 12) - 1;
  return [startIdx, endIdx];
}

function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

function overlapMonths(a: [number, number], b: [number, number]): number {
  if (!rangesOverlap(a, b)) return 0;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return isFinite(hi - lo) ? hi - lo : 0;
}

function normalizeCompanyForCompare(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|corp|corporation|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exported for lib/attributeChecklistToRoles.ts, 2026-08-18 — same loose-match rule used to attribute a checklist item's free-text evidenceSource to a specific trajectoryEntry, deliberately not reimplemented a second time (same "reuse, don't reimplement" precedent as parseYearMonth/toMonthRange above). */
export function companiesLooselyMatch(a: string, b: string): boolean {
  const na = normalizeCompanyForCompare(a);
  const nb = normalizeCompanyForCompare(b);
  if (!na || !nb) return na === nb;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function titlesLooselyMatch(a: string, b: string): boolean {
  return (a ?? "").toLowerCase().trim() === (b ?? "").toLowerCase().trim();
}

/**
 * "Loosely match" here only means "close enough that the deterministic pass
 * is confident, no judgment call needed" — same ~2-month tolerance the old
 * CREDIBILITY_TOOL schema used for LinkedIn's month-only date granularity.
 * Anything looser than this becomes a fieldDiff, which routes to the AI
 * judgment step; that step decides whether it's still explainable.
 */
function datesLooselyMatch(a: TrajectoryEntry, b: TrajectoryEntry, referenceNow: Date): boolean {
  const [aStart, aEnd] = toMonthRange(a, referenceNow);
  const [bStart, bEnd] = toMonthRange(b, referenceNow);
  const startDiff = Math.abs(aStart - bStart);
  const endDiff = Math.abs(aEnd - bEnd);
  return startDiff <= 2 && endDiff <= 2;
}

/**
 * Identity + overlap score for candidate pairing — company match counts most
 * (the strongest identity signal), title next, date overlap is a tie-breaker/
 * secondary signal so two candidates with the same company+title but
 * genuinely different date ranges (a real possibility — someone rejoining
 * the same employer years later) still prefer the closer-in-time one.
 */
function pairScore(resumeEntry: TrajectoryEntry, crossRefEntry: TrajectoryEntry, referenceNow: Date): number {
  let score = 0;
  if (companiesLooselyMatch(resumeEntry.company, crossRefEntry.company)) score += 4;
  if (titlesLooselyMatch(resumeEntry.title, crossRefEntry.title)) score += 2;
  const overlap = overlapMonths(toMonthRange(resumeEntry, referenceNow), toMonthRange(crossRefEntry, referenceNow));
  if (overlap > 0) score += Math.min(1, overlap / 12); // capped small contribution, never overrides identity
  return score;
}

export function matchTrajectoryEntries(
  resumeEntries: TrajectoryEntry[],
  crossRefEntries: TrajectoryEntry[],
  referenceNow: Date = new Date()
): TrajectoryComparisonRow[] {
  const rows: TrajectoryComparisonRow[] = [];
  const usedCrossRefIndices = new Set<number>();

  for (const resumeEntry of resumeEntries) {
    let bestIndex = -1;
    let bestScore = 0; // must clear 0 — some real signal (company, title, or date overlap) required to even consider a pair
    crossRefEntries.forEach((crossRefEntry, idx) => {
      if (usedCrossRefIndices.has(idx)) return;
      const score = pairScore(resumeEntry, crossRefEntry, referenceNow);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    });

    if (bestIndex === -1) {
      // Resume lists a role the cross-reference doesn't plausibly mention at
      // all — deliberately NOT surfaced as its own row. Matches the old
      // schema's established behavior: this direction (resume has more than
      // the verification document) is normal — LinkedIn profiles and
      // reference documents are commonly incomplete too, not evidence of
      // anything. Only the REVERSE (verification doc shows something the
      // resume doesn't) is treated as worth flagging — see "undisclosed"
      // below.
      continue;
    }

    usedCrossRefIndices.add(bestIndex);
    const crossRefEntry = crossRefEntries[bestIndex];
    const fieldDiffs = {
      company: !companiesLooselyMatch(resumeEntry.company, crossRefEntry.company),
      title: !titlesLooselyMatch(resumeEntry.title, crossRefEntry.title),
      dates: !datesLooselyMatch(resumeEntry, crossRefEntry, referenceNow),
    };
    const hasAnyDiff = fieldDiffs.company || fieldDiffs.title || fieldDiffs.dates;
    rows.push({
      resumeEntry,
      crossRefEntry,
      kind: "paired",
      fieldDiffs,
      // A paired entry with zero differences is definitionally a match — set
      // directly, no AI needed. Anything with a real difference starts as
      // "discrepancy" provisionally; the judgment-call AI step may
      // reclassify it back to "match" (e.g. a company-name variant it
      // recognizes as the same employer) or "cannot_verify".
      status: hasAnyDiff ? "discrepancy" : "match",
    });
  }

  // Undisclosed employment — cross-reference entries with no resume-side
  // counterpart at all. Every one of these needs the AI judgment step:
  // severity depends on whether it plausibly OVERLAPS a role the resume DOES
  // list (concurrent undisclosed employment, the real fraud-relevant
  // pattern) versus simply predating/postdating the resume's listed history
  // cleanly (normal omission of an old job) — that's a real-world judgment,
  // not a string comparison.
  crossRefEntries.forEach((crossRefEntry, idx) => {
    if (usedCrossRefIndices.has(idx)) return;
    rows.push({
      crossRefEntry,
      kind: "undisclosed",
      status: "discrepancy",
    });
  });

  return rows;
}

/**
 * Rows a caller should actually send to the AI judgment step — anything the
 * deterministic pass above could NOT already resolve to a confident match.
 * Confident matches (kind: "paired", zero fieldDiffs) are excluded — sending
 * Claude something already known to be fine would be pure waste, and is the
 * entire cost-saving point of doing this pairing in code first.
 */
export function rowsNeedingJudgment(rows: TrajectoryComparisonRow[]): TrajectoryComparisonRow[] {
  return rows.filter((r) => r.status !== "match");
}

/** Human-readable "Title, Company (start–end)" — shared by mapTrajectoryRowToCredibilityRow below and components/TrajectoryGraph.tsx's date labels use their own shorter formatter (formatDateLabel), this one is for full row text, not axis labels. */
export function formatTrajectoryEntry(entry: TrajectoryEntry): string {
  return `${entry.title}, ${entry.company} (${entry.startDate}–${entry.endDate})`;
}

/**
 * Converts a TrajectoryComparisonRow into the existing CredibilityRow shape
 * — lets both the deterministic diff's output and the AI judgment's output
 * feed the exact same scoring functions (computeCredibilityScoreDelta in
 * lib/assessCredibility.ts) and the exact same CredibilitySection.tsx
 * rendering as the education rows that stay in CredibilityAssessment.rows,
 * with zero new UI code needed for the row list itself. Lives here (a pure,
 * server-dependency-free file) rather than in lib/assessCredibility.ts
 * itself so components/CredibilitySection.tsx ("use client") can import it
 * directly without pulling that server-only module (Anthropic SDK client,
 * etc.) into the client bundle.
 */
export function mapTrajectoryRowToCredibilityRow(row: TrajectoryComparisonRow): {
  field: string;
  resume: string;
  crossRef: string;
  status: "match" | "discrepancy" | "cannot_verify";
  severity?: "material" | "minor";
  note?: string;
} {
  if (row.kind === "undisclosed") {
    const crossRef = row.crossRefEntry!;
    return {
      field: `Undisclosed: ${crossRef.company}`,
      resume: "Not listed as employment",
      crossRef: formatTrajectoryEntry(crossRef),
      status: row.status,
      severity: row.severity,
      note: row.note,
    };
  }
  const resumeEntry = row.resumeEntry!;
  const crossRefEntry = row.crossRefEntry!;
  return {
    field: `${resumeEntry.company} — ${resumeEntry.title} (${resumeEntry.startDate}–${resumeEntry.endDate})`,
    resume: formatTrajectoryEntry(resumeEntry),
    crossRef: formatTrajectoryEntry(crossRefEntry),
    status: row.status,
    severity: row.severity,
    note: row.note,
  };
}
