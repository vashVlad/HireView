"use client";

import { useRef, useState } from "react";

const ICON_STYLES = {
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
} as const;

const ROW_STYLES = {
  positive:
    "border-l-2 border-emerald-400 bg-emerald-50 dark:border-emerald-500/60 dark:bg-emerald-500/10",
  warning: "border-l-2 border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10",
} as const;

const HEADER_ACTIVE = {
  positive: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
} as const;

const COUNT_STYLES = {
  positive:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  warning:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
} as const;

function Icon({ variant }: { variant: keyof typeof ICON_STYLES }) {
  if (variant === "positive") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 9v4M12 16.5h.01" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M10.6 4.2 2.9 17.5a1.5 1.5 0 0 0 1.3 2.25h15.6a1.5 1.5 0 0 0 1.3-2.25L13.4 4.2a1.5 1.5 0 0 0-2.8 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConcernItem({ item, screeningId }: { item: string; screeningId?: number }) {
  const [detail, setDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function elaborate() {
    if (detail || loading || !screeningId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/elaborate-concern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screeningId, concern: item }),
      });
      const data = await res.json();
      setDetail(data.detail ?? null);
    } catch {
      setDetail("Could not load details — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 ${ROW_STYLES.warning}`}>
      <span className={`mt-0.5 shrink-0 ${ICON_STYLES.warning}`}>
        <Icon variant="warning" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span>{item}</span>
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{ gridTemplateRows: detail ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <p className="pt-1 text-xs leading-relaxed text-amber-800/80 dark:text-amber-300/70">
              {detail}
            </p>
          </div>
        </div>
        {screeningId && !detail && (
          <button
            type="button"
            onClick={elaborate}
            disabled={loading}
            className="self-start text-[11px] font-medium text-amber-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-amber-400"
          >
            {loading ? "Loading…" : "More"}
          </button>
        )}
      </div>
    </li>
  );
}

export function InsightList({
  label,
  items,
  variant,
  defaultOpen = true,
  screeningId,
}: {
  label: string;
  items: string[];
  variant: keyof typeof ICON_STYLES;
  defaultOpen?: boolean;
  screeningId?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);

  if (!Array.isArray(items) || items.length === 0) return null;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 py-1 text-left"
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wide transition-colors ${
            open ? HEADER_ACTIVE[variant] : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {label}
        </span>
        <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${COUNT_STYLES[variant]}`}>
          {items.length}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`ml-auto shrink-0 text-zinc-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        ref={bodyRef}
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <ul className="flex flex-col gap-2 pt-2">
            {items.map((item) =>
              variant === "warning" ? (
                <ConcernItem key={item} item={item} screeningId={screeningId} />
              ) : (
                <li
                  key={item}
                  className={`flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 ${ROW_STYLES[variant]}`}
                >
                  <span className={`mt-0.5 shrink-0 ${ICON_STYLES[variant]}`}>
                    <Icon variant={variant} />
                  </span>
                  <span>{item}</span>
                </li>
              )
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
