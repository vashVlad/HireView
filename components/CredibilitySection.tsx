"use client";

import { useState } from "react";
import type { CredibilityAssessment, CredibilityRow, CredibilitySignal, LinkedInSignals, GithubCorroboration, TrajectoryEntry, ChecklistEvaluation } from "@/lib/types";
import { mapTrajectoryRowToCredibilityRow } from "@/lib/matchTrajectoryEntries";
import { attributeChecklistItemsToRoles } from "@/lib/attributeChecklistToRoles";
import { TrajectoryGraph } from "@/components/TrajectoryGraph";

const SIGNAL_CONFIG: Record<CredibilitySignal, { label: string; className: string }> = {
  clean: {
    label: "Clean",
    className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  minor_concerns: {
    label: "Minor concerns",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  },
  significant_concerns: {
    label: "Significant concerns",
    className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  },
};

const ACTIVITY_CONFIG = {
  active:   { label: "Active",            dot: "bg-emerald-400", text: "text-emerald-700 dark:text-emerald-400" },
  moderate: { label: "Moderate activity", dot: "bg-amber-400",   text: "text-amber-700 dark:text-amber-400" },
  minimal:  { label: "Minimal activity",  dot: "bg-zinc-400",    text: "text-zinc-500 dark:text-zinc-400" },
} as const;

function LinkedInSignalsPanel({ signals }: { signals: LinkedInSignals }) {
  const cfg = ACTIVITY_CONFIG[signals.activity] ?? ACTIVITY_CONFIG.moderate;

  const chips: string[] = [];
  if (signals.connectionCount) chips.push(`${signals.connectionCount} connections`);
  chips.push(
    signals.recommendationCount === 0
      ? "0 recommendations"
      : `${signals.recommendationCount} recommendation${signals.recommendationCount !== 1 ? "s" : ""}`
  );
  chips.push(signals.hasSummary ? "Summary present" : "No summary");
  if (signals.recentCertDate) chips.push(`Cert ${signals.recentCertDate}`);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/30">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Activity
      </span>
      <span className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${cfg.text}`}>
        <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </span>
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{chips.join(" · ")}</span>
    </div>
  );
}

// Brand marks, 2026-08-26 (Vlad's ask: "use their logo chips and usernames
// next to them, that's it" — simplified from the earlier stats-heavy
// GithubSignalPanel/plain-text LinkedInLinkPanel design). Standard
// monochrome brand SVG paths (matches the marks used on linkedin.com/
// github.com themselves) so the chip is instantly recognizable without a
// text label. GitHub's mark uses currentColor (its brand has no fixed
// accent — shown in the surrounding text color); LinkedIn's uses its own
// brand blue, same as everywhere else that mark appears.
function LinkedInLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#0A66C2" className="shrink-0">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function GithubLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const CHIP_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800";

/**
 * GitHub identity chip — logo + username, nothing else. Only rendered in the
 * "Personal details" block at the top of the card (ResultCard.tsx /
 * PipelineTab) as of 2026-08-26 (Vlad: "don't show those links anywhere
 * else. just up top") — previously also shown inside the cross-reference
 * check panel with extra stats (public repos / followers / joined year /
 * company); those are gone now, not just hidden — signal.publicRepos etc.
 * are still fetched and stored (lib/githubCorroboration.ts), just not
 * displayed anywhere, in case a future ask wants them back.
 */
export function GithubSignalPanel({ signal }: { signal: GithubCorroboration }) {
  return (
    <a href={signal.profileUrl} target="_blank" rel="noopener noreferrer" className={CHIP_CLASSES}>
      <GithubLogo />
      <span>{signal.username}</span>
    </a>
  );
}

/**
 * LinkedIn counterpart to GithubSignalPanel directly above — same chip,
 * logo + username. linkedinUrl is just a raw profile URL (no free API to
 * pull a display name from, unlike GitHub), so the username shown here is
 * the vanity slug parsed out of the URL itself (the part after "/in/") —
 * that's genuinely what LinkedIn calls it, same string a recruiter would
 * type to go straight to the profile. Falls back to "Profile" for the rare
 * malformed/non-standard URL where that slug can't be found, rather than
 * showing nothing or a raw URL that would break the chip's width.
 */
export function LinkedInLinkPanel({ url }: { url: string }) {
  const match = url.match(/\/in\/([^/?#]+)/i);
  const username = match ? decodeURIComponent(match[1]) : "Profile";
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={CHIP_CLASSES}>
      <LinkedInLogo />
      <span>{username}</span>
    </a>
  );
}

function CredibilityRowItem({ row, isLinkedIn }: { row: CredibilityRow; isLinkedIn?: boolean }) {
  const isMatch = row.status === "match";
  const isDiscrepancy = row.status === "discrepancy";
  // Material = real, hard-to-explain mismatch worth a follow-up question.
  // Minor = explainable formatting/context difference (staffing-agency naming,
  // title phrasing, LinkedIn's month-only dates, etc.) — still surfaced, but
  // styled less alarmingly so it doesn't read the same as a real red flag.
  // Rows from before this field existed (severity undefined) fall back to
  // the old amber treatment. Added 2026-07-15 alongside the accuracy pass on
  // lib/assessCredibility.ts.
  const isMaterial = isDiscrepancy && row.severity === "material";
  const isMinor = isDiscrepancy && row.severity !== "material";

  const containerClass = isMaterial
    ? "border-l-2 border-rose-400 bg-rose-50 dark:border-rose-500/70 dark:bg-rose-500/8"
    : isMinor
    ? "border-l-2 border-amber-300 bg-amber-50/60 dark:border-amber-500/50 dark:bg-amber-500/6"
    : isMatch
    ? "border-l-2 border-emerald-400 bg-emerald-50/40 dark:border-emerald-500/50 dark:bg-emerald-500/5"
    : "border-l-2 border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/30";

  const icon = isMaterial ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-rose-500 dark:text-rose-400">
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : isDiscrepancy ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-500 dark:text-amber-400">
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : isMatch ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 dark:text-emerald-400">
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3m.08 4h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const fieldClass = isMaterial
    ? "font-semibold text-rose-800 dark:text-rose-300"
    : isDiscrepancy
    ? "font-semibold text-amber-800 dark:text-amber-300"
    : isMatch
    ? "font-medium text-zinc-700 dark:text-zinc-300"
    : "font-medium text-zinc-500 dark:text-zinc-400";

  return (
    <div className={`flex gap-2.5 rounded-lg px-3 py-2.5 ${containerClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs ${fieldClass}`}>{row.field}</span>
          {isMinor && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
              Minor
            </span>
          )}
        </div>
        {isMatch ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{row.resume}</span>
        ) : (
          <div className="flex flex-col gap-0.5 text-xs">
            <span>
              <span className="font-medium text-zinc-500 dark:text-zinc-400">Resume: </span>
              <span className="text-zinc-600 dark:text-zinc-300">{row.resume}</span>
            </span>
            <span>
              <span className="font-medium text-zinc-500 dark:text-zinc-400">{isLinkedIn ? "LinkedIn: " : "Cross-ref: "}</span>
              <span className="text-zinc-600 dark:text-zinc-300">{row.crossRef}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CredibilitySection({
  assessment,
  showSummary = true,
  checklistEvaluation,
  targetCompanyMatches,
}: {
  assessment: CredibilityAssessment;
  showSummary?: boolean;
  /**
   * 2026-08-18 — passed through from the candidate's own screening result
   * (not part of the credibility assessment itself) so the trajectory graph
   * can plot real per-role checklist evidence instead of a flat timeline.
   * See lib/attributeChecklistToRoles.ts and TrajectoryGraph's rolePoints
   * prop for the full "why." Undefined when the project has no checklist,
   * or this screening predates evidenceSource — graph falls back to the
   * plain duration-bar rendering, same as always.
   */
  checklistEvaluation?: ChecklistEvaluation;
  /**
   * Target-company match highlighting, 2026-08-25 (Vlad's ask: "highlight
   * them in the trajectory") — same passed-through-from-the-screening-
   * result pattern as checklistEvaluation above (CandidateResult.
   * targetCompanyMatches, lib/targetCompanyBoost.ts). Passed straight
   * through to TrajectoryGraph, which matches each role's company against
   * this list (lib/targetCompanyBoost.ts's companyMatchesAny) to mark the
   * dot(s) for a role actually at one of the matched companies. Undefined
   * or empty = no target companies configured, or none matched — graph
   * renders with no highlighting, same as always.
   */
  targetCompanyMatches?: string[];
}) {
  const { label, className } = SIGNAL_CONFIG[assessment.overallSignal] ?? SIGNAL_CONFIG.minor_concerns;
  // Open by default once a result exists — Vlad's ask, 2026-07-15: previously
  // defaulted closed, so every credibility result required an extra click to
  // even see, everywhere this renders (ResultCard, Pipeline, All Candidates).
  // The toggle button in the header still lets the recruiter close it.
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"flags" | "matches" | "resolved">("flags");

  // Roadmap 2.5.2, 2026-08-17 — when trajectoryComparison is present (a
  // credibility check run after this feature shipped, against a candidate
  // with stored trajectoryEntries), employment rows come from there instead
  // of assessment.rows (which now only ever carries the education row for
  // these assessments). Mapped into the same CredibilityRow shape so every
  // line below — flags/matches counts, tabs, CredibilityRowItem rendering —
  // is completely unchanged code, just fed from a combined list. Older
  // assessments (trajectoryComparison absent) render exactly as before,
  // straight from assessment.rows.
  const rows: CredibilityRow[] = assessment.trajectoryComparison
    ? [...(assessment.rows ?? []), ...assessment.trajectoryComparison.map(mapTrajectoryRowToCredibilityRow)]
    : assessment.rows ?? [];
  const flags = rows.filter((r) => r.status === "discrepancy");
  const materialFlags = flags.filter((r) => r.severity === "material");
  const matches = rows.filter((r) => r.status === "match");
  const isLinkedIn = !!assessment.linkedInSignals;
  // Graph entries derived from the resume side of each paired comparison row
  // — covers exactly the roles this credibility check actually compared, not
  // necessarily every role on the resume (a role with no cross-reference
  // counterpart at all is deliberately excluded from trajectoryComparison,
  // see lib/matchTrajectoryEntries.ts). A graph independent of any
  // credibility check (every role, always) is a distinct future increment
  // — roadmap 2.5.4's consolidated card.
  const graphEntries: TrajectoryEntry[] = (assessment.trajectoryComparison ?? [])
    .filter((r) => r.kind === "paired" && r.resumeEntry)
    .map((r) => r.resumeEntry!);
  // Per-role fired checklist items, 2026-08-20 (Phase 2.6 Tier 4) — hover/
  // click detail only now, no longer drives the graph's Y-axis (see
  // TrajectoryGraph.tsx's own top-of-file comment: that's now computed from
  // each entry's own stepDirection + employment-gap data). Undefined when
  // there's no checklist evaluation at all, same "don't fabricate a signal
  // that isn't there" reasoning as before.
  const checklistByRole = checklistEvaluation
    ? attributeChecklistItemsToRoles(checklistEvaluation.results, graphEntries)
    : undefined;
  // Cross-reference document's FULL trajectory, plotted as a SECOND line on
  // the SAME graph — 2026-08-18, Y-axis meaning updated 2026-08-20 (Phase
  // 2.6 Tier 4). Every cross-ref-side entry (not just the resume-paired
  // subset — includes "undisclosed" rows too, so it's genuinely the FULL
  // cross-reference trajectory, not a trimmed one). TrajectoryGraph now
  // computes this line's Y-values itself, directly off each crossRefEntry's
  // OWN stepDirection/stepReasoning (extracted by
  // lib/assessCredibility.ts's TRAJECTORY_EXTRACTION_TOOL — see that file's
  // own comment on why it must mirror scoreCandidate.ts's field pair) —
  // no longer derived from the resume side's checklist points at all, which
  // is exactly why the two lines can now genuinely overlap on agreement
  // instead of needing a shared points source. dateDiff flags still carry
  // over from the trajectoryComparison row so a real date discrepancy gets
  // a visible marker (amber ring) even though the line itself isn't a flag
  // mechanism.
  const trajectoryComparison = assessment.trajectoryComparison ?? [];
  const crossRefFullEntries: TrajectoryEntry[] = trajectoryComparison.filter((r) => r.crossRefEntry).map((r) => r.crossRefEntry!);
  const crossRefDateDiff: boolean[] = trajectoryComparison.filter((r) => r.crossRefEntry).map((r) => !!r.fieldDiffs?.dates);
  // Resolved concerns — added 2026-07-29, Vlad's ask: credit the candidate
  // when the cross-reference document actually clears something the
  // original JD-fit screening flagged, not just penalize discrepancies.
  const resolved = assessment.resolvedConcerns ?? [];

  const activeRows = tab === "flags" ? flags : tab === "matches" ? matches : [];

  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40">
      {/* Header — always visible, toggles open/close */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Credibility
          {isLinkedIn && (
            <span title="Cross-referenced against a LinkedIn profile" className="shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" aria-label="LinkedIn" className="shrink-0">
                <rect width="24" height="24" rx="4" fill="#0A66C2" />
                <path fill="#fff" d="M7.2 9.6H4.8V19.2h2.4V9.6zM6 8.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8zM19.2 13.2c0-2.2-1.2-3.8-3.2-3.8-1 0-1.8.5-2.4 1.3V9.6H11.2V19.2h2.4v-5.1c0-1.1.7-1.9 1.7-1.9 1 0 1.5.7 1.5 1.9v5.1h2.4v-6z" />
              </svg>
            </span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
            materialFlags.length > 0
              ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"
              : flags.length > 0
              ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
          }`}>
            {flags.length} flag{flags.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
            {matches.length} match{matches.length !== 1 ? "es" : ""}
          </span>
          {!!assessment.scoreDelta && (
            // Sign-aware as of 2026-07-29 — scoreDelta used to be always
            // <= 0 (a discrepancy deduction), now it's net of that and a
            // possible resolved-concern bonus, so it can be positive too.
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
              assessment.scoreDelta > 0
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400"
            }`}>
              {assessment.scoreDelta > 0 ? "+" : ""}{assessment.scoreDelta} score
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
            {label}
          </span>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`shrink-0 text-zinc-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Expandable content */}
      {open && (
        <div className="flex flex-col gap-3 border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-800">
          {/* Trajectory graph — roadmap 2.5.2, 2026-08-17. ONE graph, two
              lines, 2026-08-18 (third iteration same day — see
              crossRefFullEntries' comment above for the full history: an
              invisible same-height overlay, then two fully separate boxes,
              now one shared graph with a real second polyline). Only
              renders when this assessment used the new comparison flow AND
              actually had at least one paired role to plot (both empty for
              an old-style assessment, or a candidate with no stored
              trajectoryEntries at screening time — see assessCredibility.ts's
              fallback branch). */}
          {graphEntries.length > 0 && (
            <div className="rounded-lg border border-zinc-100 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <TrajectoryGraph
                entries={graphEntries}
                checklistByRole={checklistByRole}
                secondaryEntries={crossRefFullEntries}
                secondaryDateDiff={crossRefDateDiff}
                targetCompanyMatches={targetCompanyMatches}
              />
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-4 border-b border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setTab("flags")}
              className={`flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors ${
                tab === "flags"
                  ? "border-amber-500 text-amber-600 dark:text-amber-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              }`}
            >
              Flags
              <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${tab === "flags" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                {flags.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab("matches")}
              className={`flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors ${
                tab === "matches"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              }`}
            >
              Matches
              <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${tab === "matches" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                {matches.length}
              </span>
            </button>
            {/* Resolved tab — only shown when there's something to show;
                added 2026-07-29 alongside the resolved-concern scoring bonus. */}
            {resolved.length > 0 && (
              <button
                type="button"
                onClick={() => setTab("resolved")}
                className={`flex items-center gap-1.5 border-b-2 pb-2 text-xs font-medium transition-colors ${
                  tab === "resolved"
                    ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                    : "border-transparent text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                }`}
              >
                Resolved
                <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${tab === "resolved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                  {resolved.length}
                </span>
              </button>
            )}
          </div>

          {/* Rows */}
          {tab === "resolved" ? (
            <div className="flex flex-col gap-1.5">
              {resolved.map((r, i) => (
                <div key={i} className="flex gap-2.5 rounded-lg border-l-2 border-emerald-400 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-500/50 dark:bg-emerald-500/5">
                  <span className="mt-0.5 shrink-0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500 dark:text-emerald-400">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                    <span className="font-semibold text-emerald-800 dark:text-emerald-300">{r.concern}</span>
                    <span className="text-zinc-600 dark:text-zinc-300">{r.explanation}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {activeRows.length > 0 ? (
                activeRows.map((row, i) => <CredibilityRowItem key={i} row={row} isLinkedIn={isLinkedIn} />)
              ) : (
                <p className="py-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  {tab === "flags" ? "No flags — everything checked out." : "No verified matches."}
                </p>
              )}
            </div>
          )}

          {/* LinkedIn signals panel — only when cross-ref was a LinkedIn PDF */}
          {isLinkedIn && assessment.linkedInSignals && (
            <LinkedInSignalsPanel signals={assessment.linkedInSignals} />
          )}

          {/* GitHub identity chip REMOVED from this cross-reference panel,
              2026-08-26 (Vlad: "don't show those links anywhere else. just
              up top") — GithubSignalPanel now renders exclusively in the
              "Personal details" block at the top of the card
              (ResultCard.tsx / PipelineTab), not duplicated here too. */}

          {/* Summary — only shown when not lifted into parent */}
          {showSummary && (
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
              <span className="font-semibold text-zinc-400 dark:text-zinc-500">Industry</span>
              <span className="text-zinc-600 dark:text-zinc-400">{assessment.industryNote}</span>
              <span className="font-semibold text-zinc-400 dark:text-zinc-500">Trajectory</span>
              <span className="text-zinc-600 dark:text-zinc-400">{assessment.trajectoryNote}</span>
              {assessment.resumeDelta && (
                <>
                  <span className="font-semibold text-zinc-400 dark:text-zinc-500">Δ Resume</span>
                  <span className="text-zinc-600 dark:text-zinc-400">{assessment.resumeDelta}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
