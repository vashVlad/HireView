"use client";

import { useState } from "react";
import type { AttributePill } from "@/lib/reasonedSignalPills";

/**
 * ResultCard redesign, 2026-08-28 — reasoned attribute pills (domain fit,
 * target company match), replacing the old bare "Must-have 9 / Nice-to-have
 * 6" badges and the standalone target-company chip. Same visual language as
 * the duplicate/history-alert badges elsewhere on this card (rounded-full,
 * text-[10px] uppercase) rather than a new style.
 */

const TONE_CLASSES: Record<AttributePill["tone"], string> = {
  positive: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  negative: "bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-300",
};

export function AttributePills({ pills }: { pills: AttributePill[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (pills.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {pills.map((pill, i) => (
          <span
            key={i}
            onClick={() => pill.reason && setOpenIndex(openIndex === i ? null : i)}
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE_CLASSES[pill.tone]} ${pill.reason ? "cursor-pointer" : ""}`}
          >
            {pill.label}
          </span>
        ))}
      </div>
      {openIndex !== null && pills[openIndex]?.reason && (
        <div className="w-full max-w-xs rounded-lg border-l-2 border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {pills[openIndex].reason}
        </div>
      )}
    </div>
  );
}
