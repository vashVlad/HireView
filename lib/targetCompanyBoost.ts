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
 * resume text — not scoped to an "Experience" section, still not fuzzy/
 * rebrand-aware (e.g. "Google" won't catch "Alphabet Inc." — that needs a
 * real maintained alias list, deliberately out of scope). This IS now
 * legal-suffix-aware as of 2026-08-19 (Phase 2.6, Vlad's ask) — see
 * stripLegalSuffix below. A heavier NLP-based match would still trade
 * simplicity/auditability for marginal precision beyond that.
 *
 * The bonus is FLAT, not stacked — matching three target companies gives the
 * same +TARGET_COMPANY_BOOST_POINTS as matching one. Stacking would reward
 * resumes that just list more company names, which isn't the signal this is
 * meant to capture.
 */

export const TARGET_COMPANY_BOOST_POINTS = 5;

/**
 * Target-company pre-score gate, 2026-08-24 (Vlad's ask) — the archiveReason
 * saved for a candidate whose resume matched none of the project's target
 * companies while Project.requireTargetCompanyMatch is on. This is the ONLY
 * durable (persisted, reload-survivable) signal that a candidate was
 * filtered by this gate specifically, rather than a plain below-threshold
 * auto-archive — see lib/isTargetCompanyGateResult.ts, which infers gate
 * status from this exact string on reload the same way isGate1OnlyResult.ts
 * infers gate1Only from an empty summary + present checklistEvaluation.
 */
export const NO_TARGET_COMPANY_MATCH_REASON = "No target company match";

export interface TargetCompanyBoostResult {
  matched: boolean;
  matchedCompanies: string[];
  bonus: number;
}

/**
 * Strips a trailing legal-entity suffix so a target company entered with a
 * fuller legal name ("Google LLC") still matches a resume that just says the
 * bare name ("Google") — 2026-08-19 (Phase 2.6, Vlad's ask: alias-awareness
 * for target-company matching, "loose match only" per his explicit choice).
 * Deliberately one-directional — only the TARGET side needs this. A shorter
 * target name already matches inside a longer resume mention via plain
 * substring matching with zero changes (target "Google" already matches
 * resume "Google LLC" today); the gap was specifically the reverse, a
 * longer/suffixed target failing to match a bare resume mention. Returns the
 * original (lowercased) string unchanged if stripping would leave fewer than
 * 2 characters — avoids a degenerate, over-broad key like matching on "co"
 * alone if a target company name is unusually short.
 */
export function stripLegalSuffix(name: string): string {
  const lower = name.toLowerCase().replace(/[.,]/g, "").trim();
  const stripped = lower.replace(/\s+(inc|llc|ltd|corp|corporation|co|company|group|holdings|plc)$/i, "").trim();
  return stripped.length >= 2 ? stripped : lower;
}

export function computeTargetCompanyBoost(resumeText: string, targetCompanies: string[]): TargetCompanyBoostResult {
  const candidates = (targetCompanies ?? [])
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);

  if (candidates.length === 0 || !resumeText) {
    return { matched: false, matchedCompanies: [], bonus: 0 };
  }

  const lowerResume = resumeText.toLowerCase();
  // Dedup on the suffix-stripped key (wide/narrow can list the same company
  // with different casing OR a different legal-suffix form) while preserving
  // the first-seen original casing for display.
  const seen = new Set<string>();
  const matchedCompanies: string[] = [];
  for (const company of candidates) {
    const key = stripLegalSuffix(company);
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
