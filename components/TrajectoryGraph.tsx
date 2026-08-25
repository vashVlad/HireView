"use client";

/**
 * Roadmap 2.5.2, 2026-08-17 — hand-built timeline rendering a candidate's
 * structured trajectoryEntries. Matches this codebase's own precedent
 * (ScoringLoader.tsx is hand-rolled SVG rather than a dependency) —
 * package.json has zero chart libraries as of this date.
 *
 * This is the "what/when" skeleton — company, title, and time range (and,
 * with the trajectory-direction chart, career shape) at a glance.
 * TrajectoryRenderer.tsx's markdown prose stays the "why" (company fit, key
 * signal, transition logic per role) and isn't replaced by this; the two
 * are meant to sit side by side, not compete.
 *
 * One graph, two lines, 2026-08-18 (third design for the cross-reference
 * comparison, after two rejected earlier this same day): first version
 * overlaid the cross-reference as a dashed line at the SAME y as the resume
 * line — invisible on any clean match. Second version split into two fully
 * separate <TrajectoryGraph> boxes — Vlad: "no I don't want to have two
 * graphs, I want to have two full trajectories on one graph." This is that:
 * `secondary*` props plot a second, complete polyline on the SAME shared
 * time+axis as the primary one, differentiated by color and dash style
 * rather than a forced vertical offset — when the two genuinely agree, the
 * lines genuinely overlap, which is itself the correct signal (not
 * something to be hidden or artificially separated).
 *
 * REDESIGNED 2026-08-20 (Phase 2.6 Tier 4, decisions-log.md's 2026-08-19
 * "later, same session" entry — supersedes the 2026-08-18 Y-axis decision
 * outright): Y-axis is now career trajectory/seniority, not checklist
 * points attributed per role. This is the SEVENTH revision of this
 * component's Y-value meaning across this project's history; per the
 * architecture handoff doc, the SVG overlap/divergence/amber-ring rendering
 * mechanism itself did not need to change — only the data-transform layer
 * feeding it (computeTrajectoryValues below) was replaced. Two independent,
 * both-objective signals drive the shape, both read directly off each
 * TrajectoryEntry (see lib/types.ts's stepDirection/stepReasoning doc
 * comment): (a) the AI-judged stepDirection between consecutive roles
 * (up=+1, lateral=0, down=-1, accumulated), (b) a real employment gap
 * (lib/detectEmploymentGaps.ts, pure date math) forcing a visible dip
 * regardless of what stepDirection said for the role after the gap — this
 * directly answers Vlad's "I don't know how to make it decrease" without a
 * fabricated "company prestige" heuristic. Checklist evidence (still
 * available via the new checklistByRole prop) is now hover/click-only
 * supporting detail, not what drives the line's height.
 */

import { useState } from "react";
import { toMonthRange } from "@/lib/matchTrajectoryEntries";
import { detectEmploymentGaps } from "@/lib/detectEmploymentGaps";
import { companyMatchesAny } from "@/lib/targetCompanyBoost";
import type { TrajectoryEntry } from "@/lib/types";
import type { RoleChecklistDetail } from "@/lib/attributeChecklistToRoles";

const REFERENCE_NOW = new Date();

function formatDateLabel(date: string): string {
  const trimmed = (date ?? "").trim();
  if (trimmed.toLowerCase() === "present" || trimmed.toLowerCase() === "current") return "Present";
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIdx = parseInt(monthMatch[2], 10) - 1;
    return `${monthNames[monthIdx] ?? ""} ${monthMatch[1]}`;
  }
  return trimmed || "—";
}

const EMPLOYMENT_TYPE_LABEL: Record<TrajectoryEntry["employmentType"], string> = {
  "full-time": "Full-time",
  contract: "Contract",
  unknown: "",
};

