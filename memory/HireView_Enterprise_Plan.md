# HireView — Enterprise Product Plan
**Owner:** Vladyslav Vashchuk
**Last Updated:** July 8, 2026
**Version:** 1.0

---

## Identity
HireView is the verification and trust layer for AI recruiting.
Every feature must answer one question: **does this increase trust, reduce fraud, or improve recruiter decision quality?**
If not — it doesn't ship.

---

## Feature Gate
Before anything gets built, answer all four:
1. Does a real user (Teti, Suchin, Indrani) feel this pain **today**?
2. Can impact be measured within **30 days**?
3. Does it reinforce the **trust-layer identity**?
4. Does it **reuse** something already built?

One no = log it as roadmap. Two nos = kill it.

---

## PHASE 1 — FRAUD PREVENTION (NOW)
*Win the Suchin demo. Beat Reval.*

**1.1 Duplicate Resume Detection** `CRITICAL`
Match on: skills hash, responsibility vectors, metric claims, career arc.
Never match on: names, contact info, company names — all swapped deliberately.
Output: red DUPLICATE DETECTED badge on pipeline card.
Reuses: existing screening pipeline, Supabase storage.
Test case: Shiraz Amin vs Amish Menon — must be flagged despite different identities.

**1.2 Recruiter Attribution** `CRITICAL`
Every action shows: "[Name] screened/moved/noted [Candidate] on [Date]"
Admin sees: full candidate activity timeline.
Reuses: existing user auth, existing pipeline status system.

**1.3 Teams Architecture** `CRITICAL`
Admin → Team → Projects → Users.
Recruiters see only their assigned teams. Complete isolation.
Reuses: existing multi-user auth, existing projects table (add team_id).
Migration: existing data moves to default "General" team, no data loss.

**1.4 Candidate History Alert** `HIGH`
Re-submitted resume across projects → yellow PREVIOUSLY SEEN banner.
Known fraud pattern → red KNOWN FRAUD PATTERN banner.
Reuses: duplicate detection fingerprints from 1.1.

**1.5 Fraud-Aware Interview Questions** `HIGH`
Duplicate/credibility flag present → questions probe the specific inconsistency.
No flag → standard role-fit questions (existing behavior).
Reuses: existing interview questions feature, existing credibility checker.

---

## FUNNELVIEW — MANAGER VISIBILITY (after Phase 1, before Phase 2)
*Give the hiring manager direct funnel visibility without recruiter mediation.*

Formerly logged as Phase 3.3 "Role-Based Analytics" under Phase 3 (post-demo), assumed to depend on Teams (1.3). That dependency is soft, not hard: v1 is admin-gated the same way Team/Statistics already are — no team-scoping needed yet, so no need to wait for Teams or "post-demo." Moved here since there's a live stakeholder need now and nothing else blocks it once 1.5 ships.

**Scope:** Admin-only view inside HireView showing the full candidate funnel — Screened → Passed Threshold → Reached Out → TA → L1 → L2 → Offer → Archived — with conversion rate between each stage, inbound/outbound source split (via `linkedin_mode`), current + previous stage per candidate, recruiter attribution.

**Architecture:** Isolated module — `app/funnelview/` (UI) + `lib/funnelview/` (data access, maps `screenings`/`tracker` rows into one clean funnel-record shape). No entanglement with core scoring files. The mapping layer is a deliberate seam: if this is ever needed by other departments as a standalone product, that same shape becomes a CSV/API contract and the module extracts cleanly with minimal rework.

**Reuses:** `screenings`/`tracker` tables, `previous_status`/`previous_stage` (already shipped), existing `isAdmin` auth pattern. Does not require Teams (1.3).

---

## PHASE 2 — INTELLIGENCE LAYER (30 DAYS)
*Make HireView smarter than any recruiter working alone.*

**2.1 Cross-Project Fit Suggestion** `HIGH`
Score below threshold on active role → auto-score against all other active projects in same team → surface best match.
Example: FDE score 35 → suggests AI Developer at 73.
Reuses: existing scoring engine, existing JD analyzer per project.

**2.2 Contextual Search** `HIGH`
"Incident response" understood as implying specific cybersecurity stack.
Semantic synonyms, not keyword matching.
Reuses: existing JD analyzer semantic logic.

**2.3 Smart Unified Candidate View** `MEDIUM`
Cross-project dashboard: all candidates filterable by fraud flag, score, stage, recruiter, date.
Director-level visibility without switching projects.
Reuses: existing All Candidates page — add filters and fraud signal column.

**2.4 LinkedIn Comparison** `MEDIUM`
Upload LinkedIn PDF → surface mismatches in dates, titles, skills, network signals.
Reuses: existing Credibility Checker — extend with LinkedIn-specific prompting.

---

## PHASE 3 — ENTERPRISE SCALE (POST-DEMO)
*Make HireView impossible to replace.*

**3.1 Proxy Interview Detection** — identity verification across interview → onboarding gap. Long-term play.
**3.2 ATS/Reval Integration** — accept candidate submissions from external tools, run through fraud layer.
**3.4 Candidate Social Graph** — LinkedIn mutual connections and activity as fraud signals.

(3.3 Role-Based Analytics moved to FunnelView, above — no longer gated on Teams.)

Remaining Phase 3 features reuse Teams architecture (1.3) and Credibility Checker.

---

