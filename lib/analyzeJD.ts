import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { JDAnalysis } from "./types";

const FILTER_CONFIG_SCHEMA = {
  type: "object" as const,
  properties: {
    jobTitlesBoolean: {
      type: "string",
      description: "Boolean OR string of job titles for the LinkedIn Recruiter Job Titles filter.",
    },
    jobTitleToggle: {
      type: "string",
      enum: ["Current only", "Current or past"],
      description:
        "Whether to match current titles only or include past titles. Wide: 'Current or past'. Narrow: 'Current only'.",
    },
    location: {
      type: "string",
      description:
        "Target metro area as it appears in LinkedIn Recruiter (e.g. 'Greater Chicago Area'). Wide: empty string if not stated in JD. Narrow: set if JD implies on-site or hybrid; if fully remote leave empty.",
    },
    workplaceType: {
      type: "array",
      items: { type: "string" },
      description: "Array of applicable workplace types: 'On-site', 'Hybrid', 'Remote'.",
    },
    keywords: {
      type: "string",
      description:
        "Boolean keyword string for the Keywords filter. Wide: broader, more OR terms. Narrow: tighter AND logic focused on must-have skills.",
    },
    seniority: {
      type: "array",
      items: { type: "string" },
      description: "LinkedIn seniority levels (e.g. 'Entry', 'Senior', 'Manager', 'Director', 'VP').",
    },
    yearsExperience: {
      type: "string",
      description: "Total years of experience range, e.g. '3-10'. Wide: broader range. Narrow: tighter range.",
    },
    yearsInCurrentPosition: {
      type: "string",
      description:
        "Years in current position range signaling readiness to move (e.g. '2+'). Use 'any' if not a useful signal for this role.",
    },
    yearsInCurrentCompany: {
      type: "string",
      description:
        "Years at current company (e.g. '2+'). Use 'any' if not relevant. Corporate filter only.",
    },
    industries: {
      type: "array",
      items: { type: "string" },
      description: "LinkedIn industry classifications relevant to this role.",
    },
    companySize: {
      type: "array",
      items: { type: "string" },
      description: "LinkedIn company size ranges, e.g. '201-500', '1,001-5,000'.",
    },
    targetCompanies: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific companies that are strong talent pools. Wide: broader list. Narrow: only the highest-signal companies.",
    },
    spotlights: {
      type: "array",
      items: { type: "string" },
      description:
        "Active spotlight filters. Wide: empty array (don't restrict). Narrow: ['Open to work', 'Past applicants'].",
    },
    mustHaveFilters: {
      type: "array",
      items: { type: "string" },
      description:
        "Which filter names to set to the 'Must have' operator — everything else is 'Can have'. Wide: ['Job Titles'] only. Narrow: ['Job Titles', 'Location'] at most. Avoid more than 2-3 Must haves or results collapse.",
    },
  },
  required: [
    "jobTitlesBoolean",
    "jobTitleToggle",
    "location",
    "workplaceType",
    "keywords",
    "seniority",
    "yearsExperience",
    "yearsInCurrentPosition",
    "yearsInCurrentCompany",
    "industries",
    "companySize",
    "targetCompanies",
    "spotlights",
    "mustHaveFilters",
  ],
};

const ANALYZE_TOOL = {
  name: "submit_jd_analysis",
  description:
    "Submit the structured analysis of a job description as two LinkedIn Recruiter filter sets: wide (discovery) and narrow (execution).",
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
        description: "All equivalent or related titles a qualified candidate might hold.",
      },
      jobFunctions: {
        type: "array",
        items: { type: "string" },
        description: "Broad LinkedIn functional categories relevant to this role.",
      },
      rationale: {
        type: "string",
        description:
          "2-3 sentences explaining why the key titles and filters were chosen, so the recruiter can tweak them.",
      },
      wide: {
        ...FILTER_CONFIG_SCHEMA,
        description:
          "Wide (discovery) filter set — casts a broad net to understand the talent pool. Expect 5,000-15,000+ results. Used for calibration, not outreach.",
      },
      narrow: {
        ...FILTER_CONFIG_SCHEMA,
        description:
          "Narrow (execution) filter set — targeted for active outreach. Goal is 500-1,000 results of high-quality, ready-to-engage candidates.",
      },
    },
    required: [
      "mustHaveSkills",
      "niceToHaveSkills",
      "jobTitles",
      "jobFunctions",
      "rationale",
      "wide",
      "narrow",
    ],
  },
};

export async function analyzeJobDescription(jobDescription: string): Promise<JDAnalysis> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    tools: [ANALYZE_TOOL],
    tool_choice: { type: "tool", name: "submit_jd_analysis" },
    messages: [
      {
        role: "user",
        content: `You are helping a recruiter prepare to source candidates on LinkedIn Recruiter. Analyze the job description and output TWO complete filter configurations: wide and narrow.

WIDE SEARCH — discovery mode:
- Purpose: understand the talent pool size and composition before committing to a strategy
- Expected results: 5,000–15,000+ profiles
- Job Titles: broad Boolean with many OR variations and related titles
- Job Title toggle: "Current or past" to maximize reach
- Location: leave empty unless the JD explicitly requires on-site
- Workplace type: all types that apply
- Keywords: broad — favor OR logic, include synonyms and adjacent skills
- Years of experience: wider range (add 2-3 years buffer on each end)
- Years in current position / company: "any" — don't restrict
- Spotlights: empty — don't restrict to active candidates
- Must have filters: Job Titles only (1 at most)
- Companies: broad list of 8-12 relevant employers and competitors

NARROW SEARCH — execution mode:
- Purpose: the list the recruiter actually works — InMails, outreach, shortlisting
- Expected results: 500–1,000 profiles
- Job Titles: tighter Boolean, core titles only (3-5 most relevant)
- Job Title toggle: "Current only"
- Location: set the metro area if role is on-site or hybrid (e.g. "Greater New York City Area")
- Workplace type: match JD requirements
- Keywords: tight — AND logic on must-have skills, remove nice-to-haves
- Years of experience: tighter range matching JD requirements
- Years in current position: "2+" to surface candidates ready to move
- Years in current company: "2+" as additional readiness signal
- Spotlights: ["Open to work", "Past applicants"]
- Must have filters: ["Job Titles", "Location"] — never more than 2-3 or results collapse
- Companies: focused list of 4-6 highest-signal employers only

LINKEDIN BOOLEAN SYNTAX RULES (apply to both keyword strings and title strings):
- Operators must be UPPERCASE: AND, OR, NOT
- Quote multi-word phrases: "product manager"
- Avoid stop words inside phrases (and, or, the, of, at, by, for, with, in)
- LinkedIn caps results at 1,000 per search — the narrow string must stay tight enough to be useful within that cap

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
