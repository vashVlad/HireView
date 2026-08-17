"use client";

import { useMemo } from "react";

/**
 * Shared loading animation, 2026-08-15 (Vlad's ask) — one component for
 * every wait state in the app (screening, cross-reference check, archive-fit
 * checking, suggested-role-fit during new role creation — the last of which
 * had no loading indicator at all before this). A generative wandering line
 * that looks like live scoring happening, reusable at any size: pass a
 * className that sets width/height and the graphic fills it.
 *
 * Confirmed working via a Cowork visual prototype first — see
 * memory/session-log.md's 2026-08-15 entry for the full design trail. Two
 * bugs were found and fixed there, and BOTH are required here, not
 * optional, or the loop visibly restarts instead of scrolling continuously:
 *
 * 1. The generated path's random endpoint doesn't naturally match its fixed
 *    starting value, so the loop would jump at the seam. Fixed by drifting
 *    the whole path back toward its own start value proportionally as it's
 *    generated (see `diff` below), so the last point lands exactly on the
 *    first.
 * 2. The two identical path copies (needed for a seamless scroll) live
 *    inside one <svg>, but that svg's viewBox has to cover BOTH copies'
 *    combined width, not just one segment's — otherwise the second copy
 *    renders at the wrong scale relative to the first and the seam breaks
 *    again despite the path itself being correct.
 */

const VIEW_W = 500;
const VIEW_H = 100;
const POINTS = 60;

// Exported so it's directly unit-testable (see the plain-Node verification
// script this shipped with) without needing to render the component.
export function buildLoopingPath(): string {
  const startY = VIEW_H / 2;
  let y = startY;
  const raw: number[] = [startY];
  for (let i = 1; i <= POINTS; i++) {
    y += (Math.random() - 0.5) * VIEW_H * 0.22;
    y = Math.max(VIEW_H * 0.15, Math.min(VIEW_H * 0.85, y));
    raw.push(y);
  }
  // Drift the whole path back toward its own start value so the last point
  // lands exactly on the first — see this file's header comment, fix #1.
  // Re-clamped after drifting (found via a real unit test, not eyeballing):
  // an intermediate point already near the 15-85 soft clamp, combined with
  // a large drift correction, could push a point outside the SVG's own
  // 0-100 viewBox and visibly clip against the container edge. The two
  // endpoints land exactly on startY (safely mid-range) either way, so this
  // re-clamp never affects them, only the interior points that need it.
  const diff = startY - raw[POINTS];
  const pts = raw.map((val, i): [number, number] => [
    i * (VIEW_W / POINTS),
    Math.max(2, Math.min(VIEW_H - 2, val + diff * (i / POINTS))),
  ]);

  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    const my = (pts[i - 1][1] + pts[i][1]) / 2;
    d += ` Q ${pts[i - 1][0]} ${pts[i - 1][1]} ${mx} ${my}`;
  }
  d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
  return d;
}

export function ScoringLoader({ className = "h-6 w-full", strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  // Generated once per mount, not per render — a fresh random path every
  // time this loader appears is the "generative" part of the spec, but it
  // must stay fixed for the lifetime of one mount or the scroll animation
  // would visibly jump every re-render.
  const d = useMemo(() => buildLoopingPath(), []);

  return (
    <div className={`overflow-hidden ${className}`} role="status" aria-label="Loading">
      <svg
        // ViewBox covers BOTH copies' combined width — see this file's
        // header comment, fix #2. Getting this wrong (viewBox="0 0 500 100"
        // instead of "0 0 1000 100") is what made an earlier version look
        // like it was restarting instead of looping.
        viewBox={`0 0 ${VIEW_W * 2} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="animate-scoring-loader block h-full"
        style={{ width: "200%" }}
      >
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(${i * VIEW_W}, 0)`}>
            <path d={d} fill="none" stroke="#2563eb" strokeWidth={strokeWidth} strokeLinecap="round" />
          </g>
        ))}
      </svg>
    </div>
  );
}
