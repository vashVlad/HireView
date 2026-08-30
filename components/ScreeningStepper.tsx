"use client";

import { useState } from "react";
import type { ScreeningStep } from "@/lib/reasonedSignalPills";

/**
 * ResultCard redesign, 2026-08-28 — the "screening progress" sequence
 * (Gate 1 -> Gate 2 -> Credibility -> Fraud check), replacing a single
 * static "Gate 1" pill. Vlad's ask: "Maybe we can have it shown as a
 * sequence, like step by step completion... Would it make sense?" —
 * deliberately no header label above this (Vlad: "remove Screening progress
 * ... so it's not as crowded") — the steps read on their own.
 */

const STATE_STYLES: Record<ScreeningStep["state"], { circle: string; connector: string; icon?: string }> = {
  done: { circle: "bg-emerald-500 text-white", connector: "bg-emerald-500", icon: "✓" },
  flagged: { circle: "border-2 border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400", connector: "bg-amber-500", icon: "!" },
  failed: { circle: "border-2 border-rose-400 bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400", connector: "bg-zinc-200 dark:bg-zinc-700", icon: "✕" },
  "not-run": { circle: "border-2 border-dashed border-zinc-300 bg-zinc-50 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-500", connector: "bg-zinc-200 dark:bg-zinc-700" },
};

export function ScreeningStepper({ steps }: { steps: ScreeningStep[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (steps.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <div className="flex items-center justify-center">
        {steps.map((step, i) => {
          const cfg = STATE_STYLES[step.state];
          const clickable = Boolean(step.reason);
          return (
            <div key={step.key} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setOpenKey(openKey === step.key ? null : step.key)}
                className="flex flex-col items-center gap-1 disabled:cursor-default"
              >
                <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold ${cfg.circle}`}>
                  {cfg.icon ?? "—"}
                </span>
                <span className="text-[9.5px] font-semibold text-zinc-500 dark:text-zinc-400">{step.label}</span>
              </button>
              {i < steps.length - 1 && <span className={`mb-4 h-0.5 w-[34px] ${cfg.connector}`} />}
            </div>
          );
        })}
      </div>
      {openKey && (
        <div className="w-full max-w-xs rounded-lg border-l-2 border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {steps.find((s) => s.key === openKey)?.reason}
        </div>
      )}
    </div>
  );
}
