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
 * Display order: oldest role first → newest role last (chronological).
 * The raw trajectory string is newest-first (resume order); role groups
 * are reversed at render time so the career story reads as a progression.
 */

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

function InlineContent({ text }: { text: string }) {
  const segments = parseInline(text);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "bold" ? <strong key={i}>{s.value}</strong> : <span key={i}>{s.value}</span>
      )}
    </>
  );
}

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
 * Role groups are returned reversed (oldest first).
 */
function buildRenderOrder(blocks: Block[]): Block[] {
  // Anything before the first header is a preamble
  const firstHeaderIdx = blocks.findIndex((b) => b.kind === "header");
  if (firstHeaderIdx === -1) return blocks; // no headers — render as-is

  const preamble = blocks.slice(0, firstHeaderIdx);

  // Split from firstHeader onward into role groups + trailing summary
  const rest = blocks.slice(firstHeaderIdx);
  const groups: Block[][] = [];
  let current: Block[] = [];
  let trailingSummary: Block | null = null;

  for (const block of rest) {
    if (block.kind === "header") {
      if (current.length > 0) groups.push(current);
      current = [block];
    } else if (block.kind === "paragraph" && current.length > 0) {
      // A paragraph after role content is the summary — stop grouping
      groups.push(current);
      current = [];
      trailingSummary = block;
      break;
    } else {
      current.push(block);
    }
  }
  if (current.length > 0) groups.push(current);

  // Reverse so oldest role renders first
  groups.reverse();

  const ordered: Block[] = [
    ...preamble,
    ...groups.flat(),
    ...(trailingSummary ? [trailingSummary] : []),
  ];
  return ordered;
}

export function TrajectoryRenderer({ text, className }: { text: string; className?: string }) {
  const raw = parseBlocks(text);
  const blocks = buildRenderOrder(raw);

  // The trailing summary is the last paragraph if it follows bullets
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
              {block.text}
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
                <InlineContent text={block.lines.join(" ")} />
              </p>
            );
          }
          return (
            <p key={i} className={`leading-relaxed text-zinc-600 dark:text-zinc-300 ${i > 0 ? "mt-3" : ""}`}>
              <InlineContent text={block.lines.join(" ")} />
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
                  <InlineContent text={item} />
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
