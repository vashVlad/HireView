import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import { FRAUD_PATTERN_TYPES } from "./types";
import type { FraudRiskAssessment, FraudRiskSignal, FraudCalibrationExample, FraudPatternType, CredibilityAssessment } from "./types";

// Pure, exported for unit testing (test_assessFraudRisk.mjs) — see that
// file for cases. Reuse audit, 2026-08-28 (Vlad's ask: "see if we can
// connect and reuse some of the outputs" across the AI pipeline files):
// this check previously ran completely blind to what the initial
// screening (scoreCandidate.ts) already flagged in result.concerns, so it
// could re-surface the exact same issue (an employment gap, say) as a
// scarier "fraud signal" with a percentage attached, with no awareness the
// recruiter already saw it as a routine concern. Mirrors the pattern
// assessCredibility.ts already uses for its own originalConcerns param.
export function buildKnownConcernsBlock(concerns?: string[]): string {
  if (!concerns || concerns.length === 0) return "";
  return `\nThis candidate's initial screening already flagged these concerns — do NOT re-list something already covered here as a new fraud signal unless it reveals something these concerns didn't already say:\n${concerns.map((c) => `- ${c}`).join("\n")}\n`;
}

// Pure, exported for unit testing. Same reuse-audit motivation as
// buildKnownConcernsBlock above — when a credibility cross-reference check
// has already run for this candidate, its findings (discrepancies already
// explained or resolved) should inform this check instead of being
// independently re-derived from the raw resume a second time.
export function buildCredibilityContextBlock(credibility?: CredibilityAssessment): string {
  if (!credibility) return "";
  const lines: string[] = [];
  for (const row of credibility.rows ?? []) {
    if (row.status === "discrepancy") {
      lines.push(`- Discrepancy already found: ${row.field} — resume says "${row.resume}", cross-reference says "${row.crossRef}"${row.note ? ` (${row.note})` : ""}`);
    }
  }
  for (const resolved of credibility.resolvedConcerns ?? []) {
    lines.push(`- Already resolved with evidence, not a fraud signal: ${resolved}`);
  }
  if (lines.length === 0) return "";
  return `\nA credibility cross-reference check has already run for this candidate. Its findings:\n${lines.join("\n")}\nDo not re-derive or re-flag any of the above from scratch — only add a signal here if it's genuinely separate from what's listed.\n`;
}

// Bounded the same way scoreCandidate.ts's buildCalibrationBlock caps its
// per-project example set — fraud_calibration_examples is system-wide, so
// left unbounded this would grow every single fraud-risk check's prompt
// forever as the library accumulates confirmed cases across every project.
const MAX_EXAMPLES_SHOWN = 12;

// Same "trust scales with sample size, not a hard cutover" reasoning as
// scoreCandidate.ts's calibrationWeightGuidance — see that function's doc
// comment for the fuller rationale. Thresholds are a first judgment call,
// not derived from measured data.
function fraudCalibrationWeightGuidance(count: number): string {
  if (count === 0) {
    return "No confirmed-fraud examples are on file yet — rely entirely on internal resume analysis (age vs. experience length, graduation year vs. role start dates, unexplained employment gaps, an inflated-sounding title progression) rather than pattern-matching against past cases.";
  }
  if (count >= 8) {
    return `You have ${count} confirmed-fraud examples on file — a substantial sample built from real hiring decisions after real interviews. Weight resemblance to these patterns heavily, alongside the internal consistency checks below.`;
  }
  return `You have ${count} confirmed-fraud example${count === 1 ? "" : "s"} on file — still a small sample. Treat internal resume consistency (age/graduation year/role gaps) as the primary signal; use ${count === 1 ? "this example" : "these examples"} only as a light secondary reference, since this few isn't enough yet to trust as a reliable pattern library. That trust should grow as more confirmed cases accumulate.`;
}

