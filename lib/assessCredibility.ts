import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CredibilityAssessment, CredibilityRow } from "./types";

/**
 * Heuristic LinkedIn PDF detector — runs on extracted text before the
 * credibility call so the prompt can be tailored without a second Claude
 * round-trip.
 *
 * Real bug found 2026-07-20 (Vlad: cross-reference "got confused and took a
 * second resume as a LinkedIn profile"). This used to be a plain OR of three
 * signals — but a single one of them, "mentions a linkedin.com/in/ URL," is
 * true for the overwhelming majority of ordinary resumes too, since nearly
 * every modern resume lists the candidate's LinkedIn URL as a contact
 * detail in the header. That made this detector fire on any second-resume
 * cross-reference whose header happened to include a LinkedIn link — a
 * plain resume, not an actual LinkedIn PDF export — showing the LinkedIn
 * icon and the LinkedIn-signals activity panel for something that wasn't
 * one. Now requires at least 2 of the 3 signals together: the connections
 * count and the "Skills & Endorsements" heading are both wording specific
 * to LinkedIn's own PDF export format, so a genuine export reliably has
 * those alongside the profile URL — an ordinary resume with just a LinkedIn
 * link in its header only ever satisfies 1 of the 3 and no longer trips it.
 */
export function detectLinkedIn(text: string): boolean {
  const signals = [
    /linkedin\.com\/in\//i.test(text),
    /\d{1,4}\+?\s*connections?\b/i.test(text),
    /\bSkills\s*&\s*Endorsements\b/i.test(text),
  ];
  return signals.filter(Boolean).length >= 2;
}

