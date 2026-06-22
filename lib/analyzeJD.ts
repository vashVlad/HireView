import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { JDAnalysis } from "./types";

const ANALYZE_TOOL = {
  name: "submit_jd_analysis",
  description:
    "Submit the structured analysis of a job description, mapped to LinkedIn Recruiter's filter fields.",
  input_schema: {
    type: "object" as const,
    properties: {
      mustHaveSkills: {
        type: "array",
        items: { type: "string" },
        description: "Skills the candidate must have to be considered.",
      },
      niceToHaveSkills: {
        type: "array",
        items: { type: "string" },
        description: "Skills that are a bonus but not required.",
      },
      jobTitles: {
        type: "array",
        items: { type: "string" },
        description: "Equivalent or related job titles a qualified candidate might currently hold.",
      },
      jobTitlesBoolean: {
        type: "string",
        description:
          "The jobTitles list rendered as a ready-to-paste LinkedIn Recruiter Boolean OR string, e.g. \"Title A\" OR \"Title B\".",
      },
      seniorityLevels: {
        type: "array",
        items: { type: "string" },
        description: "Recommended LinkedIn Recruiter seniority levels (e.g. Mid-Senior, Director).",
      },
      jobFunctions: {
        type: "array",
        items: { type: "string" },
        description: "Broad LinkedIn functional categories relevant to this role.",
      },
      yearsExperience: {
        type: "string",
        description: "Suggested total years of experience range, e.g. \"3-7\".",
      },
      yearsInCurrentPosition: {
        type: "string",
        description: "Suggested range for years in current position, signaling readiness to move.",
      },
      targetCompanies: {
        type: "array",
        items: { type: "string" },
        description: "Specific companies likely to be strong talent pools or competitors for this role.",
      },
      companySize: {
        type: "array",
        items: { type: "string" },
        description: "Recommended employee count ranges, e.g. \"201-1,000\".",
      },
      industries: {
        type: "array",
        items: { type: "string" },
        description: "Relevant LinkedIn industry classifications.",
      },
      keywordsBooleanBroad: {
        type: "string",
        description:
          "A wide-net Boolean keyword string for the LinkedIn Recruiter Keywords filter, following LinkedIn syntax (uppercase AND/OR/NOT, quoted phrases, no stop words).",
      },
      keywordsBooleanTight: {
        type: "string",
        description:
          "A high-precision Boolean keyword string for the LinkedIn Recruiter Keywords filter, narrower than the broad version.",
      },
      rationale: {
        type: "string",
        description:
          "A short explanation of why the key terms and filters were chosen, so the recruiter can tweak them.",
      },
    },
    required: [
      "mustHaveSkills",
      "niceToHaveSkills",
      "jobTitles",
      "jobTitlesBoolean",
      "seniorityLevels",
      "jobFunctions",
      "yearsExperience",
      "yearsInCurrentPosition",
      "targetCompanies",
      "companySize",
      "industries",
      "keywordsBooleanBroad",
      "keywordsBooleanTight",
      "rationale",
    ],
  },
};

export async function analyzeJobDescription(jobDescription: string): Promise<JDAnalysis> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    tools: [ANALYZE_TOOL],
    tool_choice: { type: "tool", name: "submit_jd_analysis" },
    messages: [
      {
        role: "user",
        content: `You are helping a recruiter prepare to source for a role on LinkedIn Recruiter. Read the job description below — even if it's vague, jargon-heavy, or internally inconsistent — and decode what the role actually requires.

Produce a full analysis mapped to LinkedIn Recruiter's filter fields, plus a ready-to-paste Boolean search string for the Keywords filter. Follow LinkedIn Recruiter's Boolean syntax rules exactly:
- Operators must be UPPERCASE (AND, OR, NOT) — lowercase is ignored
- Quote multi-word phrases
- Avoid stop words (and, or, the, of, etc.) inside keyword phrases
- Keep the tight version narrow enough to stay under LinkedIn's 1,000 result cap for a typical search

JOB DESCRIPTION:
${jobDescription}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a JD analysis");
  }

  return toolUse.input as JDAnalysis;
}
