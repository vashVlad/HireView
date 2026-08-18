/**
 * Roadmap 2.5.2, 2026-08-17 — the education year-comparison rule from the
 * old CREDIBILITY_TOOL schema was already pure integer math, no real-world
 * judgment involved (unlike company-name/title tolerance, which genuinely
 * needs domain knowledge a string comparison doesn't have) — moved here as
 * deterministic code instead of an AI-decided field. Same rule, ported
 * verbatim from that schema's severity description: resumeYear minus
 * crossRefStartYear, and resumeYear minus crossRefEndYear — if EITHER falls
 * in {-1, 0, 1}, it's a match, full stop, never even a minor discrepancy.
 * Outside that range: exactly 2 years off (the smaller of the two absolute
 * differences) is "minor" (explainable — LinkedIn/reference-document date
 * inconsistencies are common), 3+ years off is "material."
 *
 * Taking this out of the AI's hands removes a rule that's needed a real live
 * bugfix before (see decisions-log.md's 2026-07-15 education date-tolerance
 * entry, where the model was computing the right arithmetic but still
 * emitting the wrong status because of field-ordering in the tool schema) —
 * pure code cannot misapply its own rule the way a model occasionally could.
 */

export interface EducationYearComparison {
  status: "match" | "discrepancy" | "cannot_verify";
  severity?: "material" | "minor";
}

/**
 * @param resumeYear The resume's bare graduation year (e.g. "Expected 2029" → 2029, treated exactly like a confirmed year), or null if the resume doesn't state a year for this degree.
 * @param crossRefStartYear The cross-reference document's stated start year for the same degree, or null if not shown.
 * @param crossRefEndYear The cross-reference document's stated end year for the same degree, or null if not shown.
 */
export function compareEducationYear(
  resumeYear: number | null,
  crossRefStartYear: number | null,
  crossRefEndYear: number | null
): EducationYearComparison {
  if (resumeYear == null || (crossRefStartYear == null && crossRefEndYear == null)) {
    return { status: "cannot_verify" };
  }

  const diffs: number[] = [];
  if (crossRefStartYear != null) diffs.push(resumeYear - crossRefStartYear);
  if (crossRefEndYear != null) diffs.push(resumeYear - crossRefEndYear);

  const withinMatchRange = diffs.some((d) => d >= -1 && d <= 1);
  if (withinMatchRange) return { status: "match" };

  const minDistance = Math.min(...diffs.map((d) => Math.abs(d)));
  if (minDistance <= 2) return { status: "discrepancy", severity: "minor" };
  return { status: "discrepancy", severity: "material" };
}
