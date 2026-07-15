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
 * Free post-score safety net: candidate name only exists once Claude has
 * already scored the resume, so this can never avoid the scoring cost the
 * way hashResumeText can — it's purely an informational signal for two
 * genuinely different resume files (different filenames, different content)
 * that turn out to name the same candidate. Deliberately loose (whitespace/
 * case only) — a name match doesn't imply fraud, just "worth a second look."
 * As of 2026-07-15, this is also the ONLY same-candidate signal besides the
 * exact content hash — a filename-only match (normalizeFileName, removed
 * this date) was retired because it compared incidental strings rather than
 * real identity, and produced false positives on generic filenames like
 * "Resume (16).pdf". See decisions-log.md.
 */
export function normalizeCandidateName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}