const STEP_LABEL: Record<NonNullable<TrajectoryEntry["stepDirection"]>, string> = {
  up: "Step up",
  down: "Step down",
  lateral: "Lateral move",
  first: "Earliest role on record",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthIndexToLabel(monthIndex: number, showMonth: boolean): string {
  const year = Math.floor(monthIndex / 12);
  const month0 = ((monthIndex % 12) + 12) % 12;
  return showMonth ? `${MONTH_NAMES[month0]} ${year}` : `${year}`;
}

/**
 * Real axis ticks, 2026-08-18 (Vlad, direct feedback on a screenshot of the
 * shipped graph: "I wanted to have a real looking graph"). One Jan-1-of-
 * each-year tick per year the trajectory spans; falls back to the range's
 * own start/end (month-labeled) when everything fits inside a single
 * calendar year and no January falls inside it, so the axis is never empty.
 */
function buildYearTicks(globalMin: number, globalMax: number): { monthIndex: number; label: string }[] {
  if (!isFinite(globalMin) || !isFinite(globalMax) || globalMax <= globalMin) return [];
  const firstYear = Math.floor(globalMin / 12);
  const lastYear = Math.floor(globalMax / 12);
  const ticks: { monthIndex: number; label: string }[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const jan = year * 12;
    if (jan >= globalMin && jan <= globalMax) ticks.push({ monthIndex: jan, label: monthIndexToLabel(jan, false) });
  }
  if (ticks.length === 0) {
    ticks.push({ monthIndex: globalMin, label: monthIndexToLabel(globalMin, true) });
    ticks.push({ monthIndex: globalMax, label: monthIndexToLabel(globalMax, true) });
  }
  return ticks;
}

// Chart geometry, 2026-08-18 — fixed virtual units, scaled to 100% width by
// the SVG's viewBox; a taller canvas would just add whitespace.
const CHART_TOP = 34;
const CHART_BOTTOM = 150;
const CHART_TICK_END = 158;
const CHART_LABEL_Y = 172;
const CHART_VIEW_H = 186;

interface RoleValue {
  entry: TrajectoryEntry;
  /** Accumulated trajectory-direction value — see computeTrajectoryValues below. Can be negative. */
  value: number;
  /** True when a real employment gap (lib/detectEmploymentGaps.ts) precedes this role. Always false for index 0. */
  hasGapBefore: boolean;
  gapMonths?: number;
  checklist?: RoleChecklistDetail;
}

/**
 * The core data-transform this redesign is about — see this file's own
 * top-of-file comment for the full rationale. Returns one RoleValue per
 * entry, chronologically sorted (oldest first), each carrying a signed
 * accumulated Y-value: the first (earliest) role is baseline 0; every
 * subsequent role adds +1 (stepDirection: "up"), 0 ("lateral"/"first"/
 * undefined — undefined covers any entry generated before this field
 * existed, degrading gracefully to "no direction signal" rather than
 * breaking the line), or −1 ("down") to the running total. A real
 * employment gap before a role forces its value strictly below the
 * previous role's value regardless of what stepDirection said — a gap is a
 * harder, more objective signal than the model's own up/down/lateral call.
 */
function computeTrajectoryValues(entries: TrajectoryEntry[], checklistByRole?: RoleChecklistDetail[]): RoleValue[] {
  const { sortedEntries, gaps } = detectEmploymentGaps(entries, REFERENCE_NOW);
  const gapBeforeIndex = new Map(gaps.map((g) => [g.index + 1, g.gapMonths]));

  const values: RoleValue[] = [];
  let cumulative = 0;
  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i];
    const gapMonths = gapBeforeIndex.get(i);
    const hasGapBefore = gapMonths !== undefined;
    let value: number;
    if (i === 0) {
      value = 0;
    } else {
      const delta = entry.stepDirection === "up" ? 1 : entry.stepDirection === "down" ? -1 : 0;
      value = cumulative + delta;
      if (hasGapBefore) value = Math.min(value, cumulative - 1);
    }
    cumulative = value;
    const checklist = checklistByRole?.find((c) => c.entry === entry);
    values.push({ entry, value, hasGapBefore, gapMonths, checklist });
  }
  return values;
}

