"use client";

import { useState } from "react";
import type { ExperienceHighlight } from "@/lib/experienceHighlights";
import { TrajectoryRenderer } from "./TrajectoryRenderer";

/**
 * ResultCard redesign, 2026-08-28 (Vlad's ask: collapse the career
 * trajectory below a few bullet-point highlights, full narrative optional).
 * Bullet markers use the same accent colors already in use elsewhere on
 * this card (sky/violet/teal), not a new palette.
 */

const TONE_DOT: Record<ExperienceHighlight["tone"], string> = {
  trajectory: "text-sky-500",
  role: "text-violet-500",
  strength: "text-teal-500",
};

export function ExperienceHighlightsList({
  highlights,
  trajectoryText,
  className,
  highlightsProp,
  hideLabel = false,
}: {
  highlights: ExperienceHighlight[];
  trajectoryText?: string;
  className?: string;
  highlightsProp?: { must: string[]; nice: string[] };
  /**
   * Task #98, 2026-08-28 — the Pipeline tab and All Candidates cards already
   * render their own "Experience at a glance" header (with a credibility
   * signal badge ResultCard doesn't have) directly above where this renders;
   * a second copy of the same label here would be a redundant, adjacent
   * duplicate. ResultCard.tsx has no such header, so it keeps the label.
   */
  hideLabel?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (highlights.length === 0 && !trajectoryText) return null;

  return (
    <div className={hideLabel ? "" : "mt-4"}>
      {!hideLabel && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Experience at a glance
        </p>
      )}

      {highlights.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
              <span className={`mt-0.5 shrink-0 ${TONE_DOT[h.tone]}`}>●</span>
              <span>
                <strong className="font-semibold">{h.label}</strong>
                {h.detail && <span className="text-zinc-500 dark:text-zinc-400"> — {h.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {trajectoryText && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 flex items-center gap-1.5 border-t border-zinc-100 pt-2.5 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <span>{expanded ? "▾" : "▸"}</span>
            {expanded ? "Hide full career trajectory" : "Show full career trajectory"}
          </button>
          {expanded && (
            <div className="mt-2">
              <TrajectoryRenderer text={trajectoryText} className={className ?? "text-sm"} highlights={highlightsProp} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
