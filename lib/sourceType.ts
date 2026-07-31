/**
 * Shared "how did this candidate get to us" classification — three types,
 * one derived from the other. Added 2026-07-20 (Vlad's ask) alongside a new
 * `agency_name` column on `screenings`.
 *
 * Deliberately NOT its own DB column / stored enum — it's derived from two
 * existing-shape fields (linkedInMode, agencyName) so nothing about the
 * do-not-touch scoring path (linkedin_mode driving scoreCandidate.ts) has to
 * change. linkedin_mode wins if both happen to be set (shouldn't normally
 * happen — the ScreenTab source picker is mutually exclusive — but scoring
 * behavior takes precedence over a label if the data ever disagrees).
 */

export type SourceType = "applicant" | "linkedin" | "agency";

export function getSourceType(s: { linkedInMode?: boolean; agencyName?: string | null }): SourceType {
  if (s.linkedInMode) return "linkedin";
  if (s.agencyName) return "agency";
  return "applicant";
}

/**
 * Short label — table cells, pills, exports.
 *
 * "linkedin" renamed from "Sourced (LinkedIn)" to plain "Sourced",
 * 2026-07-31 (Vlad's ask) — this label describes the CHANNEL (recruiter
 * sourced the candidate, still set via the same toggle as before), not the
 * file format. Whether the uploaded document is an actual LinkedIn export
 * is now a separate, content-detected signal (see resumeIsLinkedIn /
 * lib/assessCredibility.ts's detectLinkedIn()) that only drives the icon,
 * not this label.
 */
export const SOURCE_LABELS: Record<SourceType, string> = {
  applicant: "Applicant",
  linkedin: "Sourced",
  agency: "Agency",
};

/** Full label including the agency's name where relevant — badges/tooltips. */
export function sourceLabelWithDetail(type: SourceType, agencyName?: string | null): string {
  if (type === "agency" && agencyName) return `Agency (${agencyName})`;
  return SOURCE_LABELS[type];
}
