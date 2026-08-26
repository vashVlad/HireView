import type { SourceType } from "@/lib/sourceType";
import { sourceLabelWithDetail } from "@/lib/sourceType";

/**
 * Shared source icon — factors out the LinkedIn SVG that used to be
 * copy-pasted independently in ResultCard.tsx, app/candidates/page.tsx, and
 * app/projects/[id]/page.tsx (three separate hand-maintained copies), and
 * adds a matching Agency icon so all three surfaces get it "for free" by
 * switching to this component. Vlad's ask, 2026-07-20 — three source types
 * now: Applicant, Sourced, Agency.
 *
 * Applicant deliberately renders nothing by default (`showApplicant` off) —
 * matches the pre-existing convention on ResultCard/candidates/Pipeline
 * where "no badge" already meant "ordinary applicant," so behavior for the
 * common case is unchanged. Pass `showApplicant` where a badge should
 * always render regardless of type (e.g. FunnelView's Source column, which
 * already showed a pill for every row before this change).
 *
 * Color tokens, updated 2026-07-27 (Vlad's ask, applied everywhere a source
 * is shown, not just here): Applicant = neutral gray (#71717A, Tailwind
 * zinc-500 — was green), LinkedIn = LinkedIn's own brand blue (#0A66C2 —
 * unchanged, already matched this ask), Agency = orange (#F97316, Tailwind
 * orange-500 — was red, which read as a fraud/danger color despite agency
 * sourcing being a completely neutral, unflagged source type). Every other
 * agency/applicant/LinkedIn-tinted UI in the app (Screen tab's source picker,
 * FunnelView's stacked bars/legend/table badges, the visible agency-name
 * label on ResultCard/Pipeline/All Candidates, the agency-name input's focus
 * ring) was updated to the same three tokens in the same pass — see
 * decisions-log.md.
 *
 * Referred, added 2026-08-26 (Vlad's ask) — teal (#14B8A6, Tailwind
 * teal-500), distinct from all three existing tokens above. Mirrors Agency's
 * mechanism exactly (a name captured alongside the type) but represents a
 * person-to-person referral rather than an agency relationship, hence the
 * two-person glyph instead of a briefcase.
 */
export default function SourceIcon({
  type,
  agencyName,
  referrerName,
  size = 14,
  showApplicant = false,
  contentIsLinkedIn,
}: {
  type: SourceType;
  agencyName?: string | null;
  referrerName?: string | null;
  size?: number;
  showApplicant?: boolean;
  /**
   * Real-content LinkedIn detection (ScreeningRecord/CandidateResult's
   * resumeIsLinkedIn), 2026-07-31 (Vlad's ask) — independent of `type`
   * itself. `type === "linkedin"` ("Sourced") describes the CHANNEL the
   * recruiter classified this candidate under, still set manually via the
   * Screen tab toggle; a recruiter can source someone via LinkedIn outreach
   * and still upload their ordinary resume file, not a LinkedIn export. This
   * prop decides which icon a "Sourced" candidate actually gets: the
   * LinkedIn brand mark only when the uploaded document was actually
   * detected as a genuine LinkedIn profile export (see
   * lib/assessCredibility.ts's detectLinkedIn()); a generic "sourced" icon
   * otherwise. `undefined` (not yet computed — older rows, or the
   * migration not yet confirmed run) is treated the same as `true`, so
   * existing Sourced badges don't visually change until real data exists.
   * Irrelevant for `type !== "linkedin"`.
   */
  contentIsLinkedIn?: boolean;
}) {
  if (type === "applicant" && !showApplicant) return null;

  const title = sourceLabelWithDetail(type, agencyName, referrerName);

  if (type === "linkedin" && contentIsLinkedIn === false) {
    return (
      <span title={title} className="shrink-0">
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Sourced" className="shrink-0">
          <rect width="24" height="24" rx="4" fill="#7C3AED" />
          <circle cx="10.5" cy="10.5" r="4.5" fill="none" stroke="#fff" strokeWidth="1.6" />
          <path d="M14 14l4 4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (type === "linkedin") {
    return (
      <span title={title} className="shrink-0">
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="LinkedIn" className="shrink-0">
          <rect width="24" height="24" rx="4" fill="#0A66C2" />
          <path fill="#fff" d="M7.2 9.6H4.8V19.2h2.4V9.6zM6 8.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM19.2 13.2c0-2.2-1.2-3.8-3.2-3.8-1 0-1.8.5-2.4 1.3V9.6H11.2V19.2h2.4v-5.1c0-1.1.7-1.9 1.7-1.9 1 0 1.5.7 1.5 1.9v5.1h2.4v-6z" />
        </svg>
      </span>
    );
  }

  if (type === "agency") {
    return (
      <span title={title} className="shrink-0">
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Agency" className="shrink-0">
          <rect width="24" height="24" rx="4" fill="#F97316" />
          <path
            fill="none"
            stroke="#fff"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 8V6.8a1.6 1.6 0 0 1 1.6-1.6h4.8A1.6 1.6 0 0 1 16 6.8V8m-11 0h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"
          />
          <path fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" d="M4 13h16" />
        </svg>
      </span>
    );
  }

  if (type === "referred") {
    return (
      <span title={title} className="shrink-0">
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Referred" className="shrink-0">
          <rect width="24" height="24" rx="4" fill="#14B8A6" />
          <circle cx="8.5" cy="9" r="2.1" fill="none" stroke="#fff" strokeWidth="1.4" />
          <path d="M5 17v-0.8c0-1.9 1.6-3.2 3.5-3.2s3.5 1.3 3.5 3.2V17" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="15.5" cy="9" r="2.1" fill="none" stroke="#fff" strokeWidth="1.4" />
          <path d="M12 17v-0.8c0-1.9 1.6-3.2 3.5-3.2s3.5 1.3 3.5 3.2V17" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // Applicant, shown only when showApplicant is true.
  return (
    <span title={title} className="shrink-0">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Applicant" className="shrink-0">
        <rect width="24" height="24" rx="4" fill="#71717A" />
        <path
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 5v10m0 0-3.5-3.5M12 15l3.5-3.5M6 17.5V19h12v-1.5"
        />
      </svg>
    </span>
  );
}
