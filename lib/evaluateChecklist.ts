import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { ChecklistEvaluation, ChecklistItemResult, ProjectChecklist } from "./types";

/**
 * JD Checklist evaluation, 2026-08-15 (Vlad's ask) — runs a candidate's
 * resume against an EXISTING project checklist (see lib/generateChecklist.ts
 * for how the checklist itself gets built). Deliberately its own call, not
 * folded into scoreCandidate.ts (do-not-touch) — same reasoning
 * lib/targetCompanyBoost.ts already established: a deterministic, auditable
 * point adjustment applied on top of the model's score, not mixed into the
 * model's own scoring judgment. The one difference from targetCompanyBoost:
 * whether a checklist item is satisfied genuinely needs reading
 * comprehension (unlike a plain company-name substring match), so this one
 * piece does need a real Claude call — but only ONE per candidate, run in
 * parallel with scoreCandidate()/generateFingerprint(), not sequentially
 * after them (see app/api/screen-resumes/route.ts's Promise.all).
 */

const EVALUATE_TOOL = {
  name: "submit_checklist_evaluation",
  description: "For each checklist item, decide whether the resume provides real evidence it fires.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemId: { type: "string", description: "Must exactly match one of the item ids given in the checklist below." },
            fired: {
              type: "boolean",
              description:
                "True means the resume shows real, specific evidence of this signal — true is always the GOOD outcome, every item on this checklist only ever adds points when it fires (see computeChecklistScoreDelta — 2026-08-17, roadmap simplification: this checklist no longer has any gap/absence-penalty items, every item is a positive signal check). Lean toward true on a genuinely plausible, reasonable read of the resume — 2026-08-19, Phase 2.6: this checklist now decides, on its own, whether a candidate is ever seen by a recruiter at all (Gate 1, before any deeper review), not just an informational number shown alongside a full read. A false negative here can silently end a real candidate's chances; a false positive only costs one extra deeper review. Only mark false when the resume genuinely gives no reasonable basis for the claim — not merely because it isn't spelled out in the exact wording of the checklist item.",
            },
            reasoning: {
              type: "string",
              description: "One short sentence, max 20 words: the specific evidence (or lack of it) driving this decision. Not a restatement of the item's label.",
            },
            evidenceSource: {
              type: "string",
              description:
                "Only when fired=true: the specific employer or project name (as written on the resume, e.g. 'Optum', 'DataGuard AI') where the firing evidence actually appears. Empty string if the evidence is general (a skills list, summary line) and isn't tied to one specific role or project, or if fired=false.",
            },
          },
          required: ["itemId", "fired", "reasoning"],
        },
      },
    },
    required: ["results"],
  },
};