interface RoleCluster {
  /** One or more RoleValues, chronological order, that share this cluster's drawn segment. */
  entries: RoleValue[];
  /** Same accumulated Y as every entry in the cluster (clustering only ever groups same-value, overlapping entries — see clusterRoleValues). */
  value: number;
  /** True when a real employment gap precedes the cluster's FIRST entry — a gap can only ever fall between clusters, never inside one (an overlap and a gap are mutually exclusive by definition). */
  hasGapBefore: boolean;
  gapMonths?: number;
  /** Widest real [start, end] span the cluster's entries actually cover, before the backward-jump clip below. */
  naturalStart: number;
  naturalEnd: number;
  /** What's actually drawn — naturalStart/naturalEnd after clipping against neighboring clusters so the polyline's x is never backward. */
  drawnStart: number;
  drawnEnd: number;
}

/**
 * Fixes the real bug this was built for, 2026-08-21 (Vlad, live-reviewing
 * AJ Fuhler's actual graph: "the graph is moving forward and then at some
 * point goes back with a step up, instead of stepping up and moving
 * forward"). Root cause, confirmed against AJ Fuhler's real data: two roles
 * that genuinely overlap in time (a side project or bootcamp running
 * alongside a day job — common, not a data error) each got their own
 * full-width segment in buildSegments, drawn from their OWN start to their
 * OWN end. When segment i's end fell later than segment i+1's start, the
 * polyline had to move backward in time to connect them — visually a
 * candidate's trajectory appearing to "go back."
 *
 * Two-part fix, chosen after comparing four visual redesigns with Vlad
 * (Option A, "Polished Step" — see the 2026-08-21 conversation): (1) adjacent
 * entries that land on the SAME value AND overlap in time merge into one
 * cluster — two things happening at once at the same effective level are one
 * visual step, not two competing ones; (2) adjacent entries/clusters that
 * DIFFER in value but still overlap (e.g. three months still employed at the
 * old job after the new one technically starts) get clipped so the earlier
 * one's drawn end never exceeds the later one's drawn start — the level
 * changes at the moment the new thing begins, which is also how a recruiter
 * would narrate it out loud. The result is a polyline whose x-coordinates
 * are strictly non-decreasing by construction — a backward jump is no
 * longer representable, not just less likely.
 *
 * Deliberately does NOT merge same-value entries that DON'T overlap in time
 * (e.g. two separate lateral moves years apart) — only overlap forces a
 * merge; two genuinely separate periods at the same level still render as
 * two distinct flat segments, same as before this fix.
 */
function clusterRoleValues(values: RoleValue[], referenceNow: Date): RoleCluster[] {
  if (values.length === 0) return [];
  const withRange = values.map((v) => ({ value: v, range: toMonthRange(v.entry, referenceNow) }));

  interface Building {
    entries: RoleValue[];
    value: number;
    naturalStart: number;
    naturalEnd: number;
  }
  const building: Building[] = [];
  let current: Building | null = null;

  for (const { value: v, range } of withRange) {
    const start: number = isFinite(range[0]) ? range[0] : (current?.naturalStart ?? 0);
    const end: number = isFinite(range[1]) ? range[1] : start;
    const overlapsCurrent = current !== null && start < current.naturalEnd;
    if (current && v.value === current.value && overlapsCurrent) {
      current.entries.push(v);
      current.naturalEnd = Math.max(current.naturalEnd, end);
    } else {
      current = { entries: [v], value: v.value, naturalStart: start, naturalEnd: end };
      building.push(current);
    }
  }

  // Clip: an earlier cluster's drawn end can never exceed the next cluster's
  // start — this is what actually guarantees the fix, not just the merge
  // above (merging handles same-value overlaps; different-value overlaps
  // still need this clip, e.g. Bank of America vs. a role that starts while
  // it's still technically ongoing).
  const drawnEnds = building.map((c) => c.naturalEnd);
  for (let i = 0; i < building.length - 1; i++) {
    if (drawnEnds[i] > building[i + 1].naturalStart) drawnEnds[i] = building[i + 1].naturalStart;
  }

  return building.map((c, i) => ({
    entries: c.entries,
    value: c.value,
    hasGapBefore: c.entries[0].hasGapBefore,
    gapMonths: c.entries[0].gapMonths,
    naturalStart: c.naturalStart,
    naturalEnd: c.naturalEnd,
    drawnStart: c.naturalStart,
    drawnEnd: drawnEnds[i],
  }));
}

