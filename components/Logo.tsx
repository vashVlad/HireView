/**
 * HireView mark — "Summit Aperture", 2026-07-15.
 *
 * A two-facet low-poly mountain (Hire = the climb; the two facets at
 * different opacity give it depth instead of reading as one flat triangle)
 * with a circular aperture cut through the summit (Higher View = looking
 * through a lens from the top). The aperture carries a 6-blade iris rim so
 * it reads as an actual camera aperture, not just a hole, and one blade +
 * the off-center focus dot are amber — reusing the same amber the rest of
 * the app already uses for "attention" (pending-request badge, admin role
 * pill) so the mark's accent isn't a color invented just for itself. Design
 * options were reviewed with Vlad (three rounds) before landing here — see
 * memory/session-log.md.
 *
 * Geometry lives in a fixed 100x100 unit box so it scales cleanly from
 * favicon size up to the auth-page hero without redrawing anything; below
 * ~28px the iris ticks naturally read as a soft ring, which is the intended
 * fallback rather than a bug.
 */
export function Logo({
  size = 36,
  rounded = "rounded-xl",
  className = "",
}: {
  size?: number;
  /** Tailwind radius class for the tile corners — kept a prop so call sites
   *  that need a bigger radius (e.g. a hero placement) aren't stuck with the
   *  default without overriding the whole className. */
  rounded?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`${rounded} shadow-md shadow-violet-500/30 ${className}`}
      role="img"
      aria-label="HireView"
    >
      <defs>
        <linearGradient id="hv-logo-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <radialGradient id="hv-logo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
        <mask id="hv-logo-hole">
          <rect x="0" y="0" width="100" height="100" fill="#ffffff" />
          <circle cx="66" cy="34" r="9.2" fill="#000000" />
        </mask>
      </defs>

      <rect x="0" y="0" width="100" height="100" fill="url(#hv-logo-brand)" />

      <g mask="url(#hv-logo-hole)">
        <polygon points="14,78 36,32 50,44" fill="#ffffff" opacity="0.6" />
        <polygon points="50,44 66,20 86,78" fill="#ffffff" />
        <polygon points="14,78 50,44 50,78" fill="#ffffff" opacity="0.6" />
        <polygon points="50,78 50,44 86,78" fill="#ffffff" opacity="0.88" />
      </g>

      <circle cx="66" cy="34" r="12.5" fill="url(#hv-logo-glow)" />
      <circle cx="66" cy="34" r="9.2" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.95" />
      <g stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" opacity="0.85">
        <line x1="66" y1="26.3" x2="66" y2="23.2" transform="rotate(60 66 34)" />
        <line x1="66" y1="26.3" x2="66" y2="23.2" transform="rotate(120 66 34)" />
        <line x1="66" y1="26.3" x2="66" y2="23.2" transform="rotate(180 66 34)" />
        <line x1="66" y1="26.3" x2="66" y2="23.2" transform="rotate(240 66 34)" />
        <line x1="66" y1="26.3" x2="66" y2="23.2" transform="rotate(300 66 34)" />
      </g>
      <line x1="66" y1="25.8" x2="66" y2="22.4" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="69" cy="31.4" r="2.7" fill="#fbbf24" />
    </svg>
  );
}