export async function evaluateChecklist(params: {
  resumeText: string;
  checklist: ProjectChecklist;
}): Promise<ChecklistEvaluation> {
  // No longer tags each item with [decrease]/[add] — as of 2026-08-17 every
  // item is evaluated with the same uniform "did the resume show evidence"
  // question (see EVALUATE_TOOL's fired description above), so the category
  // label has nothing left to tell the model.
  const itemsList = params.checklist.items
    .map((item) => `- id="${item.id}": ${item.label}`)
    .join("\n");

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    tools: [EVALUATE_TOOL],
    tool_choice: { type: "tool", name: "submit_checklist_evaluation" },
    messages: [
      {
        role: "user",
        content: `Evaluate this resume against every item on the checklist below. Return one result per item, using the EXACT id given. When an item fires, also name the specific employer or project the evidence came from (evidenceSource) — copy the name exactly as it appears on the resume, so it can be matched back to that role later.

CHECKLIST:
${itemsList}

RESUME:
${params.resumeText}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a checklist evaluation");
  }

  // Defensive guard, same pattern as assessCredibility.ts's 2026-08-04 fix —
  // a truncated tool call (response cut off mid-JSON because max_tokens was
  // too low for the number of items) makes the SDK silently hand back `{}`
  // rather than throwing, which downstream code would treat as a valid
  // empty evaluation. Fail loudly instead of scoring every item as
  // not-fired with zero indication anything went wrong.
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Checklist evaluation was cut off before completing — this can happen with a long resume or a checklist with many items. Try again."
    );
  }

  const input = toolUse.input as { results: { itemId: string; fired: boolean; reasoning: string; evidenceSource?: string }[] };
  const itemById = new Map(params.checklist.items.map((item) => [item.id, item]));

  // Denormalize label/category/points onto each result at evaluation time —
  // see ChecklistItemResult's own comment (lib/types.ts) for why: so a later
  // edit/delete of the checklist item never changes what an already-saved
  // evaluation displays. Also doubles as the validity filter that used to be
  // a separate `validIds.has(...)` check — a result referencing an unknown
  // itemId has nothing to denormalize from and is dropped here.
  const results: ChecklistItemResult[] = (input.results ?? [])
    .map((r): ChecklistItemResult | null => {
      const item = itemById.get(r.itemId);
      if (!item) return null;
      const evidenceSource = r.evidenceSource?.trim() || undefined;
      return {
        itemId: r.itemId,
        fired: r.fired,
        reasoning: r.reasoning,
        label: item.label,
        category: item.category,
        tier: item.tier,
        points: item.points,
        ...(evidenceSource ? { evidenceSource } : {}),
      };
    })
    .filter((r): r is ChecklistItemResult => r !== null);

  return {
    results,
    scoreDelta: computeChecklistScoreDelta(results),
  };
}

/**
 * Deterministic, not model-decided — same principle as
 * computeTargetCompanyBoost/computeCredibilityScoreDelta elsewhere in this
 * app. The model only decides WHETHER an item fired (see EVALUATE_TOOL's
 * `fired`); the point VALUE always comes from the checklist item itself, set
 * by whoever generated or edited the checklist, never invented here.
 *
 * ALWAYS adds points on fire, regardless of `result.category` — 2026-08-17,
 * Vlad's direct feedback on the Filters tab UI: showing plainly positive-
 * sounding checks ("Python used in AI or software project") under a
 * "Decrease score" tab was genuinely confusing, and the underlying
 * "fired=true means the gap IS present" inverted logic for decrease items
 * doesn't match how any of these labels actually read. Decided fix: the
 * checklist only ever builds score UP now — real deductions still exist,
 * they just live entirely in the credibility/cross-reference check
 * (lib/assessCredibility.ts's computeCredibilityScoreDelta), which is a
 * fundamentally different, evidence-of-a-problem mechanism, not a
 * missing-requirement penalty.
 *
 * Deliberately ignores `category` here rather than requiring a data
 * migration: any already-generated project checklist that still has
 * "decrease"-category items (from before this change, not yet regenerated)
 * now scores those items exactly the same as an "add" item the moment they
 * fire — no live project can produce a negative checklist delta going
 * forward, without needing to touch a single stored row. `generateChecklist.ts`
 * no longer emits "decrease" items at all; `category` on ChecklistItem/
 * ChecklistItemResult is kept in the type purely for backward-compatible
 * display of already-frozen historical evaluations (see ResultCard.tsx's
 * checklist breakdown, which intentionally still renders old decrease-
 * category fired results as negative — that's accurate history, not
 * something this function should retroactively rewrite).
 *
 * No cap here — screen-resumes/route.ts clamps the final candidate score to
 * [0, 100] the same way it already does for the must-have/nice-to-have
 * score and the target-company boost.
 */
export function computeChecklistScoreDelta(results: ChecklistItemResult[]): number {
  let delta = 0;
  for (const result of results) {
    if (!result.fired) continue;
    delta += result.points;
  }
  return delta;
}

/**
 * Checklist-only scoring, 2026-08-17 (Vlad's explicit ask: "I though that I
 * want to have only the checklist" — see decisions-log.md's matching entry).
 * When a project has a checklist, a candidate's SCORE is this function's
 * output, not scoreCandidate.ts's own 0-100 judgment — the AI's summary/
 * strengths/concerns/careerTrajectory still get generated and shown for
 * context (Vlad's explicit choice, asked directly), they just no longer
 * drive the number.
 *
 * Percentage of total possible points, not a raw sum — a candidate who fires
 * every item on a 5-item checklist and one who fires every item on a
 * 12-item checklist should both land near 100, not have the longer
 * checklist be structurally harder to max out. Rounded to the nearest
 * integer, same convention as every other score in this app.
 *
 * Returns null (not 0) when the checklist has zero total possible points
 * (an empty checklist, or one where every item somehow has 0 points) —
 * there's genuinely nothing to compute a percentage FROM in that case, and
 * the caller (lib/screenings.ts's saveScreening) falls back to the AI's own
 * score rather than showing a nonsensical 0 for every candidate.
 */
export function computeChecklistPercentageScore(results: ChecklistItemResult[]): number | null {
  const totalPossiblePoints = results.reduce((sum, r) => sum + r.points, 0);
  if (totalPossiblePoints <= 0) return null;
  const firedPoints = results.filter((r) => r.fired).reduce((sum, r) => sum + r.points, 0);
  return Math.round((firedPoints / totalPossiblePoints) * 100);
}
