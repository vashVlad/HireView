import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CredibilityAssessment, CredibilityRow } from "./types";

const CREDIBILITY_TOOL = {
  name: "submit_credibility_assessment",
  description: "Submit the structured credibility assessment comparing resume against a cross-reference document.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        description:
          "Row-by-row comparison of resume vs cross-reference document. Include one row per employment record (current role + each past role) plus one row for education if verifiable. Also include one row for each cross-reference entry that has NO resume counterpart at all (see 'Undisclosed employment' guidance below) — those are real rows too, not something to skip. Aim for 5-10 rows total.",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              description: "What is being compared: e.g. 'Current title', 'Google — Software Engineer (2019–2022)', 'Education: MIT BS Computer Science'. For an undisclosed-employment row (present in cross-reference, absent from resume), prefix with 'Undisclosed: ', e.g. 'Undisclosed: SecureTheCloud'.",
            },
            resume: {
              type: "string",
              description: "Exact value from the resume (title, dates, company name, etc.), or 'Not listed as employment' for an undisclosed-employment row where the resume only mentions it elsewhere (e.g. a portfolio/projects section) or not at all.",
            },
            crossRef: {
              type: "string",
              description: "Exact value from the cross-reference document, or 'Not shown' if absent.",
            },
            reasoning: {
              type: "string",
              description: "Fill this in BEFORE deciding status — work out your answer here first, then status/severity below must match what you conclude here. One short sentence. For education rows: show the actual subtraction, e.g. 'resumeYear 2024 minus endYear 2023 = 1, in {-1,0,1}, so match.' For other rows: state the key fact driving the comparison. This field exists specifically so the arithmetic/reasoning happens before the status decision, not after — do not decide status first and rationalize here second.",
            },
            status: {
              type: "string",
              enum: ["match", "discrepancy", "cannot_verify"],
              description: "match = consistent (including explainable formatting/context differences — see the tolerance rules below); discrepancy = a difference worth surfacing to the recruiter, tagged material or minor via severity; cannot_verify = cross-reference doesn't have enough info to confirm. EDUCATION RULE — INTEGER YEAR MATH ONLY, do not estimate months (apply literally, treat 'Expected YYYY' the same as a confirmed graduation year — 'Expected' does NOT make it inherently uncertain or discrepant): the resume gives a bare YEAR (no month) for education — extract just that integer, e.g. 'MS Computer Science, 2024' → 2024, 'Expected 2029' → 2029. The cross-reference gives a start year and an end year (drop any month — 'January 2021 – November 2023' → startYear 2021, endYear 2023). Compute resumeYear minus startYear, and resumeYear minus endYear — two plain integer subtractions. This is status: match — full stop, never a discrepancy, never even minor — if EITHER result is in {-1, 0, 1}. Do NOT reason about months, quarters, or 'how many months apart' — a bare year has no month, so month-level reasoning about it is a category error, not a subtler analysis; the two-subtraction check above is the entire rule. Worked examples (compute it, don't estimate): 'Expected 2029' vs range 'January 2026 – December 2029' → resumeYear=2029, endYear=2029 → 2029−2029=0 → match. '2024' vs range ending 'November 2023' → resumeYear=2024, endYear=2023 → 2024−2023=1 → match (regardless of the fact that November is late in 2023 — the year subtraction is 1, that's the entire check). '2025' vs the same range → 2025−2023=2 → NOT in {-1,0,1} → discrepancy. Only status: discrepancy when BOTH subtractions fall outside {-1, 0, 1}, or the degree/field doesn't appear on the other document at all — see severity rule for how to grade that.",
            },
            severity: {
              type: "string",
              enum: ["material", "minor"],
              description:
                "Required when status is 'discrepancy'. Omit for match/cannot_verify.\n" +
                "material = a real, hard-to-explain mismatch worth a direct follow-up question: a genuinely different employer with no plausible shared-entity or staffing relationship, a role-level change (e.g. individual contributor vs manager) not explained by a title-phrasing difference, an unexplained gap or overlap beyond ~2 months for employment dates, an education year that is 3 or more calendar years outside the cross-reference's range by integer subtraction (see the minor bullet below for the exact-2-years case), a degree/field that doesn't appear at all on the other document, or undisclosed employment that OVERLAPS another already-listed role in time (concurrent, undisclosed full-time work — the real fraud-relevant pattern).\n" +
                "minor = explainable by common resume-vs-LinkedIn differences, not worth treating as a red flag on its own: (1) staffing/consulting pattern — same title and overlapping dates but the company name differs because one document lists the client site and the other lists the staffing/consulting agency of record (very common in IT consulting/staffing, which is this recruiter's own industry); (2) company name variants — a legal-entity suffix, parent/subsidiary naming, or a short form vs a fuller name for what is plausibly the same organization (e.g. 'GCB' vs 'GCB Services'), even without a known rebrand; (3) title phrasing — LinkedIn commonly shows a simplified, self-styled, or differently-leveled-sounding title for the SAME role (same company, overlapping dates) as the resume's more specific internal title, as long as the seniority/function isn't genuinely contradicted; (4) date rounding — LinkedIn only stores month/year, so end-date differences of about 2 months or less are formatting noise, not a real gap; (5) education year gaps of 2 calendar years outside the cross-reference's range (i.e. |resumeYear − startYear| = 2 or |resumeYear − endYear| = 2, whichever is smaller), for the same school/degree/field — genuinely a bit off, worth a passing note, but not fraud-relevant on its own. (Reminder: per the status field's rule, a year within the range, at an endpoint, OR exactly 1 year before/after either endpoint's year is status: match — NOT a discrepancy row at all, computed by plain integer subtraction, no month estimation. This minor-severity path only applies at exactly 2 years outside; 3+ years outside is material, see below.); (6) undisclosed employment that does NOT overlap any other listed role — an older job that simply predates or postdates the resume's listed history cleanly is completely normal resume trimming (most people don't list every job from 15+ years ago), not concealment — mark these minor, reserving material specifically for undisclosed roles that overlap a period the resume already accounts for; (7) an undisclosed-employment row where the resume already surfaces the same activity in a non-employment section (portfolio, projects, freelance work mentioned in passing) — real to flag, but not a hard red flag.",
            },
            note: {
              type: "string",
              description: "Required for discrepancy rows only: one short sentence (max 20 words) stating the factual difference. E.g. 'Resume says Peloton Therapeutics; cross-reference shows Merck.' Skip for match and cannot_verify.",
            },
          },
          required: ["field", "resume", "crossRef", "reasoning", "status"],
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
        description: "Only include if the cross-reference document is a second version of the resume. Max 2 sentences: what specifically changed and whether it looks like honest tailoring or manipulation.",
      },
      overallSignal: {
        type: "string",
        enum: ["clean", "minor_concerns", "significant_concerns"],
        description: "Derive this from the rows, don't judge independently: significant_concerns if at least one row has severity 'material'; minor_concerns if there are discrepancy rows but all are severity 'minor'; clean if there are no discrepancy rows at all.",
      },
    },
    required: ["rows", "trajectoryNote", "industryNote", "overallSignal"],
  },
};

