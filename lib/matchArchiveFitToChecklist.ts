import type { ChecklistItem } from "./types";

/**
 * Archive Fits — Stage 2 deterministic checklist matching, 2026-08-17
 * (Vlad's ask, see memory/open-questions.md's 2026-08-14 entry, item 5).
 * Stage 1 (app/api/projects/[id]/archive-fits/check/route.ts, unchanged)
 * cheaply classifies which archived candidates plausibly fit a new role
 * based on their generic suggested_role_fits title alone — no real skill
 * evidence involved. This stage adds that evidence: for a candidate who
 * already cleared stage 1, which of the NEW project's checklist items does
 * their existing strengths[]/concerns[] text actually back up?
 *
 * Deliberately NOT an AI call — both sides are already short, structured
 * phrases by this point (a checklist item's label, a strength/concern
 * string), not raw JD prose, so a plain deterministic word-overlap check is
 * enough and costs nothing per candidate. Reuses the exact tokenize/Jaccard
 * convention lib/generateFingerprint.ts already established for this kind
 * of loose text comparison, rather than inventing a second one.
 *
 * Loose/partial matching, not exact equality — candidate phrasing ("FHIR/
 * HL7: implemented at Abridge with audit logging") won't usually match
 * checklist wording ("FHIR interoperability experience") verbatim. Compares
 * each checklist item against EVERY strength/concern individually (not one
 * big concatenated blob) and keeps the single best-matching phrase per item
 * — concatenating everything first would dilute a real match's signal and
 * let unrelated shared words across the whole set produce false positives.
 */

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "was", "were", "are", "not", "but", "you", "your", "their", "they", "them",
  "who", "what", "when", "where", "how", "into", "over", "under", "about",
  "years", "year", "experience", "experienced", "using", "used", "use",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

/**
 * Coverage, not Jaccard — deliberately asymmetric. Plain Jaccard (shared /
 * union) penalizes a real match whenever the CANDIDATE phrase happens to be
 * longer/more descriptive than the checklist item (e.g. "FHIR
 * interoperability experience" only has 2 significant tokens; a candidate
 * phrase like "FHIR/HL7: implemented at Abridge with audit logging" shares
 * just "fhir" but has 6 tokens of its own — the union-based ratio reads as
 * a near-miss even though the checklist item's actual substance IS present).
 * Coverage instead asks the question this feature actually cares about: of
 * the checklist item's own key terms, how many appear anywhere in the
 * candidate's phrase? A short, specific item (as generateChecklist.ts's own
 * prompt asks for — "4-10 words") sharing at least half its significant
 * terms with a candidate phrase is real, checkable evidence. Found via a
 * real failing case in this file's own unit test
 * (test_archive_fit_checklist_match.mjs) — the original Jaccard-with-
 * override version missed exactly the FHIR example above.
 */
const COVERAGE_THRESHOLD = 0.5;

// Real bug found and fixed 2026-08-17, live-verified: "decrease" items are
// inherently gap/absence checks by definition (that's what makes them
// "decrease" items), so their natural phrasing is negation-based — "No
// container orchestration experience," "Lacks public cloud experience,"
// exactly what generateChecklist.ts's own prompt ("4-10 words, checkable in
// one read") would produce. Coverage matching has zero polarity awareness:
// negation words are either stop words or too short to survive tokenize(),
// so only the CONTENT keywords ("container", "orchestration") drive the
// score — meaning a candidate who strongly HAS that exact skill (e.g.
// "Container orchestration: extensive Kubernetes and Docker Swarm
// production experience") scores a near-perfect coverage match against a
// checklist item whose entire point is that they DON'T have it. Confirmed
// reproducible against 3 realistic label/strength pairs, not hypothetical.
// Since this matcher structurally cannot reason about polarity (that would
// need real language understanding, i.e. an AI call — explicitly ruled out
// for this deterministic stage), the safe fix is to never attempt evidence
// matching for a negation-phrased label at all, rather than risk showing a
// backwards "Evidence" chip. No false negative cost worth worrying about
// either — a "decrease" item phrased as a plain positive skill name (e.g.
// "Container orchestration experience" instead of "No container
// orchestration experience") still matches normally; only literal
// negation phrasing is excluded.
const NEGATION_RE = /\b(no|not|n't|lack|lacks|lacking|missing|without|none|never|absent|absence)\b/i;

function isNegatedLabel(label: string): boolean {
  return NEGATION_RE.test(label);
}

function phraseMatchScore(checklistLabel: string, candidatePhrase: string): number {
  const itemTokens = tokenize(checklistLabel);
  if (itemTokens.size === 0) return 0;
  const phraseTokens = tokenize(candidatePhrase);
  let shared = 0;
  for (const t of itemTokens) if (phraseTokens.has(t)) shared++;
  return shared / itemTokens.size;
}

/**
 * For each checklist item, true if ANY of the candidate's strengths or
 * concerns plausibly backs it up. Returns just the items that matched —
 * empty array means stage 1's suggestion has no concrete skill evidence
 * behind it (see this feature's open-questions.md entry for the optional
 * AI-fallback idea for that case — deliberately not built here, since it
 * can't be verified without a live Anthropic call and this stage's whole
 * point is being free/deterministic).
 */
export function matchCandidateToChecklist(
  strengths: string[],
  concerns: string[],
  checklistItems: ChecklistItem[]
): ChecklistItem[] {
  const candidatePhrases = [...(strengths ?? []), ...(concerns ?? [])].filter((p) => p && p.trim().length > 0);
  if (candidatePhrases.length === 0 || checklistItems.length === 0) return [];

  return checklistItems.filter(
    (item) =>
      !isNegatedLabel(item.label) &&
      candidatePhrases.some((phrase) => phraseMatchScore(item.label, phrase) >= COVERAGE_THRESHOLD)
  );
}
