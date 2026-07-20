import type { SourceType } from "@/lib/sourceType";
import { sourceLabelWithDetail } from "@/lib/sourceType";

/**
 * Shared source icon — factors out the LinkedIn SVG that used to be
 * copy-pasted independently in ResultCard.tsx, app/candidates/page.tsx, and
 * app/projects/[id]/page.tsx (three separate hand-maintained copies), and
 * adds a matching Agency icon so all three surfaces get it "for free" by
 * switching to this component. Vlad's ask, 2026-07-20 — three source types
 * now: Applicant, Sourced (LinkedIn), Agency.
 *
 * Applicant deliberately renders nothing by default (`showApplicant` off) —
 * matches the pre-existing convention on ResultCard/candidates/Pipeline
 * where "no badge" already meant "ordinary applicant," so behavior for the
 * common case is unchanged. Pass `showApplicant` where a badge should
 * always render regardless of type (e.g. FunnelView's Source column, which
 * already showed a pill for every row before this change).
 */
export default function SourceIcon({
  type,
  agencyName,
  size = 14,
  showApplicant = false,
}: {
  type: SourceType;
  agencyName?: string | null;
  size?: number;
  showApplicant?: boolean;
}) {
  if (type === "applicant" && !showApplicant) return null;

  const title = sourceLabelWithDetail(type, agencyName);

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
          <rect width="24" height="24" rx="4" fill="#DC2626" />
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

  // Applicant, shown only when showApplicant is true.
  return (
    <span title={title} className="shrink-0">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Applicant" className="shrink-0">
        <rect width="24" height="24" rx="4" fill="#16A34A" />
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
