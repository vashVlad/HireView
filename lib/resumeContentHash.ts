import { createHash } from "crypto";

/**
 * Cheap, exact-match duplicate signal — SHA-256 of the extracted resume text,
 * normalized so a re-exported/re-saved copy of the same content still
 * matches even if the raw file bytes differ (different PDF metadata,
 * different producer app, etc.). No Claude call, no fuzziness: this is
 * intentionally NOT the same thing as generateFingerprint.ts's semantic
 * fingerprint (Phase 1.1), which is fuzzy-matched and identity-scrubbed for
 * fraud detection. This is purely "is this literally the same document,"
 * used to skip re-scoring an exact re-upload before it ever reaches Claude.
 *
 * Shared by lib/screenings.ts (stores the hash on save) and
 * app/api/screen-resumes/check-existing/route.ts (checks it before scoring)
 * — both must normalize identically or matches will silently miss.
 */
export function hashResumeText(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Weaker fallback signal for "might be the same candidate, possibly an
 * edited resume" — used only when the exact hash above doesn't match.
 * Strips extension, casing, and common re-save suffixes ("(1)", "-copy",
 * "_v2", "final", etc.) so "John_Smith_Resume.pdf" and
 * "John_Smith_Resume_v2.pdf" normalize to the same value. Free, local,
 * no Claude call — deliberately noisy in favor of false positives over
 * false negatives, since a match here only offers a credibility comparison,
 * it never silently skips or overwrites anything.
 */
export function normalizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "") // strip extension
    .replace(/[_\-\s]+(v?\d+|copy|final|updated|new|revised)\)?$/g, "") // trailing version/copy markers
    .replace(/\(\d+\)$/, "") // trailing " (1)" style suffix
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Free post-score safety net: candidate name only exists once Claude has
 * already scored the resume, so this can never avoid the scoring cost the
 * way hashResumeText/normalizeFileName can — it's purely an informational
 * signal for a case neither of those catch: two genuinely different resume
 * files (different filenames, different content) that turn out to name the
 * same candidate. Deliberately loose (whitespace/case only) — a name match
 * doesn't imply fraud, just "worth a second look."
 */
export function normalizeCandidateName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}
