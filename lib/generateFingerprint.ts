import { createHash } from "crypto";
import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResumeFingerprint {
  skillsHash: string;
  responsibilityVectors: string[];
  metricClaims: string[];
  careerArcSignature: string;
}

// ── Extraction ─────────────────────────────────────────────────────────────
//
// Fraud pattern this defends against: the same underlying resume resubmitted
// under a different identity — different name, contact info, and company
// names swapped out — with the actual skills/experience unchanged. So the
// fingerprint must never include name/contact/company, and must normalize
// wording enough that a lightly-reworded duplicate still matches.

const FINGERPRINT_TOOL = {
  name: "submit_fingerprint",
  description:
    "Extract an identity-scrubbed content fingerprint from a resume for duplicate-fraud detection.",
  input_schema: {
    type: "object" as const,
    properties: {
      skills: {
        type: "array",
        items: { type: "string" },
        description:
          "Every distinct skill/technology/tool mentioned, normalized to a lowercase canonical form (e.g. 'js' -> 'javascript', 'AWS' -> 'aws'). No duplicates.",
      },
      responsibilityVectors: {
        type: "array",
        items: { type: "string" },
        description:
          "Every distinct job responsibility or duty described, paraphrased into a short generic statement (max 12 words) with names, companies, and dates stripped out. E.g. 'Led a team of 5 engineers building a payments API', not 'Led team at Stripe on payments'.",
      },
      metricClaims: {
        type: "array",
        items: { type: "string" },
        description:
          "Every quantified achievement claim, normalized and stripped of company/product names. E.g. 'increased throughput by 40 percent', 'reduced infrastructure costs by 2 million dollars annually'.",
      },
      careerArcSignature: {
        type: "string",
        description:
          "One sentence abstractly describing the shape of the career: role types in order, approximate years per role, overall trajectory pattern. No names, companies, or exact dates. E.g. 'IC engineer to senior IC to team lead over roughly 8 years, steady upward progression with no gaps'.",
      },
    },
    required: ["skills", "responsibilityVectors", "metricClaims", "careerArcSignature"],
  },
};

interface FingerprintExtraction {
  skills: string[];
  responsibilityVectors: string[];
  metricClaims: string[];
  careerArcSignature: string;
}

export async function generateFingerprint(resumeText: string): Promise<ResumeFingerprint> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    tools: [FINGERPRINT_TOOL],
    tool_choice: { type: "tool", name: "submit_fingerprint" },
    messages: [
      {
        role: "user",
        content: `Extract a content fingerprint from this resume for duplicate-fraud detection. The goal is to catch the same underlying resume submitted under a different identity — different name, contact info, and company names swapped out — with the real skills/experience unchanged.

Strip out and never include: candidate name, email, phone, address, LinkedIn URL, company names, school names, exact dates.

RESUME:
${resumeText}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Fingerprint extraction failed — no tool call returned");
  }

  const input = toolUse.input as FingerprintExtraction;

  return {
    skillsHash: hashSkills(input.skills ?? []),
    responsibilityVectors: input.responsibilityVectors ?? [],
    metricClaims: input.metricClaims ?? [],
    careerArcSignature: input.careerArcSignature ?? "",
  };
}

function hashSkills(skills: string[]): string {
  const normalized = skills
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (normalized.length === 0) return "";
  return createHash("sha256").update(normalized.join("|")).digest("hex");
}

// ── Similarity ─────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.85;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function fingerprintText(fp: Pick<ResumeFingerprint, "responsibilityVectors" | "metricClaims" | "careerArcSignature">): string {
  return [...fp.responsibilityVectors, ...fp.metricClaims, fp.careerArcSignature].join(" ");
}

// Real bug found 2026-07-29 (meeting-prep audit, see decisions-log.md): an
// exact skillsHash match used to floor the score at SIMILARITY_THRESHOLD
// unconditionally — so two genuinely different candidates who just happen to
// list an identical normalized skill set (e.g. two generic "React, Node,
// AWS, SQL" resumes) could get flagged as a duplicate/fraud match even
// though their responsibilities, metrics, and career arc share nothing in
// common. An identical skill set is real corroborating evidence, but only
// once the rest of the profile already shows SOME independent overlap —
// this requires the raw wording similarity to clear a low bar first before
// letting the skills match floor it up to the full duplicate threshold.
const SKILLS_MATCH_MIN_CORROBORATION = 0.3;

/**
 * Returns a similarity score in [0, 1] between two fingerprints.
 * An exact skills-hash match is treated as a strong corroborating signal and
 * floors the score at the match threshold — but only when the rest of the
 * profile (responsibilities, metrics, career arc) already shows some
 * independent overlap; it's not enough on its own to manufacture a
 * duplicate match out of two otherwise-unrelated resumes.
 */
export function compareFingerprints(a: ResumeFingerprint, b: ResumeFingerprint): number {
  const skillsMatch = a.skillsHash.length > 0 && a.skillsHash === b.skillsHash;
  const similarity = jaccard(tokenize(fingerprintText(a)), tokenize(fingerprintText(b)));
  if (skillsMatch && similarity >= SKILLS_MATCH_MIN_CORROBORATION) {
    return Math.max(similarity, SIMILARITY_THRESHOLD);
  }
  return similarity;
}

export function isDuplicateMatch(similarity: number): boolean {
  return similarity >= SIMILARITY_THRESHOLD;
}
