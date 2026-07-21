import type { CalibrationExample } from "./types";

/**
 * Bounds how many raw calibration examples ever get shown to Claude in a
 * single scoring call — Vlad's ask, 2026-07-20 ("think about enterprise
 * calibration... many calibration resumes for each project, take scale into
 * this concept"). Full reasoning trail in memory/decisions-log.md.
 *
 * The problem this solves: lib/scoreCandidate.ts (do-not-touch) used to send
 * the FULL text of every calibration example ever added for a project, on
 * every single screening call, with no cap. That's fine at today's volume (a
 * handful of examples per project — flagged as "not a real problem yet" in
 * open-questions.md), but it doesn't hold up once this scales to an
 * enterprise product where a role can accumulate dozens or hundreds of
 * examples over months of real hiring: every screening call gets slower and
 * more expensive as a project's calibration set grows, with no ceiling —
 * the same class of risk that caused the batch-screening timeout bug fixed
 * earlier this session, except baked into every single screening
 * permanently instead of just large batches.
 *
 * Researched before building this (see decisions-log.md for the full
 * writeup and sources): Anthropic's own prompt-engineering guidance
 * recommends 3-5 well-chosen few-shot examples, not an ever-growing pile,
 * and published research on in-context example selection backs this up —
 * indiscriminate example accumulation doesn't reliably help and can hurt,
 * while curated/bounded example sets perform comparably or better. This is
 * the deliberately SIMPLE version of that idea: a fixed cap, with a
 * recency + outcome-balance heuristic, and no new infrastructure. A
 * smarter version — actual similarity search over stored examples via
 * embeddings, so the examples shown are the most RELEVANT to the specific
 * candidate being screened, not just recent — is the natural next step once
 * a project's real example volume justifies that added complexity. Not
 * built yet; deliberately out of scope for this pass.
 *
 * First judgment call, not measured — same category as the existing 4/8
 * calibration-weight thresholds in scoreCandidate.ts (also unconfirmed,
 * also flagged in open-questions.md). Confirm once a real project's
 * calibration set actually grows past this cap.
 */
export const MAX_CALIBRATION_EXAMPLES_PER_SCORE = 6;

/**
 * Picks a bounded, outcome-balanced, recency-ordered subset of calibration
 * examples to actually show Claude — as opposed to the TRUE total count,
 * which still drives calibrationWeightGuidance()'s trust narrative in
 * scoreCandidate.ts unchanged (a role with 50 real examples should still be
 * treated as having a substantial, reliable sample, even though only a
 * handful of the raw resumes are actually shown per call).
 *
 * Assumes `examples` is already ordered most-recent-first — true of
 * lib/calibrationExamples.ts's listCalibrationExamples() today — and
 * preserves that relative order in the returned subset rather than
 * re-sorting.
 *
 * Below the cap, this is a complete no-op (returns the input unchanged) —
 * every project at today's real-world volume sees zero behavior change.
 * Only kicks in once a project's example count actually exceeds `max`.
 */
export function selectCalibrationExamples(
  examples: CalibrationExample[],
  max: number = MAX_CALIBRATION_EXAMPLES_PER_SCORE
): CalibrationExample[] {
  if (examples.length <= max) return examples;

  const good = examples.filter((e) => e.label === "good");
  const bad = examples.filter((e) => e.label === "bad");

  // Split the cap evenly between hired/rejected first, then backfill any
  // leftover slots from whichever group has more left over — so a role
  // with far more hires than rejects (or vice versa) still uses the full
  // cap instead of leaving slots unused.
  const half = Math.floor(max / 2);
  let goodTake = Math.min(good.length, half);
  let badTake = Math.min(bad.length, max - goodTake);
  let remaining = max - goodTake - badTake;
  if (remaining > 0) {
    const extraGood = Math.min(good.length - goodTake, remaining);
    goodTake += extraGood;
    remaining -= extraGood;
  }
  if (remaining > 0) {
    const extraBad = Math.min(bad.length - badTake, remaining);
    badTake += extraBad;
    remaining -= extraBad;
  }

  const selectedIds = new Set([...good.slice(0, goodTake), ...bad.slice(0, badTake)].map((e) => e.id));
  // Filter the original (already recency-ordered) array rather than
  // concatenating the two slices, so the final order stays newest-to-oldest
  // across both outcomes combined instead of all-good-then-all-bad.
  return examples.filter((e) => selectedIds.has(e.id));
}
