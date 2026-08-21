import { randomUUID } from "crypto";
import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { ChecklistItem, ProjectChecklist } from "./types";

/**
 * JD Checklist ("Trust badge") generation, 2026-08-15 (Vlad's ask) — see
 * lib/types.ts's ProjectChecklist/ChecklistItem for the full design
 * rationale. Deliberately a NEW, separate file rather than an edit to
 * analyzeJD.ts (do-not-touch) — takes that function's already-generated
 * output as input, same pattern lib/generateRoleFit.ts already established
 * for this codebase. Runs once per JD analysis/re-analysis, recruiter-
 * triggered, never automatic/background — this is a per-PROJECT action, not
 * a per-candidate one (contrast lib/evaluateChecklist.ts, which runs once
 * per resume at screening time).
 */

// Single-list, additive-only, 2026-08-17 (Vlad's direct feedback on the
// Filters tab UI — see lib/evaluateChecklist.ts's computeChecklistScoreDelta
// comment for the full reasoning). Used to generate two categories,
// "decrease" (gap/absence penalties, phrased as negations like "No
// container orchestration experience") and "add" (positive signals) — that
// read as genuinely confusing in the UI (a plainly positive-sounding label
// sitting under a "Decrease score" tab) and doubled as an inverted-logic
// trap ("fired" meaning "the gap IS present" for decrease items). Every
// checklist item is now the same shape: a positive, checkable signal that
// only ever adds points when the resume shows real evidence of it. Real
// deductions still exist — they live entirely in the credibility/cross-
// reference check (lib/assessCredibility.ts), a fundamentally different
// "found an actual problem" mechanism, not a missing-requirement penalty.
const CHECKLIST_TOOL = {
  name: "submit_checklist",
  description: "Submit a precise, individually-reasoned checklist derived from this job description.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        description:
          "5-12 specific, checkable items total, drawn from both the must-have and nice-to-have lists. Each must be concrete enough that a recruiter could look at one resume and say yes/no — never vague ('strong communicator'), always specific ('Led a cross-functional team of 5+'). Every item is a POSITIVE, checkable signal — phrase each as evidence to look FOR, never as an absence or a negation (never 'No X experience' or 'Lacks Y') — a must-have-derived item should still read the same way, just phrased as what having it looks like ('AWS Solutions Architect certification', not 'Missing AWS certification'). Do NOT include a target-company-match item — that's already handled by a separate, existing mechanism; adding one here would double-count the same signal.",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Short, specific, checkable in one read, phrased as a positive signal to look for. 4-10 words. E.g. 'AWS Solutions Architect certification' or 'Owned a production on-call rotation'.",
            },
            tier: {
              type: "string",
              enum: ["must-have", "nice-to-have"],
              description: "Which source list this item was sharpened from. Drives both display order (must-haves shown first) and, as of 2026-08-19, whether this checklist can act as a real screening gate — so this must match points: a must-have item should virtually always score 8-15, a nice-to-have item 3-8.",
            },
            points: {
              type: "number",
              description: "3 to 15 — how much this signal should add to the score when evidenced. Items derived from a stated must-have should generally sit higher (8-15) than items derived from a nice-to-have (3-8), since a core requirement matters more than a bonus signal — but both are bonus points either way, never a deduction.",
            },
          },
          required: ["label", "tier", "points"],
        },
      },
    },
    required: ["items"],
  },
};

export async function generateChecklist(params: {
  jobDescription: string;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
}): Promise<ProjectChecklist> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    tools: [CHECKLIST_TOOL],
    tool_choice: { type: "tool", name: "submit_checklist" },
    messages: [
      {
        role: "user",
        content: `Build a precise, individually-checkable evaluation checklist for this role. Use the must-have/nice-to-have lists as a starting point, but make each item more specific and concrete than the source skill name alone — a checklist item should be something a recruiter can look at a resume and directly confirm or deny, not a restatement of a skill tag.

JOB DESCRIPTION:
${params.jobDescription.slice(0, 6000)}

MUST-HAVE SKILLS (source list, sharpen these into specific, positively-phrased checks worth more points):
${params.mustHaveSkills.join(", ") || "(none extracted)"}

NICE-TO-HAVE SKILLS (source list, sharpen these into specific, positively-phrased checks worth fewer points):
${params.niceToHaveSkills.join(", ") || "(none extracted)"}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a checklist");
  }

  const input = toolUse.input as { items: { label: string; tier: "must-have" | "nice-to-have"; points: number }[] };
  // category is always "add" now — kept on the type for backward-compat
  // display of already-frozen historical evaluations (see
  // computeChecklistScoreDelta's comment in lib/evaluateChecklist.ts), but
  // this generator never produces anything else going forward.
  const items: ChecklistItem[] = (input.items ?? []).map((item) => ({
    id: randomUUID(),
    category: "add",
    tier: item.tier,
    label: item.label,
    points: Math.max(1, Math.round(item.points)),
  }));

  return { items, generatedAt: new Date().toISOString() };
}