function buildSegments(clusters: RoleCluster[], globalMin: number, span: number, minY: number, maxY: number) {
  const yRange = Math.max(1, maxY - minY);
  function xForSvg(monthIndex: number): number {
    const start = isFinite(monthIndex) ? monthIndex : globalMin;
    return Math.max(0, Math.min(1000, ((start - globalMin) / span) * 1000));
  }
  function yForSvg(value: number): number {
    return CHART_BOTTOM - ((value - minY) / yRange) * (CHART_BOTTOM - CHART_TOP);
  }
  const segments = clusters.map((cluster) => ({
    x1: xForSvg(cluster.drawnStart),
    x2: xForSvg(cluster.drawnEnd),
    y: yForSvg(cluster.value),
    cluster,
  }));
  const polyline = segments.flatMap((s) => [`${s.x1},${s.y}`, `${s.x2},${s.y}`]).join(" ");
  return { segments, polyline };
}

function buildDetailText(row: RoleValue, label?: string, targetCompanyMatches?: string[]): string {
  const typeLabel = EMPLOYMENT_TYPE_LABEL[row.entry.employmentType] || "";
  const isTargetMatch = !!targetCompanyMatches?.length && companyMatchesAny(row.entry.company, targetCompanyMatches);
  const parts = [
    `${label ? `${label}: ` : ""}${row.entry.title} · ${row.entry.company} — ${formatDateLabel(row.entry.startDate)} – ${formatDateLabel(row.entry.endDate)}${typeLabel ? ` · ${typeLabel}` : ""}`,
    row.entry.stepDirection ? `${STEP_LABEL[row.entry.stepDirection]}${row.entry.stepReasoning ? `: ${row.entry.stepReasoning}` : ""}` : undefined,
    row.hasGapBefore ? `${row.gapMonths}-month gap before this role` : undefined,
    row.checklist && row.checklist.firedItems.length > 0
      ? `Checklist evidence here: ${row.checklist.firedItems.map((i) => i.label).join(", ")}`
      : undefined,
    // Target-company highlighting, 2026-08-25 (Vlad's ask: "highlight them
    // in the trajectory") — reuses the exact list already confirmed by
    // computeTargetCompanyBoost (CandidateResult.targetCompanyMatches), not
    // the project's full configured target list, so this only ever marks a
    // role that genuinely contributed to the score boost.
    isTargetMatch ? "★ Target company match" : undefined,
  ];
  return parts.filter(Boolean).join(" — ");
}

/** Native <title> hover text for a whole cluster — one line per entry when more than one shares the segment (see clusterRoleValues). */
function buildClusterDetailText(cluster: RoleCluster, label?: string, targetCompanyMatches?: string[]): string {
  return cluster.entries.map((row) => buildDetailText(row, label, targetCompanyMatches)).join("\n");
}

/** True when any entry in this cluster is at one of the candidate's already-confirmed matched target companies. */
function clusterHasTargetMatch(cluster: RoleCluster, targetCompanyMatches?: string[]): boolean {
  if (!targetCompanyMatches?.length) return false;
  return cluster.entries.some((row) => companyMatchesAny(row.entry.company, targetCompanyMatches));
}

/**
 * The on-chart direct label, 2026-08-21 (Option A, "Polished Step" —
 * Vlad's pick after comparing four redesigns) — role names now sit on the
 * chart itself instead of being click-only, same instinct as every other
 * label added to this app's cards. A cluster of 2 gets both company names;
 * 3+ collapses to the first plus a count, same overflow convention as a
 * "+N" avatar stack, so it never runs the chart out of room.
 */
function buildClusterLabel(cluster: RoleCluster): { primary: string; sub: string } {
  const companies = cluster.entries.map((r) => r.entry.company);
  if (cluster.entries.length === 1) {
    return { primary: companies[0], sub: cluster.entries[0].entry.title };
  }
  const primary =
    companies.length === 2 ? companies.join(" + ") : `${companies[0]} +${companies.length - 1} more`;
  return { primary, sub: `${cluster.entries.length} roles at once` };
}