function buildFraudCalibrationBlock(examples: FraudCalibrationExample[], totalCount: number): string {
  const shown = examples.slice(0, MAX_EXAMPLES_SHOWN);
  const blocks = shown
    .map((ex) => {
      const claimLines = ex.claims.length > 0
        ? ex.claims.map((c) => `  - Fabricated claim: "${c.claimText}" — confirmed reason: ${c.explanation}`).join("\n")
        : "  (no specific fabricated claims recorded for this example)";
      return `CONFIRMED FRAUD EXAMPLE #${ex.id} — pattern: ${ex.patternType}\n${claimLines}\nFull resume text:\n${ex.extractedText}`;
    })
    .join("\n\n---\n\n");

  const subsetNote = shown.length < totalCount
    ? `\n(Showing ${shown.length} of ${totalCount} total confirmed-fraud examples on file — most recent subset, not the full set.)\n`
    : "";

  if (shown.length === 0) {
    return fraudCalibrationWeightGuidance(0);
  }

  return `The recruiter has confirmed the following past candidates as fraudulent AFTER interviewing them — these are real rejected candidates, not hypothetical examples. ${fraudCalibrationWeightGuidance(totalCount)}
${subsetNote}
${blocks}`;
}

const FRAUD_RISK_TOOL = {
  name: "submit_fraud_risk_assessment",
  description: "Submit the structured fraud risk assessment for a candidate resume, citing specific signals rather than a bare verdict.",
  input_schema: {
    type: "object" as const,
    properties: {
      signals: {
        type: "array",
        description:
          "Every specific point on the resume that resembles a known fraud pattern OR is internally inconsistent on its own (age vs. experience length, graduation year vs. role start dates, unexplained role gaps, implausibly fast title progression, generic résumé-mill phrasing). Empty array if nothing stands out — do not invent a signal just to have one. Be conservative: a resume that's merely impressive, or has a gap explained elsewhere in the text, is not a signal.",
        items: {
          type: "object",
          properties: {
            claimText: {
              type: "string",
              description: "The specific text/claim on the resume being screened that triggered this signal, quoted or closely paraphrased, e.g. 'Senior Engineer at Google, 2019-2022'.",
            },
            patternType: {
              type: "string",
              enum: FRAUD_PATTERN_TYPES,
              description: "Which category this signal falls into. Use 'other' only if none of the specific categories fit.",
            },
            explanation: {
              type: "string",
              description: "One sentence, max 25 words: the specific reasoning — do the arithmetic if relevant (e.g. 'Graduated 2020 per resume, but claims 8 years as a Staff Engineer by 2024 — 4 years total, not 8'). Cite the confirmed-fraud example number if this closely resembles one, e.g. 'Same fabricated-tenure pattern as example #12.'",
            },
            matchedExampleId: {
              type: "number",
              description: "The confirmed-fraud example's # from the list above, if this signal closely resembles one of them. Omit if this signal is based purely on internal resume inconsistency with no close match on file.",
            },
          },
          required: ["claimText", "patternType", "explanation"],
        },
      },
      summary: {
        type: "string",
        description: "One to two sentences max, plain language a recruiter can act on directly. No filler, no hedging language like 'it's possible that'. If signals is empty, state plainly that nothing stood out.",
      },
    },
    required: ["signals", "summary"],
  },
};

// Deterministic, not model-decided — same principle as
// computeCredibilityScoreDelta/computeCredibilityScoreBonus in
// lib/assessCredibility.ts, and the direct answer to Vlad's original ask
// ("gives a percentage ... of fake experience"). Each signal contributes a
// fixed weight by pattern type; resembling an actual confirmed-fraud example
// (matchedExampleId set) adds a flat bonus on top, since a resemblance to a
// REAL past case is stronger evidence than an unexplained inconsistency
// alone. Capped at 100. Weights are a first judgment call — flagged for
// Vlad to tune once this has run against real confirmed cases.
const PATTERN_WEIGHTS: Record<FraudPatternType, number> = {
  fabricated_experience: 30,
  fake_employer: 30,
  education_mismatch: 20,
  timeline_gap_concealment: 20,
  inflated_title: 15,
  boilerplate_resume: 10,
  other: 15,
};

const MATCHED_EXAMPLE_BONUS = 10;

export function computeFraudRiskScore(signals: FraudRiskSignal[]): number {
  if (!signals || signals.length === 0) return 0;
  const total = signals.reduce((sum, s) => {
    const base = PATTERN_WEIGHTS[s.patternType] ?? PATTERN_WEIGHTS.other;
    const bonus = s.matchedExampleId != null ? MATCHED_EXAMPLE_BONUS : 0;
    return sum + base + bonus;
  }, 0);
  return Math.min(100, total);
}

