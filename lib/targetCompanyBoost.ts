/**
 * Deterministic score boost for target-company matches — Vlad's ask,
 * 2026-08-07: "I can just add companies in there that would increase the
 * score if it matches with the candidate's resume." Deliberately NOT baked
 * into scoreCandidate.ts's prompt (do-not-touch, and mixing this into the
 * model's own judgment would make it hard to audit) — this is a flat,
 * code-computed bonus applied to the model's score, same "deterministic,
 * not model-decided" pattern already used for credibility/fraud-risk score
 * adjustments elsewhere in this app.
 *
 * Matching is a plain case-insensitive substring check against the whole
 * resume text — not scoped to an "Experience" section, not fuzzy/alias-aware
 * (e.g. "Google" won't catch "Alphabet Inc."). This is a known, deliberate
 * simplification: Vlad's own ask was literally "if it matches with the
 * candidate's resume," and a heavier NLP-based match would trade simplicity/
 * auditability for marginal precision. Flagged in open-questions.md as a
 * possible future refinement if false positives turn out to be a real problem.
 *
 * The bonus is FLAT, not stacked — matching three target companies gives the
 * same +TARGET_COMPANY_BOOST_POINTS as matching one. Stacking would reward
 * resumes that just list more company names, which isn't the signal this is
 * meant to capture.
 */

export const TARGET_COMPANY_BOOST_POINTS = 5;

export interface TargetCompanyBoostResult {
  matched: boolean;
  matchedCompanies: string[];
  bonus: number;
}

export function computeTargetCompanyBoost(resumeText: string, targetCompanies: string[]): TargetCompanyBoostResult {
  const candidates = (targetCompanies ?? [])
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);

  if (candidates.length === 0 || !resumeText) {
    return { matched: false, matchedCompanies: [], bonus: 0 };
  }

  const lowerResume = resumeText.toLowerCase();
  // Dedup case-insensitively (wide/narrow can list the same company with
  // different casing) while preserving the first-seen original casing for display.
  const seen = new Set<string>();
  const matchedCompanies: string[] = [];
  for (const company of candidates) {
    const key = company.toLowerCase();
    if (seen.has(key)) continue;
    if (lowerResume.includes(key)) {
      seen.add(key);
      matchedCompanies.push(company);
    }
  }

  return {
    matched: matchedCompanies.length > 0,
    matchedCompanies,
    bonus: matchedCompanies.length > 0 ? TARGET_COMPANY_BOOST_POINTS : 0,
  };
}

/**
 * Union of wide.targetCompanies + narrow.targetCompanies, deduped
 * case-insensitively (first-seen casing wins) — the two lists are kept in
 * sync by the FiltersTab edit UI going forward, but pre-existing projects
 * may still have them differ (each was independently AI-generated at
 * analysis time), so both are checked rather than picking just one.
 */
export function combineTargetCompanies(wide: string[] | undefined, narrow: string[] | undefined): string[] {
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const company of [...(wide ?? []), ...(narrow ?? [])]) {
    const trimmed = company.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(trimmed);
  }
  return combined;
}
