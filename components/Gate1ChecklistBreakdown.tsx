import type { ChecklistEvaluation } from "@/lib/types";

/**
 * Gate 1 checklist matched/unmatched breakdown — extracted 2026-08-20 from
 * components/ResultCard.tsx (where it was originally built 2026-08-19, RE-
 * ADDED narrowly for gate-1-only candidates: "no AI summary/strengths/
 * concerns/trajectory ever got generated, so hiding it here too would leave
 * the card looking broken/empty rather than intentionally simplified").
 *
 * Real bug found 2026-08-20 (Claude Code's full-system audit, Vlad's ask):
 * this block only ever existed inside ResultCard.tsx, which is NOT what the
 * Pipeline tab renders — that tab has its own separate card markup
 * (app/projects/[id]/page.tsx's PipelineTab). Every Gate-1-archived
 * candidate viewed there — the default way anyone browses archived
 * candidates — showed a blank Career story/Assessment/Strengths section
 * with nothing to explain why, since those fields are genuinely empty for a
 * gate-1-only result (lib/buildGate1ArchivedResult.ts). Fixing this by
 * copy-pasting the JSX into PipelineTab would have immediately recreated
 * the exact "drifted card implementations" problem the same audit flagged
 * about ResultCard.tsx's own size — extracted into this shared component
 * instead, imported by both.
 */
export function Gate1ChecklistBreakdown({ checklistEvaluation }: { checklistEvaluation: ChecklistEvaluation }) {
  const items = checklistEvaluation.results;
  const tierRank = (t?: "must-have" | "nice-to-have") => (t === "must-have" ? 0 : 1);
  const matched = [...items].filter((r) => r.fired).sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
  const unmatched = [...items].filter((r) => !r.fired).sort((a, b) => tierRank(a.tier) - tierRank(b.tier));

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/40">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        Gate 1 only — checklist result
      </p>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Archived by the checklist gate before a full screen ran — no AI summary or career read exists for this candidate yet.
      </p>
      <div className="flex flex-col gap-3">
        {matched.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Matched ({matched.length})
            </p>
            <ul className="flex flex-col gap-1">
              {matched.map((r) => (
                <li key={r.itemId} className="text-xs text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">{r.label}</span>
                  {r.tier === "must-have" && (
                    <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                      must-have
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {unmatched.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
              Not matched ({unmatched.length})
            </p>
            <ul className="flex flex-col gap-1">
              {unmatched.map((r) => (
                <li key={r.itemId} className="text-xs text-zinc-500 dark:text-zinc-500">
                  <span>{r.label}</span>
                  {r.tier === "must-have" && (
                    <span className="ml-1.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
                      must-have
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
