"use client";

/**
 * Renders a career trajectory string that uses lightweight markdown:
 *   **text**        → bold (role header when entire line is bold)
 *   - item          → bullet list item
 *   blank line      → paragraph / list break
 *
 * Visual hierarchy:
 *   role header  — strong, zinc-900/100, top divider between roles
 *   bullets      — subordinate, zinc-500/400
 *   summary para — softer, xs, top divider
 *
 * Display order: newest role first (resume order / Claude output order).
 *
 * Keyword highlights:
 *   must-have  → amber background
 *   nice-to-have → violet background
 */

import React from "react";

// ── Keyword highlighting ────────────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns how many of the given keywords appear (case-insensitive) in text. */
export function countKeywordMatches(text: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
}

function applyHighlights(
  text: string,
  must: string[],
  nice: string[]
): React.ReactNode[] {
  if (!must.length && !nice.length) return [text];

  type HMatch = { start: number; end: number; kind: "must" | "nice" };
  const matches: HMatch[] = [];

  for (const kw of must) {
    const re = new RegExp(escapeRegex(kw), "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, kind: "must" });
    }
  }
  for (const kw of nice) {
    const re = new RegExp(escapeRegex(kw), "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, kind: "nice" });
    }
  }

  // Sort by start; must-have wins over nice-to-have at same position; drop overlaps
  matches.sort((a, b) => a.start - b.start || (a.kind === "must" ? -1 : 1));
  const kept: HMatch[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) {
      kept.push(m);
      cursor = m.end;
    }
  }

  const nodes: React.ReactNode[] = [];
  let pos = 0;
  for (const m of kept) {
    if (m.start > pos) nodes.push(text.slice(pos, m.start));
    const cls =
      m.kind === "must"
        ? "rounded bg-amber-100 px-0.5 font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
        : "rounded bg-violet-100 px-0.5 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300";
    nodes.push(
      <mark key={m.start} className={cls}>
        {text.slice(m.start, m.end)}
      </mark>
    );
    pos = m.end;
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

// ── Inline parser (bold + highlights) ─────────────────────────────────────

type Segment = { type: "text"; value: string } | { type: "bold"; value: string };

function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: "text", value: text.slice(last, m.index) });
    segments.push({ type: "bold", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
  return segments;
}

function InlineContent({
  text,
  must = [],
  nice = [],
}: {
  text: string;
  must?: string[];
  nice?: string[];
}) {
  const segments = parseInline(text);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "bold" ? (
          <strong key={i}>{applyHighlights(s.value, must, nice)}</strong>
        ) : (
          <span key={i}>{applyHighlights(s.value, must, nice)}</span>
        )
      )}
    </>
  );
}

// ── Block parser ────────────────────────────────────────────────────────────

type Block =
  | { kind: "header"; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] };

/** A line is a role header if the entire trimmed line is wrapped in **…** */
function isHeaderLine(t: string) {
  return /^\*\*[^*]+\*\*$/.test(t);
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n");
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      if (current) { blocks.push(current); current = null; }
      continue;
    }

    if (isHeaderLine(trimmed)) {
      if (current) { blocks.push(current); current = null; }
      blocks.push({ kind: "header", text: trimmed.slice(2, -2) });
      continue;
    }

    const isBullet = /^[-•*]\s+/.test(trimmed);

    if (isBullet) {
      const item = trimmed.replace(/^[-•*]\s+/, "");
      if (current?.kind === "bullets") {
        current.items.push(item);
      } else {
        if (current) blocks.push(current);
        current = { kind: "bullets", items: [item] };
      }
    } else {
      if (current?.kind === "paragraph") {
        current.lines.push(trimmed);
      } else {
        if (current) blocks.push(current);
        current = { kind: "paragraph", lines: [trimmed] };
      }
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

/**
 * Groups blocks into role sections (each starting with a header) plus
 * an optional preamble and trailing summary paragraph.
 * Role groups are kept in original order (newest first — resume order).
 */
function buildRenderOrder(blocks: Block[]): Block[] {
  const firstHeaderIdx = blocks.findIndex((b) => b.kind === "header");
  if (firstHeaderIdx === -1) return blocks;

  const preamble = blocks.slice(0, firstHeaderIdx);
  const rest = blocks.slice(firstHeaderIdx);
  const groups: Block[][] = [];
  let current: Block[] = [];
  let trailingSummary: Block | null = null;

  for (const block of rest) {
    if (block.kind === "header") {
      if (current.length > 0) groups.push(current);
      current = [block];
    } else if (block.kind === "paragraph" && current.length > 0) {
      groups.push(current);
      current = [];
      trailingSummary = block;
      break;
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) groups.push(current);

  // No reversal — keep newest-first (resume order)
  return [
    ...preamble,
    ...groups.flat(),
    ...(trailingSummary ? [trailingSummary] : []),
  ];
}

// ── Component ───────────────────────────────────────────────────────────────

export function TrajectoryRenderer({
  text,
  className,
  highlights,
}: {
  text: string;
  className?: string;
  highlights?: { must: string[]; nice: string[] };
}) {
  const must = highlights?.must ?? [];
  const nice = highlights?.nice ?? [];

  const raw = parseBlocks(text);
  const blocks = buildRenderOrder(raw);

  const summaryBlock = (() => {
    const last = blocks[blocks.length - 1];
    if (!last || last.kind !== "paragraph") return null;
    const hasAnyBullets = blocks.some((b) => b.kind === "bullets");
    return hasAnyBullets ? last : null;
  })();

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.kind === "header") {
          return (
            <p
              key={i}
              className={`text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 ${
                i > 0 ? "mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800" : ""
              }`}
            >
              <InlineContent text={block.text} must={must} nice={nice} />
            </p>
          );
        }

        if (block.kind === "paragraph") {
          if (block === summaryBlock) {
            return (
              <p
                key={i}
                className="mt-3 border-t border-zinc-100 pt-3 text-[12px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                <InlineContent text={block.lines.join(" ")} must={must} nice={nice} />
              </p>
            );
          }
          return (
            <p key={i} className={`leading-relaxed text-zinc-600 dark:text-zinc-300 ${i > 0 ? "mt-3" : ""}`}>
              <InlineContent text={block.lines.join(" ")} must={must} nice={nice} />
            </p>
          );
        }

        // bullets
        return (
          <ul key={i} className="mt-1.5 space-y-1">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                <span className="mt-[3px] shrink-0 text-[8px] text-zinc-300 dark:text-zinc-600">▸</span>
                <span>
                  <InlineContent text={item} must={must} nice={nice} />
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