## NEVER BUILD
- Autonomous AI interviewing — doesn't solve human-in-loop problem (Reval's failure)
- Full ATS replacement — too broad, Hivemind's territory
- Job posting or sourcing — commodity, not defensible
- Features that require training to use
- Settings pages nobody understands

---

## UI STANDARDS — ENTERPRISE 2026

**Core principle:** Get in, complete the task, get out. Every screen has one job.

**Information hierarchy:**
- Fraud signals surface immediately — red/yellow badges on collapsed card, never hidden in detail view
- Headline metrics first, drill down on demand (progressive disclosure)
- Role-aware views: recruiter sees their pipeline only, admin sees everything

**Interaction standards:**
- Every action attributed: name + timestamp visible at a glance
- Empty states are invitations to act — tell the user exactly what to do next
- Errors explain what went wrong and how to fix it — never vague
- Buttons say exactly what happens: "Screen Resumes" not "Submit"
- One ask per screen — never two primary actions competing

**What not to do:**
- Flashy animations that slow task completion
- Generic AI summaries that might be hallucinated (Reval's exact failure)
- Cognitive load as the primary experience
- Features visible to users who will never use them

**Mobile:** Recruiters use phones on the floor. Every pipeline action must work on mobile. Test every new feature on mobile before shipping.

---

## COMPETITIVE POSITION

| | Reval ($8k/hire) | Hivemind | HireView |
|--|--|--|--|
| Sourcing | ✓ | ✓ | ✗ (not our market) |
| AI Screening | ✓ | ✓ | ✓ |
| Fraud Detection | ✗ | ✗ | ✓ |
| Duplicate Fingerprinting | ✗ | ✗ | ✓ |
| Credibility Verification | ✗ | ✗ | ✓ |
| Calibration Learning | ✗ | ✗ | ✓ |
| Recruiter Attribution | ✗ | partial | ✓ |
| Human-in-loop Trust | ✗ | ✗ | ✓ |

**HireView's moat:** Reval and Hivemind automate the top of funnel. HireView answers the question neither can: *can I actually trust this candidate?*

---

## LOGGED PROBLEM STATEMENTS

1. Cross-project fit suggestion → Phase 2.1
2. Competitive positioning vs Reval → Phase 3.2
3. Reval integration opportunity → Phase 3.2
4. Smart unified candidate view → Phase 2.3
5. Fraud-aware interview questions → Phase 1.5
6. Single view of all duplicate-flagged candidates → Phase 2.3 (logged 2026-07-08, surfaced during Phase 1.1 use)

---

## PRIOR ART PROTECTION
- Calibration system: Novel Implementation A — documented in HireView_Prior_Art_Document.pdf
- Credibility checker: Novel Implementation B — documented
- Duplicate fingerprinting system: **document as Novel Implementation C immediately after Phase 1.1 ships**
- Rule: any novel implementation ships → prior art document updated same day

---

## ENTERPRISE SCALING REQUIREMENTS — Brillio pilot (added 2026-07-17, from Team Demo feedback)

Split by what Vlad can execute solo vs. what structurally requires Brillio's internal AI product group (Abibsha Kota, Sandeep Prani) or leadership sign-off. Grounded against the actual codebase, not assumptions:

**Vlad can do now:**
- Multi-key API routing — currently a single hard-coded `ANTHROPIC_API_KEY` in `lib/anthropic.ts`, one client, no per-team/project routing. Code change is straightforward; getting *additional company-billed keys issued* is the Brillio-side half (see below).
- Data restriction guardrail — verified no compensation/salary field exists anywhere in the schema today, so this is a policy + a simple upload-time warning to add, not a rearchitecture.
- Calibration onboarding for EA — `calibration_examples` table and like/dislike flow already ship. Feeding in Shubham/Gomati's past successful-hire resumes is just using the existing feature with real data, no new build.
- Cross-project fraud pattern detection — Phase 1.1–1.4 (duplicate fingerprinting, candidate history alerts) already shipped and merged to main. Needs live-testing at real EA volume, not new engineering.
- Pilot expansion (EA role, high volume) — infra already handles bulk upload; known constraint is `CONCURRENCY = 3` hardcoded in `app/api/screen-resumes/route.ts` (screening) and `cross-project-fit/route.ts` (fit suggestion) — functionally fine, just slow at hundreds of resumes. Raising it is a Vlad-side tuning task, capped by whatever rate limit the single API key actually has.
- Lever integration prototype — today `leverUrl` is just a manual per-candidate link field, no real Lever API calls anywhere in the code. Vlad can prototype real sync logic, but Brillio has to grant Lever API access/decide the system boundary before it's real (see below).

**Needs Brillio's AI product group / leadership:**
- Dedicated database migration — provisioning and credentials for Brillio's secure internal DB aren't Vlad's to create; he can prep an export/migration script, but the destination has to come from their side.
- Audit & compliance review — by definition an external review Vlad can't self-certify.
- Additional API keys (billing/procurement) — the code-side routing is Vlad's, but the actual keys need to be issued under Brillio's account.
- Lever integration scope/access — same story as above: prototype is Vlad's, the actual API grant and "is this an approved integration boundary" call is theirs.
- Stakeholder alignment (Sandeep Prani, technical TA team) — a relationship/outreach action for Vlad to initiate, not something to build, but the *alignment itself* can't be unilaterally declared done.

---

*Drop this file into Cowork alongside BLUEPRINT_Operations_Systems_Builder.md.
Every build session reads this before starting anything.*
