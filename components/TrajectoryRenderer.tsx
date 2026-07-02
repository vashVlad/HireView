"use client";

/**
 * Renders a career trajectory string that uses lightweight markdown:
 *   **text**        → <strong>
 *   - item          → bullet list item
 *   blank line      → paragraph / list break
 *
 * No external dependencies — handles exactly the patterns Claude outputs.
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
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullets"; items: string[] };

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

export function TrajectoryRenderer({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);

  return (
    <div className={className}>
      {blocks.map((block, i) => {
        if (block.kind === "paragraph") {
          return (
            <p key={i} className="leading-relaxed text-zinc-600 dark:text-zinc-300 [&+*]:mt-3">
              <InlineContent text={block.lines.join(" ")} />
            </p>
          );
        }
        return (
          <ul key={i} className="mt-1 space-y-0.5 [&+*]:mt-3">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-1.5 leading-relaxed text-zinc-600 dark:text-zinc-300">
                <span className="shrink-0 text-zinc-400 dark:text-zinc-500">•</span>
                <span><InlineContent text={item} /></span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
