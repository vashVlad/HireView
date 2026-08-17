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

const CHECKLIST_TOOL = {
  name: "submit_checklist",
  description: "Submit a precise, individually-reasoned checklist derived from this job description.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        description:
          "5-12 specific, checkable items total. Each must be concrete enough that a recruiter could look at one resume and say yes/no — never vague ('strong communicator'), always specific ('Led a cross-functional team of 5+'). Do NOT include a target-company-match item — that's already handled by a separate, existing mechanism; adding one here would double-count the same signal.",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["decrease", "add"],
              description: "'decrease' = a specific gap or red flag worth deducting points for if genuinely unevidenced (e.g. a stated must-have with no supporting evidence). 'add' = a specific reinforcing signal worth bonus points if genuinely evidenced (e.g. a nice-to-have, or a strong specific indicator of seniority/impact).",
            },
            label: {
              type: "string",
              description: "Short, specific, checkable in one read. 4-10 words. E.g. 'AWS Solutions Architect certification' or 'Owned a production on-call rotation'.",
            },
            points: {
              type: "number",
              description: "Magnitude only, always positive (category above determines the sign when applied) — 3 to 15. Must-have-derived 'decrease' items should generally sit higher (8-15) than 'add' items (3-8), since a missing requirement matters more than a bonus signal.",
            },
          },
          required: ["category", "label", "points"],
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

MUST-HAVE SKILLS (source list, sharpen these into specific decrease-category checks):
${params.mustHaveSkills.join(", ") || "(none extracted)"}

NICE-TO-HAVE SKILLS (source list, sharpen these into specific add-category checks):
${params.niceToHaveSkills.join(", ") || "(none extracted)"}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a checklist");
  }

  const input = toolUse.input as { items: { category: "decrease" | "add"; label: string; points: number }[] };
  const items: ChecklistItem[] = (input.items ?? []).map((item) => ({
    id: randomUUID(),
    category: item.category,
    label: item.label,
    points: Math.max(1, Math.round(item.points)),
  }));

  return { items, generatedAt: new Date().toISOString() };
}
