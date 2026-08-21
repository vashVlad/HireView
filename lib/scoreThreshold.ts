/**
 * Default score threshold used whenever a project has no `scoreThreshold`
 * configured (a project row with a null/missing score_threshold column, or
 * a screening with no project context at all). Consolidated 2026-08-20 —
 * Claude Code's full-system audit found this same literal (45) hardcoded as
 * a fallback in 9 separate places across the app (lib/projects.ts,
 * app/api/screen-resumes/route.ts, app/api/screenings/save-one/route.ts,
 * app/api/analytics/route.ts, lib/funnelview/data.ts,
 * app/projects/[id]/page.tsx), with nothing tying them together — a real
 * drift risk if this default ever needed to change, since every one of
 * those would need to be found and updated by hand, and a missed one would
 * silently disagree with the rest.
 *
 * This is ONLY the fallback for "no threshold was ever set" — it does not
 * change how a project's real, configured scoreThreshold is read, stored,
 * or used once one exists. A project created with no explicit threshold
 * still gets this value applied consistently everywhere (scoring,
 * analytics, funnel reporting, the Filters tab's own default), instead of
 * however many of the 9 copies happened to get updated together.
 */
export const DEFAULT_SCORE_THRESHOLD = 45;