/**
 * Deterministic, not model-decided — keeps the score deduction consistent
 * and auditable across runs of the same underlying facts, rather than
 * trusting the model to invent a point value. Only "material" discrepancies
 * count; "minor" ones (staffing-agency naming, title phrasing, date
 * rounding, etc.) are informational only and never touch the score. Capped
 * at -25 so a credibility check can dock a strong fit score but never
 * invert it. See lib/types.ts's CredibilityAssessment.scoreDelta.
 */
export function computeCredibilityScoreDelta(rows: CredibilityRow[]): number {
  const materialCount = rows.filter((r) => r.status === "discrepancy" && r.severity === "material").length;
  if (materialCount === 0) return 0;
  return -Math.min(25, materialCount * 8);
}

export async function assessCredibility(params: {
  resumeText: string;
  crossRefText?: string;
  roleContext?: string;
}): Promise<CredibilityAssessment> {
  const { resumeText, crossRefText, roleContext } = params;

  const roleNote = roleContext
    ? `The recruiter is screening for: ${roleContext}. Use this to contextualize whether the candidate's industry background is relevant.`
    : "";

  const hasCrossRef = Boolean(crossRefText);

  const comparisonInstruction = hasCrossRef
    ? "Compare the resume against the cross-reference document line by line. The cross-reference may be a LinkedIn profile PDF, a second resume version, or any other verification document."
    : "No cross-reference document was provided — set rows to an empty array. Analyze the resume on its own for trajectory and industry signals.";

  const crossRefSection = hasCrossRef
    ? `\n\nCROSS-REFERENCE DOCUMENT:\n${crossRefText}`
    : "";

  const userContent = `You are a recruiting assistant performing a credibility check on a candidate. This recruiter works in IT staffing/consulting, so staffing-agency-vs-client-site naming patterns are common and expected — do not treat them as suspicious on their own.

${roleNote}

${comparisonInstruction}

Your job:
1. ${hasCrossRef ? "Flag every cross-reference field as match, discrepancy (tagged severity: material or minor), or cannot_verify, using the tolerance rules in the tool schema. Be precise about severity — over-flagging stylistic differences as full discrepancies erodes trust in this tool as much as missing a real one does." : "Skip cross-reference comparison — leave rows empty."}
2. ${hasCrossRef ? "Also check the reverse direction: does the cross-reference document show any employment that the resume doesn't present as employment at all? Add a row for each — see the 'Undisclosed employment' field-naming convention in the tool schema. Default these to minor severity: most resumes only list recent/relevant roles and simply omit older jobs, which is completely normal, not concealment. Only mark one material if it plausibly OVERLAPS in time with a role the resume DOES list (undisclosed concurrent employment — the actual fraud-relevant pattern) or if the resume already mentions the same activity elsewhere in a way that contradicts the cross-reference. If the resume mentions the same activity in a non-employment section (portfolio, side projects), say so in the note and keep it minor." : ""}
3. ${hasCrossRef ? "For education rows specifically, do plain integer-year subtraction — do NOT estimate months, this is a category error since the resume side has no month. Extract resumeYear (the resume's bare year, e.g. 'Expected 2029' → 2029, treated exactly like a confirmed year) and the cross-reference's startYear/endYear (drop any month, e.g. 'January 2021 – November 2023' → 2021 and 2023). Compute resumeYear − startYear and resumeYear − endYear. If EITHER value is in {-1, 0, 1} — status: match, never a discrepancy, never even minor, full stop. Worked examples, compute don't estimate: 'Expected 2029' vs 'January 2026 – December 2029' → 2029−2029=0 → match. '2024' vs a range ending 'November 2023' → 2024−2023=1 → match (the November doesn't change the year-subtraction result — do not reason about 'how many months' this represents). Only mark a discrepancy when BOTH subtractions land outside {-1, 0, 1}: exactly ±2 years is minor, ±3 or more is material." : ""}
4. Note what sectors the candidate has actually worked in and whether that's relevant.
5. Read the career trajectory for consistency and signs of inflation.
6. If the cross-reference document appears to be a second resume version, include resumeDelta describing what changed and whether it looks like honest tailoring or suspicious rearrangement. Otherwise omit resumeDelta.

Be precise and brief. trajectoryNote and industryNote must be one sentence each — no exceptions. Do not write paragraphs.

RESUME:
${resumeText}${crossRefSection}`;

  // Prompt caching, 2026-07-15 (perf pass) — CREDIBILITY_TOOL is a large,
  // fully static schema (same tolerance rules/examples on every call
  // regardless of candidate). scoreCandidate.ts already caches its
  // equivalent static blocks; this endpoint was missing the same treatment.
  // Doesn't speed up a lone check, but a recruiter cross-referencing several
  // candidates back-to-back for the same role — the normal usage pattern —
  // gets the schema served from cache instead of reprocessed each time.
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    tools: [{ ...CREDIBILITY_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_credibility_assessment" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a credibility assessment");
  }

  const assessment = toolUse.input as CredibilityAssessment;
  assessment.scoreDelta = computeCredibilityScoreDelta(assessment.rows ?? []);
  return assessment;
}
