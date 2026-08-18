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
                "For a 'decrease' item: true means the gap IS present (no real evidence the requirement is met) — true is the bad outcome. For an 'add' item: true means the resume DOES show real evidence of the positive signal — true is the good outcome. When genuinely unclear or unstated, prefer false (under-flagging is the safe direction, same principle used elsewhere in this app for credibility discrepancies).",
            },
            reasoning: {
              type: "string",
              description: "One short sentence, max 20 words: the specific evidence (or lack of it) driving this decision. Not a restatement of the item's label.",
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
  const itemsList = params.checklist.items
    .map((item) => `- id="${item.id}" [${item.category}]: ${item.label}`)
    .join("\n");

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    tools: [EVALUATE_TOOL],
    tool_choice: { type: "tool", name: "submit_checklist_evaluation" },
    messages: [
      {
        role: "user",
        content: `Evaluate this resume against every item on the checklist below. Return one result per item, using the EXACT id given.

CHECKLIST:
${itemsList}

RESUME:
${params.resumeText.slice(0, 8000)}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a checklist evaluation");
  }

  const input = toolUse.input as { results: { itemId: string; fired: boolean; reasoning: string }[] };
  const itemById = new Map(params.checklist.items.map((item) => [item.id, item]));

  // Denormalize label/category/points onto each result at evaluation time —
  // see ChecklistItemResult's own comment (lib/types.ts) for why: so a later
  // edit/delete of the checklist item never changes what an already-saved
  // evaluation displays. Also doubles as the validity filter that used to be
  // a separate `validIds.has(...)` check — a result referencing an unknown
  // itemId has nothing to denormalize from and is dropped here.
  const results: ChecklistItemResult[] = (input.results ?? [])
    .map((r) => {
      const item = itemById.get(r.itemId);
      if (!item) return null;
      return { itemId: r.itemId, fired: r.fired, reasoning: r.reasoning, label: item.label, category: item.category, points: item.points };
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
 * by whoever generated or edited the checklist, never invented here — now
 * read straight off each result's own denormalized `points`/`category`
 * (see ChecklistItemResult's comment), no checklist/item lookup needed.
 * 'decrease' items that fire subtract their points; 'add' items that fire
 * add their points. No cap here — screen-resumes/route.ts clamps the final
 * candidate score to [0, 100] the same way it already does for the
 * must-have/nice-to-have score and the target-company boost.
 */
export function computeChecklistScoreDelta(results: ChecklistItemResult[]): number {
  let delta = 0;
  for (const result of results) {
    if (!result.fired) continue;
    delta += result.category === "decrease" ? -result.points : result.points;
  }
  return delta;
}
