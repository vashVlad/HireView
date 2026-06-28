import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CredibilityAssessment } from "./types";

const CREDIBILITY_TOOL = {
  name: "submit_credibility_assessment",
  description: "Submit the structured credibility assessment comparing resume against LinkedIn and optionally a second resume.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        description: "Row-by-row comparison of resume vs LinkedIn. Include one row per employment record (current role + each past role) plus one row for education if verifiable. Aim for 5-10 rows total.",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              description: "What is being compared: e.g. 'Current title', 'Google — Software Engineer (2019–2022)', 'Education: MIT BS Computer Science'.",
            },
            resume: {
              type: "string",
              description: "Exact value from the resume (title, dates, company name, etc.).",
            },
            linkedIn: {
              type: "string",
              description: "Exact value from LinkedIn, or 'Not shown on LinkedIn' if absent.",
            },
            status: {
              type: "string",
              enum: ["match", "discrepancy", "cannot_verify"],
              description: "match = consistent; discrepancy = materially different; cannot_verify = LinkedIn doesn't have enough info to confirm.",
            },
            note: {
              type: "string",
              description: "Required for discrepancy rows only: one short sentence (max 20 words) stating the factual difference. E.g. 'Resume says Peloton Therapeutics; LinkedIn shows Merck.' Skip for match and cannot_verify.",
            },
          },
          required: ["field", "resume", "linkedIn", "status"],
        },
      },
      trajectoryNote: {
        type: "string",
        description: "One sentence only. State the single most notable fact about the trajectory — logical progression or biggest red flag. No filler, no elaboration.",
      },
      industryNote: {
        type: "string",
        description: "One sentence only. Name the sectors. Do not explain relevance beyond a single clause.",
      },
      resumeDelta: {
        type: "string",
        description: "Only include if a second resume was provided. Max 2 sentences: what specifically changed and whether it looks like honest tailoring or manipulation.",
      },
      overallSignal: {
        type: "string",
        enum: ["clean", "minor_concerns", "significant_concerns"],
        description: "clean = no material discrepancies; minor_concerns = small inconsistencies worth noting but not disqualifying; significant_concerns = material discrepancies that warrant direct follow-up.",
      },
    },
    required: ["rows", "trajectoryNote", "industryNote", "overallSignal"],
  },
};

export async function assessCredibility(params: {
  resumeText: string;
  linkedInText?: string;
  secondResumeText?: string;
  roleContext?: string;
}): Promise<CredibilityAssessment> {
  const { resumeText, linkedInText, secondResumeText, roleContext } = params;

  const roleNote = roleContext
    ? `The recruiter is screening for: ${roleContext}. Use this to contextualize whether the candidate's industry background is relevant.`
    : "";

  const hasLinkedIn = Boolean(linkedInText);
  const hasSecondResume = Boolean(secondResumeText);

  // Build instructions based on what was provided
  const comparisonInstruction = hasLinkedIn && hasSecondResume
    ? "Compare the resume against the LinkedIn profile line by line AND compare the two resume versions."
    : hasLinkedIn
    ? "Compare the resume against the LinkedIn profile line by line. No second resume was provided — do not include resumeDelta."
    : "No LinkedIn profile was provided — set rows to an empty array. Only compare the two resume versions and include resumeDelta.";

  const secondResumeSection = hasSecondResume
    ? `\n\nSECOND RESUME:\n${secondResumeText}`
    : "";

  const linkedInSection = hasLinkedIn
    ? `\n\nLINKEDIN PROFILE:\n${linkedInText}`
    : "";

  const userContent = `You are a recruiting assistant performing a credibility check on a candidate.

${roleNote}

${comparisonInstruction}

Your job:
1. ${hasLinkedIn ? "Flag every LinkedIn field as match, discrepancy, or cannot_verify. Notes: one sentence max, state the fact." : "Skip LinkedIn comparison — leave rows empty."}
2. Note what sectors the candidate has actually worked in and whether that's relevant.
3. Read the career trajectory for consistency and signs of inflation.${hasSecondResume ? "\n4. Compare the two resume versions — include resumeDelta describing what changed and whether it looks like honest tailoring or suspicious rearrangement." : ""}

Be precise and brief. trajectoryNote and industryNote must be one sentence each — no exceptions. Do not write paragraphs.

RESUME:
${resumeText}${linkedInSection}${secondResumeSection}`;

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    tools: [CREDIBILITY_TOOL],
    tool_choice: { type: "tool", name: "submit_credibility_assessment" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a credibility assessment");
  }

  return toolUse.input as CredibilityAssessment;
}
