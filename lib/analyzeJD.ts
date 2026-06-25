import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { JDAnalysis } from "./types";

const FILTER_CONFIG_SCHEMA = {
  type: "object" as const,
  properties: {
    jobTitlesBoolean: { type: "string", description: "Boolean OR string for the Job Titles filter." },
    jobTitleToggle: {
      type: "string",
      enum: ["Current only", "Current or past"],
      description: "Wide: 'Current or past'. Narrow: 'Current only'.",
    },
    location: {
      type: "string",
      description: "LinkedIn metro area (e.g. 'Greater Chicago Area'). Empty string if remote or not determinable from JD.",
    },
    workplaceType: {
      type: "array",
      items: { type: "string" },
      description: "Applicable values: 'On-site', 'Hybrid', 'Remote'.",
    },
    keywords: {
      type: "string",
      description: "Boolean string for the Keywords filter. Wide: OR-heavy. Narrow: AND-focused on must-haves.",
    },
    seniority: {
      type: "array",
      items: { type: "string" },
      description: "LinkedIn seniority levels, e.g. 'Senior', 'Manager', 'Director'.",
    },
    yearsExperience: { type: "string", description: "Range, e.g. '3-10'." },
    yearsInCurrentPosition: { type: "string", description: "e.g. '2+'. Use 'any' if not relevant." },
    yearsInCurrentCompany: { type: "string", description: "e.g. '2+'. Use 'any' if not relevant. Corporate only." },
    industries: { type: "array", items: { type: "string" }, description: "LinkedIn industry classifications." },
    companySize: { type: "array", items: { type: "string" }, description: "e.g. '201-500', '1,001-5,000'." },
    targetCompanies: {
      type: "array",
      items: { type: "string" },
      description: "Talent-pool companies. Wide: 8-12. Narrow: 4-6 highest-signal.",
    },
    spotlights: {
      type: "array",
      items: { type: "string" },
      description: "Wide: []. Narrow: ['Open to work', 'Past applicants'].",
    },
    mustHaveFilters: {
      type: "array",
      items: { type: "string" },
      description: "Filter names set to 'Must have' (rest = 'Can have'). Wide: ['Job Titles']. Narrow: ['Job Titles', 'Location']. Never more than 3.",
    },
  },
  required: [
    "jobTitlesBoolean", "jobTitleToggle", "location", "workplaceType", "keywords",
    "seniority", "yearsExperience", "yearsInCurrentPosition", "yearsInCurrentCompany",
    "industries", "companySize", "targetCompanies", "spotlights", "mustHaveFilters",
  ],
};

const ANALYZE_TOOL = {
  name: "submit_jd_analysis",
  description: "Submit the JD analysis as two LinkedIn Recruiter filter sets: wide (discovery) and narrow (execution).",
  input_schema: {
    type: "object" as const,
    properties: {
      mustHaveSkills: { type: "array", items: { type: "string" }, description: "Non-negotiable skills." },
      niceToHaveSkills: { type: "array", items: { type: "string" }, description: "Preferred but not required." },
      jobTitles: { type: "array", items: { type: "string" }, description: "All equivalent titles a qualified candidate might hold." },
      jobFunctions: { type: "array", items: { type: "string" }, description: "LinkedIn functional categories." },
      rationale: { type: "string", description: "2-3 sentences on why key titles/filters were chosen." },
      wide: { ...FILTER_CONFIG_SCHEMA, description: "Discovery filter set. Goal: 5k–15k results." },
      narrow: { ...FILTER_CONFIG_SCHEMA, description: "Execution filter set. Goal: 500–1k results." },
    },
    required: ["mustHaveSkills", "niceToHaveSkills", "jobTitles", "jobFunctions", "rationale", "wide", "narrow"],
  },
};

const INSTRUCTIONS = `You are helping a recruiter source candidates on LinkedIn Recruiter. Analyze the job description and output two complete filter sets.

WIDE (discovery, 5k–15k results): broad title boolean, toggle "Current or past", location empty unless on-site JD, all applicable workplace types, OR-heavy keywords with synonyms, wide experience range (+2-3 yrs buffer), yearsInCurrentPosition/Company = "any", spotlights = [], mustHaveFilters = ["Job Titles"] only, 8–12 target companies.

NARROW (execution, 500–1k results): tight title boolean (3-5 core titles), toggle "Current only", location set if on-site/hybrid, workplace type per JD, AND-focused keywords on must-haves only, tight experience range, yearsInCurrentPosition = "2+", yearsInCurrentCompany = "2+", spotlights = ["Open to work", "Past applicants"], mustHaveFilters = ["Job Titles", "Location"], 4–6 companies.

BOOLEAN SYNTAX: operators UPPERCASE (AND, OR, NOT), quote multi-word phrases, avoid stop words.

JOB DESCRIPTION:`;

export async function analyzeJobDescription(jobDescription: string): Promise<JDAnalysis> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    tools: [{ ...ANALYZE_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_jd_analysis" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: INSTRUCTIONS,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: jobDescription,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a JD analysis");
  }

  return toolUse.input as JDAnalysis;
}