export function TrajectoryGraph({
  entries,
  checklistByRole,
  secondaryEntries,
  secondaryChecklistByRole,
  secondaryDateDiff,
  secondaryLabel = "Cross-reference",
  className,
  targetCompanyMatches,
}: {
  entries: TrajectoryEntry[];
  /**
   * Per-role fired checklist items, 2026-08-20 (Phase 2.6 Tier 4) —
   * lib/attributeChecklistToRoles.ts's attributeChecklistItemsToRoles,
   * same length/order as `entries`. Purely hover/click detail now (see this
   * file's top comment) — no longer drives the Y-axis. Omit when no
   * checklist is configured for the project; the graph renders identically
   * either way, just without that one line of extra detail in the tooltip/
   * click panel.
   */
  checklistByRole?: RoleChecklistDetail[];
  /**
   * A second full trajectory plotted on the SAME chart/axis, 2026-08-18 —
   * the cross-reference document's own employment history, computed the
   * EXACT SAME way as the primary line (own stepDirection/gap data,
   * independent computeTrajectoryValues pass) so a genuine agreement
   * between the two shows up as genuine overlap, not a forced offset.
   */
  secondaryEntries?: TrajectoryEntry[];
  secondaryChecklistByRole?: RoleChecklistDetail[];
  /** Parallel to secondaryEntries — true marks a role whose cross-reference dates meaningfully differ from the resume's paired entry, so that point renders with an amber ring instead of the default red. */
  secondaryDateDiff?: boolean[];
  secondaryLabel?: string;
  className?: string;
  /**
   * Target-company match highlighting, 2026-08-25 (Vlad's ask: "show the
   * companies that were found during the screening... also highlight them
   * in the trajectory"). The candidate's own CandidateResult.
   * targetCompanyMatches — already-confirmed matches from
   * computeTargetCompanyBoost, not the project's full configured target
   * list. Checked against both the primary and secondary lines' entries
   * (lib/targetCompanyBoost.ts's companyMatchesAny) so a role at one of
   * these companies gets a distinct emerald ring on its dot, wherever it
   * appears on either line. Undefined/empty = no highlighting, graph
   * renders exactly as before this feature.
   */
  targetCompanyMatches?: string[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (!entries || entries.length === 0) return null;

  const hasSecondary = !!secondaryEntries && secondaryEntries.length > 0;

  const primaryValues = computeTrajectoryValues(entries, checklistByRole);
  const secondaryValues = hasSecondary ? computeTrajectoryValues(secondaryEntries as TrajectoryEntry[], secondaryChecklistByRole) : [];
  const primaryClusters = clusterRoleValues(primaryValues, REFERENCE_NOW);
  const secondaryClusters = hasSecondary ? clusterRoleValues(secondaryValues, REFERENCE_NOW) : [];
  // secondaryDateDiff is keyed to the ORIGINAL secondaryEntries order (as
  // passed by the caller), not the chronologically-resorted order
  // computeTrajectoryValues produces — build a lookup by entry reference so
  // it still lines up correctly after sorting.
  const secondaryDateDiffByEntry = new Map(
    (secondaryEntries ?? []).map((e, i) => [e, secondaryDateDiff?.[i] ?? false])
  );

  // Shared time axis across EVERY role in BOTH series (when present) so
  // positions are visually comparable on one canvas — a finite fallback for
  // any unparseable date (-Infinity/Infinity from toMonthRange) rather than
  // letting one bad entry blow out the scale.
  const allEntries = hasSecondary ? [...entries, ...(secondaryEntries as TrajectoryEntry[])] : entries;
  const allRanges = allEntries.map((e) => toMonthRange(e, REFERENCE_NOW));
  const finiteStarts = allRanges.map((r) => r[0]).filter((n) => isFinite(n));
  const finiteEnds = allRanges.map((r) => r[1]).filter((n) => isFinite(n));
  const globalMin = finiteStarts.length > 0 ? Math.min(...finiteStarts) : 0;
  const globalMax = finiteEnds.length > 0 ? Math.max(...finiteEnds) : globalMin + 12;
  const span = Math.max(1, globalMax - globalMin);

  const yearTicks = buildYearTicks(globalMin, globalMax);

  // Shared Y scale across both series — a role landing at "one step up" on
  // either side must land at the same height, or the two lines can't be
  // honestly compared at a glance. Padded by 1 on each side so a flat (all-
  // lateral, or single-role) trajectory doesn't render pinned to the very
  // top/bottom edge of the chart.
  const allValues = [...primaryValues, ...secondaryValues].map((v) => v.value);
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 0;
  const minY = rawMin - 1;
  const maxY = rawMax + 1;

  function xForSvgGlobal(monthIndex: number): number {
    const start = isFinite(monthIndex) ? monthIndex : globalMin;
    return Math.max(0, Math.min(1000, ((start - globalMin) / span) * 1000));
  }

  const primary = buildSegments(primaryClusters, globalMin, span, minY, maxY);
  const secondary = hasSecondary ? buildSegments(secondaryClusters, globalMin, span, minY, maxY) : null;

  const selected =
    primary.segments.find((_s, i) => selectedKey === `p-${i}`) ??
    secondary?.segments.find((_s, i) => selectedKey === `s-${i}`);

  // Target-company highlighting, 2026-08-25 — only shown in the legend when
  // at least one role on either line actually renders the ring, so the
  // legend never advertises a swatch that isn't in use on this candidate's
  // graph (e.g. matches exist per the card badge, but none of the matched
  // companies happen to fall inside THIS credibility check's paired roles).
  const hasAnyTargetMatch =
    !!targetCompanyMatches?.length &&
    (primary.segments.some((s) => clusterHasTargetMatch(s.cluster, targetCompanyMatches)) ||
      !!secondary?.segments.some((s) => clusterHasTargetMatch(s.cluster, targetCompanyMatches)));

  return (
    <div className={`flex flex-col ${className ?? ""}`}>
      <div className="flex flex-col gap-1">
        <svg
          viewBox={`0 0 1000 ${CHART_VIEW_H}`}
          className="w-full"
          style={{ height: 170 }}
          role="img"
          aria-label={hasSecondary ? "Career trajectory over time, resume and cross-reference" : "Career trajectory over time"}
        >
          <title>Career trajectory (seniority direction) over time</title>
          <g className="text-zinc-200 dark:text-zinc-800">
            {yearTicks.map((tick) => (
              <line
                key={tick.monthIndex}
                x1={xForSvgGlobal(tick.monthIndex)}
                x2={xForSvgGlobal(tick.monthIndex)}
                y1={CHART_TOP}
                y2={CHART_BOTTOM}
                stroke="currentColor"
                strokeWidth={1}
              />
            ))}
          </g>
          {/* Baseline (the earliest role's own level, value 0) — no longer
              necessarily the bottom of the chart now that values can go
              negative (a "down" step), so this is drawn at its own computed
              y rather than assumed to be CHART_BOTTOM. */}
          <line
            x1={0}
            x2={1000}
            y1={CHART_BOTTOM - ((0 - minY) / Math.max(1, maxY - minY)) * (CHART_BOTTOM - CHART_TOP)}
            y2={CHART_BOTTOM - ((0 - minY) / Math.max(1, maxY - minY)) * (CHART_BOTTOM - CHART_TOP)}
            className="text-zinc-300 dark:text-zinc-700"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="2 3"
          />

          {/* Cross-reference trajectory, drawn BEHIND the resume line so a
              perfect overlap still shows the resume line on top, clean —
              no artificial offset. Distinguished by color (red, per Vlad's
              2026-08-20 ask — was violet in the initial build) and a dashed
              stroke, not position. Computed via the exact same
              computeTrajectoryValues pass as the primary line. */}
          {secondary && (
            <>
              <polyline
                points={secondary.polyline}
                fill="none"
                className="text-red-400 dark:text-red-500"
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray="5 3"
                strokeLinejoin="round"
              />
              {secondary.segments.map((s, i) => {
                const cx = (s.x1 + s.x2) / 2;
                const dateDiff = s.cluster.entries.some((r) => secondaryDateDiffByEntry.get(r.entry));
                // Target-company highlighting, 2026-08-25 — a real date
                // discrepancy is the more urgent signal, so it keeps
                // priority on the ring color when both happen to apply to
                // the same cluster (rare, but possible).
                const isTargetMatch = !dateDiff && clusterHasTargetMatch(s.cluster, targetCompanyMatches);
                return (
                  <g key={`sec-${i}`}>
                    {s.cluster.hasGapBefore && (
                      <circle cx={s.x1} cy={s.y - 7} r={2.5} className="fill-zinc-400 dark:fill-zinc-500">
                        <title>{`${secondaryLabel}: ${s.cluster.gapMonths}-month gap before this role`}</title>
                      </circle>
                    )}
                    <circle
                      cx={cx}
                      cy={s.y}
                      r={4}
                      className="fill-red-400 dark:fill-red-500"
                      stroke={dateDiff ? "#f59e0b" : isTargetMatch ? "#10b981" : "none"}
                      strokeWidth={dateDiff || isTargetMatch ? 2 : 0}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedKey((k) => (k === `s-${i}` ? null : `s-${i}`))}
                    >
                      <title>{buildClusterDetailText(s.cluster, secondaryLabel, targetCompanyMatches) + (dateDiff ? " — date discrepancy vs. resume" : "")}</title>
                    </circle>
                  </g>
                );
              })}
            </>
          )}

          {/* The resume line — one continuous polyline through every role's
              (start, value) and (end, value), so consecutive roles connect
              with a diagonal — the "up and down" shape, now genuinely
              grounded in trajectory-direction + gap signals instead of
              checklist evidence. */}
          <polyline
            points={primary.polyline}
            fill="none"
            className="text-blue-500 dark:text-blue-400"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {primary.segments.map((s, i) => {
            const cx = (s.x1 + s.x2) / 2;
            const isLast = i === primary.segments.length - 1;
            // Direct on-chart labels, 2026-08-21 (Option A) — skipped on a
            // segment too narrow to hold text without colliding with its
            // neighbor; still fully readable via the existing hover/click,
            // same degrade-gracefully convention as everything else here.
            const wideEnoughForLabel = s.x2 - s.x1 >= 55 || isLast;
            const { primary: labelPrimary, sub: labelSub } = buildClusterLabel(s.cluster);
            const labelAnchor = isLast ? "end" : "middle";
            const labelX = isLast ? Math.min(s.x2, 985) : cx;
            // Target-company highlighting, 2026-08-25 (Vlad's ask) — a
            // distinct emerald ring, same color family as the "Target
            // company match" badge on the card itself, so the two visually
            // read as the same signal.
            const isTargetMatch = clusterHasTargetMatch(s.cluster, targetCompanyMatches);
            return (
              <g key={i} className="text-blue-500 dark:text-blue-400">
                {s.cluster.hasGapBefore && (
                  <circle cx={s.x1} cy={s.y - 7} r={2.5} className="fill-zinc-400 dark:fill-zinc-500">
                    <title>{`${s.cluster.gapMonths}-month gap before this role`}</title>
                  </circle>
                )}
                <circle
                  cx={cx}
                  cy={s.y}
                  r={isTargetMatch ? 5 : 4}
                  fill="currentColor"
                  stroke={isTargetMatch ? "#10b981" : "none"}
                  strokeWidth={isTargetMatch ? 2 : 0}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedKey((k) => (k === `p-${i}` ? null : `p-${i}`))}
                >
                  <title>{buildClusterDetailText(s.cluster, undefined, targetCompanyMatches)}</title>
                </circle>
                {/* Twin-dot marker — this segment folds together 2+ roles
                    that genuinely overlapped in time (see clusterRoleValues'
                    own comment for why they're one visual step, not two
                    competing ones). */}
                {s.cluster.entries.length > 1 && (
                  <circle cx={cx + 9} cy={s.y} r={3.5} fill="currentColor" className="text-zinc-400 dark:text-zinc-500" stroke="white" strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                )}
                {wideEnoughForLabel && (
                  <g className="text-zinc-700 dark:text-zinc-200" style={{ pointerEvents: "none" }}>
                    <text x={labelX} y={s.y - 14} textAnchor={labelAnchor} fontSize={11} fontWeight={700} fill="currentColor">
                      {labelPrimary}
                    </text>
                    <text x={labelX} y={s.y - 3} textAnchor={labelAnchor} fontSize={9.5} className="text-zinc-400 dark:text-zinc-500" fill="currentColor">
                      {labelSub}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          <g className="text-zinc-300 dark:text-zinc-700">
            {yearTicks.map((tick) => (
              <line key={tick.monthIndex} x1={xForSvgGlobal(tick.monthIndex)} x2={xForSvgGlobal(tick.monthIndex)} y1={CHART_BOTTOM} y2={CHART_TICK_END} stroke="currentColor" strokeWidth={1} />
            ))}
          </g>
          {yearTicks.map((tick) => (
            <text key={tick.monthIndex} x={xForSvgGlobal(tick.monthIndex)} y={CHART_LABEL_Y} textAnchor="middle" fontSize={9} className="fill-zinc-400 dark:fill-zinc-500">
              {tick.label}
            </text>
          ))}
        </svg>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-[10px] text-zinc-400 dark:text-zinc-500">
          {hasSecondary && (
            <>
              <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-blue-500 dark:bg-blue-400" /> Resume</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-full border border-dashed border-red-400 dark:border-red-500" /> {secondaryLabel}</span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
            </>
          )}
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500" /> Gap marker</span>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full border border-white bg-zinc-400 shadow-[0_0_0_1px] shadow-zinc-400 dark:bg-zinc-500" /> Two roles at once</span>
          {hasAnyTargetMatch && (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full border-2 border-emerald-500 bg-white dark:bg-zinc-900" /> Target company match</span>
            </>
          )}
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span>Click a point for detail</span>
        </div>
        {/* Click-to-expand detail panel, 2026-08-20 (Phase 2.6 Tier 4 —
            "hover/click interactivity on every point"). Hover already works
            via the native <title> tooltips above; this is the "click" half
            — a small persistent card so the same detail is readable without
            holding a mouse in place, and works on touch devices where hover
            tooltips don't. */}
        {selected && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300">
            {selected.cluster.hasGapBefore && (
              <p className="mb-1.5 text-amber-600 dark:text-amber-400">{selected.cluster.gapMonths}-month gap before this.</p>
            )}
            {selected.cluster.entries.length > 1 && (
              <p className="mb-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                {selected.cluster.entries.length} roles running at once:
              </p>
            )}
            <div className="flex flex-col gap-2.5">
              {selected.cluster.entries.map((row, i) => {
                const isTargetMatch = !!targetCompanyMatches?.length && companyMatchesAny(row.entry.company, targetCompanyMatches);
                return (
                <div key={i} className={i > 0 ? "border-t border-zinc-200 pt-2 dark:border-zinc-700" : undefined}>
                  <p className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
                    {row.entry.title} · {row.entry.company}
                    {isTargetMatch && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        Target company
                      </span>
                    )}
                  </p>
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {formatDateLabel(row.entry.startDate)} – {formatDateLabel(row.entry.endDate)}
                    {EMPLOYMENT_TYPE_LABEL[row.entry.employmentType] ? ` · ${EMPLOYMENT_TYPE_LABEL[row.entry.employmentType]}` : ""}
                  </p>
                  {row.entry.stepDirection && (
                    <p className="mt-1">
                      <span className="font-medium">{STEP_LABEL[row.entry.stepDirection]}</span>
                      {row.entry.stepReasoning ? ` — ${row.entry.stepReasoning}` : ""}
                    </p>
                  )}
                  {row.checklist && row.checklist.firedItems.length > 0 && (
                    <p className="mt-1">
                      Checklist evidence: {row.checklist.firedItems.map((item) => item.label).join(", ")}
                    </p>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
