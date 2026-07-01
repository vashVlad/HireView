# HireView — Project Brief

## Session Memory — read this first

Vlad works on this project across two machines. Before doing any work, read `memory/00-index.md`
and `memory/state.md` to pick up where the last session left off — do not re-derive project status
from scratch or from this brief alone (this brief is the stable pitch/spec, not the current build
state). Check `memory/open-questions.md` for anything that needs Vlad's input before proceeding.

At the end of any session where real changes were made (code, decisions, or new open questions),
append a short entry to `memory/session-log.md` and update `memory/state.md` and
`memory/decisions-log.md` in place if the change affects them. Keep entries short — this is a
handoff note for the next session, not a full changelog (that's what `HireView-Dev-Log.docx` is for).

## What is HireView?

HireView is an AI-powered recruiting assistant built to make the recruiting workflow faster, smarter, and less repetitive. The name is a double meaning: *Hire* (recruiting) + *Higher View* (bigger picture perspective on candidates).

It is a personal productivity tool built by and for a recruiter who currently works across two machines (work computer + personal computer), which is why the app is web-hosted rather than local.

---

## The Problem

The recruiter's current workflow:
1. Applicants come in through an **external job site** (not LinkedIn)
2. Resumes are **manually reviewed one by one** — time-consuming and repetitive
3. Selected candidates are then **managed in LinkedIn Recruiter**

The two biggest pain points are:
- **Reviewing and screening resumes** (most time-consuming)
- **Tracking candidate status** across the pipeline

---

## The Solution — Phased Roadmap

### Phase 0 — JD Analyzer, LinkedIn Filter Generator & Boolean Search Builder
This is the "who am I even looking for?" step that happens before sourcing begins. The recruiter pastes a job description and HireView does the heavy lifting of interpreting the role and generating everything needed to search LinkedIn Recruiter effectively.

**JD Analyzer**
- Paste any job description (even vague or internally inconsistent ones like FDE)
- Claude researches and decodes what the role actually requires
- Extracts must-have skills, nice-to-have skills, relevant titles, seniority signals, industries

**LinkedIn Recruiter Filter Output**
Mapped directly to LinkedIn Recruiter's actual filter fields, copy-paste ready:

| Filter | Output |
|---|---|
| Job Titles | List of equivalent titles with Boolean (`OR`) |
| Keywords | Boolean string for full-profile search |
| Seniority | Recommended levels (Corporate filter) |
| Job Functions | Broad LinkedIn functional categories |
| Years of Experience | Suggested range |
| Years in Current Position | Range signaling readiness to move (Corporate filter) |
| Current/Past Companies | Target company list (competitors, known talent pools) |
| Company Size | Recommended employee range |
| Industries | Relevant industry classifications |
| Spotlights | "Open to work" and "Past applicants" flags |

**Boolean Search String Builder**
- Generates a ready-to-use boolean string for the Keywords filter
- Follows LinkedIn Recruiter's syntax rules:
  - Operators must be UPPERCASE (`AND`, `OR`, `NOT`) — lowercase is ignored
  - Boolean supported in: Job Titles, Companies, and Keywords filters
  - Stop words are ignored (`and`, `or`, `the`, `of`, etc.) — avoid in keyword phrases
  - Max results per search is 1,000 — strings are kept tight enough to stay useful
- Outputs two versions: one broad (wide net), one tight (high precision)
- Explains why each term was included so the recruiter can tweak it

**Example output for a Forward Deployed Engineer role:**
```
JOB TITLES (Boolean):
"Forward Deployed Engineer" OR "Implementation Engineer" OR "Solutions Engineer"
OR "Customer Engineer" OR "Professional Services Engineer" OR "Technical Solutions Engineer"

KEYWORDS (Boolean):
("Python" OR "SQL" OR "APIs") AND ("enterprise" OR "SaaS")
AND ("customer-facing" OR "client deployment")

YEARS OF EXPERIENCE: 3–7
SENIORITY: Senior, Mid-Senior
INDUSTRIES: Computer Software, Information Technology, SaaS
COMPANY SIZE: 201–1,000 / 1,001–5,000
SPOTLIGHTS: ✓ Open to work  ✓ Past applicants
```

---

### Phase 1 — Resume Screener
- Recruiter pastes a job description once
- Uploads resumes in bulk (PDF / Word)
- Claude reads each resume and scores it against the JD
- Returns a **ranked list** with a short summary and score per candidate
- Goal: only spend real time on the top candidates

### Phase 2 — Candidate Status Tracker
- Lightweight dashboard to move candidates through stages:
  `Screened → Contacted → Interview → Offer → Rejected`
- Since LinkedIn Recruiter's API is enterprise-only, this is a standalone tracker
- Should be fast to update

### Phase 3 — Outreach Drafting
- Auto-draft personalized LinkedIn messages or emails based on resume highlights
- Triggered after candidates are selected from Phase 1

### Future Ideas (backlog)
- **Interview question generator** — tailored questions based on JD + specific candidate resume
- **Scorecard builder** — weighted criteria from JD for consistent candidate evaluation
- **Red flag detector** — highlight resume patterns that don't fit the role
- **Candidate comparison view** — side-by-side scoring of shortlisted candidates
- **Company target list generator** — suggest specific companies to source from
- **Role market intelligence** — compensation data, geographic concentration, competition level

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js (App Router) | Pairs perfectly with Vercel; handles frontend + API routes in one project |
| Styling | Tailwind CSS | Fast, no setup headaches |
| AI | Anthropic API (claude-sonnet-4-6) | Powers resume scoring and summarization |
| Hosting | Vercel | Accessible from any browser on any machine |
| Database | None to start | Keep state simple; add persistence later if needed |
| Language | TypeScript | Selected during `create-next-app` setup |

---

## Project Structure

```
hireview-v1/          ← Next.js project root (inside parent HireView/ folder)
├── src/
│   ├── app/          ← App Router pages and API routes
│   ├── components/   ← Reusable UI components
│   └── lib/          ← Utilities, Anthropic client, helpers
├── public/
├── CLAUDE.md         ← This file
├── package.json
└── ...
```

---

## Key Requirements

- **Multi-machine access**: Must work from both work computer and personal computer via browser (no local installs required beyond development)
- **Resume input**: Support PDF and Word document uploads
- **Bulk processing**: Handle multiple resumes in one session
- **Scoring**: Each resume gets a score + short summary relative to the job description
- **Ranked output**: Candidates sorted by score so the recruiter reads the best ones first
- **Clean UI**: Simple, functional — this is a personal productivity tool

---

## Anthropic API Usage

- Model: `claude-sonnet-4-6`
- Used server-side only (API routes in Next.js) — never expose API key to the client
- Primary use: resume parsing, scoring against JD, summarization

---

## Development Notes

- Start with Phase 0 — build the JD Analyzer and LinkedIn Filter/Boolean generator first, since it feeds directly into sourcing and is self-contained
- Then move to Phase 1 (resume screener) once Phase 0 is deployed and working
- The developer is comfortable with full-stack work
- Deploy to Vercel once Phase 1 is functional locally
- Keep it simple — avoid over-engineering early; add complexity as needed