export function fraudRiskLevelFromScore(score: number): FraudRiskAssessment["overallRisk"] {
  if (score >= 60) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

/**
 * Manually-triggered only (Vlad's ask: never run inside the batch-screening
 * path, so a slow/failed check can't push the 60s route timeout and error
 * out a whole batch). Callers should gate on score >= 75 before offering
 * this at all — see components/FraudRiskChecker.tsx.
 */
export async function assessFraudRisk(params: {
  resumeText: string;
  roleContext?: string;
  calibrationExamples?: FraudCalibrationExample[];
  /** scoreCandidate.ts's own result.concerns — see buildKnownConcernsBlock's doc comment. */
  concerns?: string[];
  /** scoreCandidate.ts's own result.strengths — passed for the same "don't work blind" reason as concerns, currently only used if a future prompt tweak wants it; not yet referenced in userContent below beyond concerns. */
  strengths?: string[];
  /** An already-run credibility cross-reference assessment, if one exists — see buildCredibilityContextBlock's doc comment. */
  credibility?: CredibilityAssessment;
}): Promise<FraudRiskAssessment> {
  const { resumeText, roleContext, calibrationExamples = [], concerns, credibility } = params;

  const roleNote = roleContext
    ? `The recruiter is screening for: ${roleContext}. Use this only to judge whether a title/seniority claim is plausible for someone at that level — do not flag a candidate merely for being a strong fit.`
    : "";

  const calibrationBlock = buildFraudCalibrationBlock(calibrationExamples, calibrationExamples.length);
  const knownConcernsBlock = buildKnownConcernsBlock(concerns);
  const credibilityContextBlock = buildCredibilityContextBlock(credibility);

  // Grounds "is this date plausible" reasoning in the ACTUAL current date —
  // added 2026-08-04, real bug Vlad caught: a resume's real, past end date
  // ("11/2023 - 04/2026") got flagged as "a projected or fabricated end
  // date" because nothing in this prompt ever told Claude what today's date
  // actually is, so it fell back to guessing from training-data cutoff
  // instead — and guessed wrong. scoreCandidate.ts (do-not-touch) already
  // grounds its own date reasoning the same way ("Today is [X]. Do not flag
  // past dates as future.") — this file just never had the equivalent line.
  const todayNote = `Today is ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Use this as ground truth for any date reasoning — do not flag a date as "future," "projected," or "fabricated" based on your own sense of the current date; compare it against the date above instead.`;

  const userContent = `You are a recruiting assistant performing a fraud risk check on a candidate resume that already scored well on job-fit (this check is only ever run on strong-looking candidates — score >= 75 — since a weak resume's problems are already visible without this).

${todayNote}

${roleNote}

${calibrationBlock}
${knownConcernsBlock}${credibilityContextBlock}
Your job: read the resume below and identify any specific signals of fabricated or misrepresented experience. Look specifically at:
- Age/experience math: does claimed seniority or years of experience add up against graduation year or earliest listed role?
- Graduation year vs. role start dates: does the timeline make sense, or does experience appear to predate a claimed degree without explanation (e.g. part-time/concurrent study)?
- Role gaps: are there gaps that look concealed (dates overlapping oddly, vague date ranges) rather than just present?
- Implausible title/scope progression: does seniority jump faster than is plausible without an explanation (promotion, acquisition, startup context)?
- Resemblance to the confirmed-fraud examples above, if any were shown.

Be conservative — a resume that's merely impressive, unconventional, or has a gap explained elsewhere in its own text is NOT a signal. Cite specific text for every signal; do not assert a pattern without pointing to what on the resume triggered it.

RESUME:
${resumeText}`;

  // Prompt caching on the calibration block — same reasoning as
  // assessCredibility.ts's CREDIBILITY_TOOL caching: this block is identical
  // across every fraud-risk check until a new confirmed-fraud example is
  // added, and a recruiter running this on several strong candidates from
  // the same screening session back-to-back is the normal usage pattern.
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    tools: [{ ...FRAUD_RISK_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_fraud_risk_assessment" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a fraud risk assessment");
  }

  const result = toolUse.input as { signals: FraudRiskSignal[]; summary: string };
  const riskScore = computeFraudRiskScore(result.signals ?? []);

  const assessment: FraudRiskAssessment = {
    signals: result.signals ?? [],
    riskScore,
    overallRisk: fraudRiskLevelFromScore(riskScore),
    summary: result.summary,
    createdAt: new Date().toISOString(),
  };

  return assessment;
}
