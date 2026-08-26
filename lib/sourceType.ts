/**
 * Shared "how did this candidate get to us" classification — four types,
 * one derived from the others. Added 2026-07-20 (Vlad's ask) alongside a new
 * `agency_name` column on `screenings`; extended 2026-08-26 (Vlad's ask) with
 * a fourth "referred" type alongside a new `referrer_name` column, mirroring
 * `agency`'s mechanism exactly but capturing a person's name instead of an
 * agency's.
 *
 * Deliberately NOT its own DB column / stored enum — it's derived from
 * existing-shape fields (linkedInMode, agencyName, referrerName) so nothing
 * about the do-not-touch scoring path (linkedin_mode driving
 * scoreCandidate.ts) has to change. linkedin_mode wins if more than one
 * happens to be set (shouldn't normally happen — the ScreenTab source picker
 * is mutually exclusive — but scoring behavior takes precedence over a label
 * if the data ever disagrees); agency wins over referred for the same reason.
 */

export type SourceType = "applicant" | "linkedin" | "agency" | "referred";

export function getSourceType(s: { linkedInMode?: boolean; agencyName?: string | null; referrerName?: string | null }): SourceType {
  if (s.linkedInMode) return "linkedin";
  if (s.agencyName) return "agency";
  if (s.referrerName) return "referred";
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
  referred: "Referred",
};

/** Full label including the agency's name or referrer's name where relevant — badges/tooltips. */
export function sourceLabelWithDetail(type: SourceType, agencyName?: string | null, referrerName?: string | null): string {
  if (type === "agency" && agencyName) return `Agency (${agencyName})`;
  if (type === "referred" && referrerName) return `Referred (${referrerName})`;
  return SOURCE_LABELS[type];
}