const CREDIBILITY_TOOL = {
  name: "submit_credibility_assessment",
  description: "Submit the structured credibility assessment comparing resume against a cross-reference document.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        description:
          "Row-by-row comparison of resume vs cross-reference document. Include one row per employment record (current role + each past role) plus one row for education if verifiable. Also include one row for each cross-reference EMPLOYMENT entry that has NO resume counterpart at all (see 'Undisclosed employment' guidance below) — those are real rows too, not something to skip. This 'undisclosed' reverse-check is employment-only — do NOT apply it to education. Education gets exactly one row per degree: if the resume's education claim and the cross-reference's education record refer to the same underlying credential and don't match, that mismatch is ONE row, never two — do not also add a second 'undisclosed education' row for the same cross-reference degree entry just because it lacks its own exact resume counterpart; it's already covered by the mismatch row. Aim for 5-10 rows total.",
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
      resolvedConcerns: {
        type: "array",
        description:
          "Only populate when ORIGINAL SCREENING CONCERNS are listed in the prompt below (omit entirely, don't emit an empty array, if none were provided). For each original concern that this cross-reference document actually resolves with CONCRETE evidence, add one entry. Apply the same rigor as discrepancy detection: a concern only counts as resolved if the cross-reference gives specific, checkable information that directly addresses it — e.g. the concern was 'no clear evidence of team leadership' and the LinkedIn profile has multiple recommendations specifically praising the candidate's leadership on a named project, or the concern was 'unexplained 8-month gap' and the cross-reference shows a role that fills that exact gap. Do NOT mark a concern resolved just because the cross-reference doesn't contradict it, generally looks impressive, or is silent on the topic — silence is not resolution. When in doubt, leave it out; under-crediting is the safe direction here, the same way over-flagging a discrepancy as material would be the unsafe direction there.",
        items: {
          type: "object",
          properties: {
            concern: {
              type: "string",
              description: "The exact original concern text this resolves — copy verbatim from the list provided in the prompt, don't paraphrase.",
            },
            explanation: {
              type: "string",
              description: "One sentence, max 20 words: what specific evidence in the cross-reference resolves this concern.",
            },
          },
          required: ["concern", "explanation"],
        },
      },
      linkedInSignals: {
        type: "object" as const,
        description:
          "Populate ONLY when the cross-reference is a LinkedIn profile PDF (recognizable by 'linkedin.com/in/' URLs, connection counts, endorsement sections). Omit entirely for resume-vs-resume comparisons — do not emit null or empty objects. Phase 2.4.",
        properties: {
          activity: {
            type: "string" as const,
            enum: ["active", "moderate", "minimal"],
            description:
              "Profile activity verdict. active = 500+ connections OR 3+ recommendations OR (summary present AND recent cert/course within the last 12 months). minimal = under 100 connections AND 0 recommendations AND no summary. moderate = everything else.",
          },
          connectionCount: {
            type: "string" as const,
            description: "Connection count as shown in the PDF, e.g. '500+' or '47'. Omit if not visible.",
          },
          recommendationCount: {
            type: "number" as const,
            description: "Number of written recommendations received. 0 if the Recommendations section is absent or empty.",
          },
          hasSummary: {
            type: "boolean" as const,
            description: "True if the About/Summary section exists and has meaningful content (not empty or placeholder text).",
          },
          recentCertDate: {
            type: "string" as const,
            description: "Most recent certification or LinkedIn Learning course date in YYYY-MM format, if visible. Omit if none.",
          },
        },
        required: ["activity", "recommendationCount", "hasSummary"],
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

/**
 * Deterministic, not model-decided — same principle as
 * computeCredibilityScoreDelta above, applied to the positive side. Added
 * 2026-07-29, Vlad's ask: if the cross-reference document actually resolves
 * a concern the original JD-fit screening flagged, the candidate should get
 * some credit back, not just be exposed to further deductions. Deliberately
 * smaller magnitude than the deduction side (+5/+15 vs -8/-25) — clearing a
 * doubt is good news, but shouldn't be as easy to gain points from as a real
 * discrepancy is to lose them, so a credibility check stays net-cautious by
 * design rather than becoming an easy way to inflate a score.
 */
export function computeCredibilityScoreBonus(resolvedConcerns: { concern: string; explanation: string }[]): number {
  if (!resolvedConcerns || resolvedConcerns.length === 0) return 0;
  return Math.min(15, resolvedConcerns.length * 5);
}

export async function assessCredibility(params: {
  resumeText: string;
  crossRefText?: string;
  roleContext?: string;
  /** Detected server-side via detectLinkedIn() — enables LinkedIn-specific prompting and signal extraction. Phase 2.4. */
  isLinkedIn?: boolean;
  /**
   * Concerns the ORIGINAL JD-fit screening (scoreCandidate.ts) flagged for
   * this candidate, e.g. result.concerns from the initial score. When
   * provided, the model checks whether the cross-reference document
   * resolves any of them (see resolvedConcerns in CREDIBILITY_TOOL) and the
   * resulting scoreDelta can be positive, not just <= 0. Omit or pass an
   * empty array to skip this — resolvedConcerns is left out of the response
   * entirely in that case, matching the pre-2026-07-29 behavior exactly.
   */
  originalConcerns?: string[];
}): Promise<CredibilityAssessment> {
  const { resumeText, crossRefText, roleContext, isLinkedIn, originalConcerns } = params;

  const roleNote = roleContext
    ? `The recruiter is screening for: ${roleContext}. Use this to contextualize whether the candidate's industry background is relevant.`
    : "";

  const hasCrossRef = Boolean(crossRefText);
  const crossRefLabel = isLinkedIn ? "LinkedIn profile" : "cross-reference document";
  const hasOriginalConcerns = Boolean(originalConcerns && originalConcerns.length > 0);

  const comparisonInstruction = hasCrossRef
    ? `Compare the resume against the ${crossRefLabel} line by line.${isLinkedIn ? " The cross-reference is a LinkedIn profile PDF — see instruction 7 for LinkedIn-specific signals to extract." : " The cross-reference may be a second resume version or any other verification document."}`
    : "No cross-reference document was provided — set rows to an empty array. Analyze the resume on its own for trajectory and industry signals.";

  const crossRefSection = hasCrossRef
    ? `\n\nCROSS-REFERENCE DOCUMENT:\n${crossRefText}`
    : "";

  const linkedInStep = isLinkedIn && hasCrossRef
    ? `7. Since the cross-reference is a LinkedIn profile PDF, populate linkedInSignals with profile activity signals — NOT skill comparison (the rows above already handle that). Extract: the connection count if visible (e.g. "500+" or "47"), the number of written recommendations received (0 if absent), whether the About/Summary section exists and has meaningful content, and the most recent certification or LinkedIn Learning course date if visible (YYYY-MM). Then derive the activity verdict using these criteria exactly: active = 500+ connections OR 3+ recommendations OR (summary present AND recent cert/course within the last 12 months); minimal = under 100 connections AND 0 recommendations AND no summary; moderate = everything else. An active LinkedIn presence is harder to fabricate and corroborates the resume; a minimal profile on a claimed senior is worth noting but not disqualifying on its own.`
    : "";

  const resolvedConcernsStep = hasOriginalConcerns && hasCrossRef
    ? `8. The ORIGINAL JD-fit screening flagged these concerns about the candidate:\n${(originalConcerns ?? []).map((c) => `   - ${c}`).join("\n")}\nFor each one the ${crossRefLabel} actually resolves with concrete, specific evidence, add an entry to resolvedConcerns per the tool schema's rules. Apply the same rigor as discrepancy detection — silence on a topic, or the cross-reference merely "not contradicting" a concern, does NOT count as resolving it. When genuinely unsure, leave it out.`
    : "";

  const originalConcernsNote = hasOriginalConcerns
    ? "\n\nNote: original screening concerns are listed in instruction 8 below — resolvedConcerns only applies if the cross-reference document is present."
    : "";

  // Grounds any date reasoning (employment gaps, "still employed" claims,
  // future-dated end dates) in the ACTUAL current date — added 2026-08-04,
  // same real gap found in lib/assessFraudRisk.ts the same day (Vlad: a
  // genuine past end date got flagged as "projected or fabricated" because
  // nothing told Claude what today's date actually is). This file does its
  // own separate date arithmetic (education year comparisons, employment
  // overlap checks) and had the identical missing grounding.
  // scoreCandidate.ts (do-not-touch) already has the equivalent line.
  const todayNote = `Today is ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Use this as ground truth for any date reasoning — do not flag a date as "future," "projected," or "fabricated" based on your own sense of the current date; compare it against the date above instead.`;

  const userContent = `You are a recruiting assistant performing a credibility check on a candidate. This recruiter works in IT staffing/consulting, so staffing-agency-vs-client-site naming patterns are common and expected — do not treat them as suspicious on their own.

${todayNote}

${roleNote}

${comparisonInstruction}${originalConcernsNote}

Your job:
1. ${hasCrossRef ? `Flag every ${crossRefLabel} field as match, discrepancy (tagged severity: material or minor), or cannot_verify, using the tolerance rules in the tool schema. Be precise about severity — over-flagging stylistic differences as full discrepancies erodes trust in this tool as much as missing a real one does.` : "Skip cross-reference comparison — leave rows empty."}
2. ${hasCrossRef ? "Also check the reverse direction, EMPLOYMENT ONLY: does the cross-reference document show any employment that the resume doesn't present as employment at all? Add a row for each — see the 'Undisclosed employment' field-naming convention in the tool schema. Default these to minor severity: most resumes only list recent/relevant roles and simply omit older jobs, which is completely normal, not concealment. Only mark one material if it plausibly OVERLAPS in time with a role the resume DOES list (undisclosed concurrent employment — the actual fraud-relevant pattern) or if the resume already mentions the same activity elsewhere in a way that contradicts the cross-reference. If the resume mentions the same activity in a non-employment section (portfolio, side projects), say so in the note and keep it minor. Do NOT run this reverse-check on education — education is handled entirely by instruction 3 below, as a single row, never a pair." : ""}
3. ${hasCrossRef ? "For education, produce exactly ONE row per degree — never a second row for the same cross-reference degree entry just because it also lacks its own resume counterpart; a resume education claim that doesn't match the cross-reference's education record is a single mismatch, not two separate flags about the same underlying credential. Do plain integer-year subtraction — do NOT estimate months, this is a category error since the resume side has no month. Extract resumeYear (the resume's bare year, e.g. 'Expected 2029' → 2029, treated exactly like a confirmed year) and the cross-reference's startYear/endYear (drop any month, e.g. 'January 2021 – November 2023' → 2021 and 2023). Compute resumeYear − startYear and resumeYear − endYear. If EITHER value is in {-1, 0, 1} — status: match, never a discrepancy, never even minor, full stop. Worked examples, compute don't estimate: 'Expected 2029' vs 'January 2026 – December 2029' → 2029−2029=0 → match. '2024' vs a range ending 'November 2023' → 2024−2023=1 → match (the November doesn't change the year-subtraction result — do not reason about 'how many months' this represents). Only mark a discrepancy when BOTH subtractions land outside {-1, 0, 1}: exactly ±2 years is minor, ±3 or more is material." : ""}
4. Note what sectors the candidate has actually worked in and whether that's relevant.
5. Read the career trajectory for consistency and signs of inflation.
6. If the cross-reference document appears to be a second resume version, include resumeDelta describing what changed and whether it looks like honest tailoring or suspicious rearrangement. Otherwise omit resumeDelta.
${linkedInStep}
${resolvedConcernsStep}

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
  // Real bug found 2026-08-04 (Vlad: "credibility check still gives an
  // empty output" — reproduced with the actual real-world PDF pair that
  // triggered it: a 31,946-char resume against a 33,324-char LinkedIn
  // export). Root cause had nothing to do with extraction (both files
  // extracted plenty of real text) — Claude's response hit max_tokens
  // mid-generation (confirmed: message.stop_reason === "max_tokens") while
  // still writing the tool call's JSON, and the SDK's tool-use parser
  // silently falls back to an empty `{}` input for a truncated/malformed
  // tool call rather than throwing. Downstream code then treated `{}` as a
  // structurally valid (if empty) assessment — rows/trajectoryNote/
  // industryNote all missing, overallSignal recomputed to "clean" from the
  // empty rows fallback — with zero indication anything went wrong. 2000
  // was never enough headroom for a real assessment: up to 10 rows, each
  // with a full-sentence `reasoning` field (required, and deliberately
  // verbose per the tool schema — "work out your answer here first"), plus
  // trajectoryNote/industryNote/resolvedConcerns/linkedInSignals on top,
  // routinely needs more than 2000 tokens for a real document pair. Raised
  // to 4096, matching every other structured-output call of comparable size
  // in this codebase (analyzeJD.ts, scoreCandidate.ts, parseResume.ts's
  // vision transcription all already use 4000-4096) — 2000 was the outlier.
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    tools: [{ ...CREDIBILITY_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_credibility_assessment" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a credibility assessment");
  }

  // Defensive guard, same 2026-08-04 fix — even at 4096 tokens, an
  // unusually large document pair could still hit the cap someday, and a
  // higher number alone doesn't change what happens when it does: the SDK
  // still silently hands back `{}` for a truncated tool call. Detect that
  // directly instead of trusting the object's shape — fail loudly with an
  // actionable message (matching the parseResume.ts extraction-failure
  // pattern) rather than silently completing with an empty assessment.
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Credibility check response was cut off before completing — this can happen with an unusually long resume or cross-reference document. Try again, or with a shorter document."
    );
  }

  const assessment = toolUse.input as CredibilityAssessment;

  // Real bug found 2026-08-03 (Vlad: "it said minor-concerns but nothing is
  // shown" — the header pill read "Minor concerns" while both the Flags and
  // Matches tabs were empty). Root cause: overallSignal is model-decided
  // (the tool schema tells Claude to "derive this from the rows, don't judge
  // independently") but nothing on this side ever enforced that — if Claude's
  // own output is internally inconsistent (declares minor_concerns/
  // significant_concerns without an actual matching discrepancy row, which
  // happens most often when crossRefText came back empty/near-empty and the
  // model still hedges toward a non-clean signal instead of "clean"), the UI
  // just renders whatever contradiction it was given. Same "deterministic,
  // not model-decided" principle already applied to scoreDelta below —
  // overallSignal is now always recomputed from the actual rows array, so it
  // can never disagree with what the recruiter sees in the Flags/Matches
  // tabs, regardless of what Claude put in that field.
  const rows = assessment.rows ?? [];
  const hasMaterial = rows.some((r) => r.status === "discrepancy" && r.severity === "material");
  const hasDiscrepancy = rows.some((r) => r.status === "discrepancy");
  assessment.overallSignal = hasMaterial ? "significant_concerns" : hasDiscrepancy ? "minor_concerns" : "clean";

  const deduction = computeCredibilityScoreDelta(rows);
  const bonus = computeCredibilityScoreBonus(assessment.resolvedConcerns ?? []);
  assessment.scoreDeduction = deduction;
  assessment.scoreBonus = bonus;
  assessment.scoreDelta = deduction + bonus;
  return assessment;
}
