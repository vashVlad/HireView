# Cirot — Product Roadmap
**Owner:** Vladyslav Vashchuk
**Last Updated:** August 15, 2026 (brought current — see note below)
**Strategic Position:** Trust & Verification Layer for AI Recruiting

**Note on this update:** this file had not been touched since July 8, while most of Phase 1, FunnelView, and half of Phase 2 shipped in the meantime — the actual living log of that work is `session-log.md`/`open-questions.md`/`state.md`, which stayed current the whole time. This rewrite brings the table below in line with what `00-index.md`/`state.md` and this session's own code-accuracy pass confirm is actually shipped, and folds in everything decided in the 2026-08-14/15 roadmap sessions. Treat `session-log.md`/`open-questions.md` as the source of narrative truth going forward; this file is the prioritized summary view.

---

## North Star
Cirot is not an ATS. It is the verification layer that makes any sourcing tool safe to use at scale. Every feature must answer: does this increase trust, reduce fraud, or improve recruiter decision quality?

---

## PHASE 1 — FRAUD PREVENTION — **COMPLETE, MERGED TO MAIN**

| # | Feature | Problem Solved | Status |
|---|---------|---------------|--------|
| 1.1 | Duplicate Resume Detection | Catches word-for-word resumes under different names. Match on skills hash, responsibility vectors (text, not embeddings), metric claims, career arc — NOT names/contact info | **Shipped 2026-07-08** |
| 1.2 | Recruiter Attribution | Every action logged with name + timestamp | **Shipped 2026-07-09** |
| 1.3 | Teams Architecture | Admin → Team → Projects → Users, full isolation | **Shipped 2026-07-09** |
| 1.4 | Candidate History Alert | Reuses 1.1's fingerprints — "Previously seen" / "Known fraud pattern" banners | **Shipped 2026-07-09** |
| 1.5 | Fraud-Aware Interview Questions | Duplicate/credibility flag → interview questions probe the specific inconsistency | **Shipped 2026-07-09** |

All of 1.1–1.5 confirmed merged via PRs #1–#6.

---

## FUNNELVIEW — MANAGER VISIBILITY — **SHIPPED**
Admin-only funnel view (`app/funnelview/`, `lib/funnelview/`), live data, no CSV/external tools. Excel export includes recruiter attribution, target-company match flags, and (per this session) is getting a "Signals" column — see Phase 2.5 below.

---

## PHASE 2 — INTELLIGENCE LAYER

| # | Feature | Status |
|---|---------|--------|
| 2.1 | Cross-Project Fit Suggestion | **Shipped 2026-07-10** — auto-fire gate went through several rebuilds, live-tested, merged (PR #10) |
| 2.2 | Contextual Search (semantic synonyms) | **Superseded by Global Talent Search, Phase 2.5 below** — same underlying need, upgraded from keyword synonyms to real embeddings |
| 2.3 | Smart Unified Candidate View | **Shipped in substance** — `/candidates` (All Candidates) already has cross-project filtering (status, project, flagged, fraud, blacklisted, score range, date range) |
| 2.4 | LinkedIn Comparison | **Shipped** — `assessCredibility.ts`'s `linkedInSignals` field, LinkedIn-specific prompting, detected via `detectLinkedIn()` |

**Also shipped since the last version of this doc, not originally listed here:** Archive Fits (reuse archived candidates across projects), Transfer (move a candidate between projects with optional re-score), Calibration feedback loop (thumbs up/down → `calibration_examples`), Blacklist, Target-company score boost, current company/title/trajectory fields on every screening.

---

## PHASE 2.5 — TRUST & PRECISION LAYER (decided 2026-08-14/15, Cowork planning sessions, NOTHING BUILT YET)
*Full narrative and reasoning trail lives in `session-log.md`'s 2026-08-14/15 entries; build-ready specs live in `open-questions.md`. This table is the priority summary — read those files for the actual detail before building.*

| # | Feature | Problem Solved | Depends on | Status |
|---|---------|----------------|------------|--------|
| 2.5.1 | JD Checklist ("Trust badge") | Enriches must-have/nice-to-have into a precise, individually-editable, individually-reasoned checklist per JD. Critical path — two other items below need it. | Nothing (new file, consumes `analyzeJD.ts`'s existing output) | **Built 2026-08-17** — `tsc` clean, not yet migrated/live-tested. See `memory/claude-code-handoff-2026-08-17.md`. |
| 2.5.2 | Credibility trajectory overlay | Replaces `assessCredibility.ts`'s field-by-field `rows` with a real second trajectory (cross-ref document run through the same extraction), overlaid on the same graph, diffed in code, mismatches reasoned over by one small scoped AI call | Nothing — the stated dependency on 2.5.1 (checklist) turned out not to apply to the design actually built; see decisions-log.md's 2026-08-17 entry | **Built end-to-end 2026-08-17 (Cowork)** — decided design (rewrite, not overlay-on-existing-`rows`) after finding the real blocker was a missing structured data model, not the `rows` mechanism itself: `careerTrajectory` has only ever been freeform prose, no per-role structured data existed anywhere to graph or diff. New `trajectoryEntries` field on `scoreCandidate.ts` (do-not-touch exception), `lib/matchTrajectoryEntries.ts` (deterministic diff, 20/20 tests), `lib/compareEducationYear.ts` (education tolerance moved to pure code, 11/11 tests), `lib/assessCredibility.ts` restructured additively (new branch only when cross-ref + stored trajectory both present, old single-call flow untouched as fallback), `components/TrajectoryGraph.tsx` (hand-built timeline, no chart dependency), `components/CredibilitySection.tsx` wired to reuse the existing Flags/Matches tabs via a mapper — zero new list-rendering UI needed. `tsc` clean, all unit tests pass, do-not-touch diff confirmed clean. **Never live-tested** (no network access to the real Anthropic API or Supabase from this sandbox, same standing limitation as every AI-call file this project builds) — migration not yet run, no existing candidate has real `trajectory_entries` data yet. Claude Code handoff written: `memory/claude-code-handoff-2026-08-17-trajectory-overlay.md`. |
| 2.5.3 | GitHub/skills corroboration (Gate 4) | Folds a free GitHub API fetch into the *existing* cross-reference check as a third evidence source — not a separate feature/button | Nothing — 2.5.2 is now built, no longer a blocker | **Partially built 2026-08-17** — `lib/githubCorroboration.ts` (username extraction + Voyage-style best-effort fetch), attached as a pure code-side passthrough (`CredibilityAssessment.githubSignal`) shown as a neutral info panel, deliberately NOT fed into `assessCredibility.ts`'s prompt. Folding it into the actual AI judgment call (now the new `judgeTrajectoryComparison` step, not the old single-call flow) is the deferred remainder of this item — unblocked now that 2.5.2 shipped, but not attempted this round; a distinct, well-scoped next increment. |
| 2.5.4 | Consolidated candidate card | One shared card component replacing 3 separate implementations (`ResultCard.tsx`, Pipeline tab, All Candidates page) | Nothing — 2.5.2/2.5.3 base work is built | Unblocked as of 2026-08-17, not yet started. |
| 2.5.5 | Archive-fit two-stage matching | Fixes the current mechanism (an AI-guessed title matching another AI-guessed title, no real evidence) — stage 1 stays as-is, new stage 2 does cheap deterministic matching against the checklist | 2.5.1 | **Built 2026-08-17** — `lib/matchArchiveFitToChecklist.ts`, coverage-based deterministic matching, unit-tested (6/6). Wired into `lib/archiveFits.ts`/`app/projects/[id]/page.tsx` as "Evidence: ..." chips. |
| 2.5.6 | FunnelView "Signals" column | Renames the unused "Total experience" export column to "Signals" — strongest strength + weakest concern, both already generated, zero new AI calls | Nothing (one small do-not-touch ordering fix on `strengths`) | **Built 2026-08-15** |
| 2.5.7 | Tracker Reject column collapse | Reject column grows unbounded — collapses to a count + expand toggle | Nothing | **Built 2026-08-15** |
| 2.5.8 | Shared loading animation | One generative scrolling-line component for every wait state (screening, cross-ref check, archive-fit check, suggested-role-fit) — several currently have no indicator at all | Nothing | **Built 2026-08-17** — `components/ScoringLoader.tsx`, wired into every real wait state app-wide (confirmed via repo-wide grep: zero `animate-spin` instances remain). |
| 2.5.9 | Global talent search | Natural-language search across every candidate/project via embeddings (Voyage AI) — new infrastructure, no vector/embedding capability exists in this codebase today | Nothing structurally, but the biggest single lift | **Backend + UI both built, live-verified in a real browser, and committed** (`5911708`, `4e38b64`, `f0ef0b8` on `feat/jd-checklist`). UI redesigned into one search box with a mode toggle (Name/Skills) + a collapsed Filters panel per Vlad's direct feedback, 3 iteration rounds, all confirmed rendering correctly via real Playwright screenshots (not blind sandbox guesses). Ranking logic itself proven correct against real data in an earlier pass (correct top result at 0.63 vs 0.46 similarity, etc.). **Remaining blocker: the embedding backfill (~397 candidates) is still running — 118/398 as of last check** — search currently returns real `200 {results: []}` (not broken, just racing the backfill for Voyage's 3 req/min budget). **CRITICAL, still not done: `one-off-reindex-screenings-embedding.sql` must be re-run once the backfill finishes** (only run against 2 test rows so far). Best path to finish the backfill: run `npx tsx scripts/backfill-candidate-embeddings.ts` directly from a real terminal — Claude Code's own background-task runner keeps getting killed every ~2min, not a script problem. Once backfill + reindex are done, one final positive-match search screenshot closes 2.5.9 entirely. |

**Explicitly excluded from this round (need access Vlad doesn't have):** Gate 5 (identity realness — needs a paid identity-resolution API like Pipl) and Gate 6 (criminal check — needs a paid background-check vendor).

**Batch-load note:** of everything above, only 2.5.9's embedding call touches the automatic screening path (`screen-resumes/route.ts`, CONCURRENCY=3/maxDuration=300) — it would run as a third parallel call alongside the existing score+fingerprint pair. Everything else is recruiter-triggered, one-off, and never runs during a batch upload. Worth timing the real embedding call once built — this exact route already needed its timeout raised once (60s→300s) when per-resume work quietly grew past the ceiling.

---

## PHASE 3 — SCALE & DEFENSE (POST-DEMO, unchanged, still FUTURE)

| # | Feature | Problem Solved | Priority |
|---|---------|---------------|----------|
| 3.1 | Proxy Interview Detection | Compare interview performance against first-week work output signals | FUTURE |
| 3.2 | Reval/ATS Integration | Accept submissions from Reval/Lever → run through Cirot's fraud layer | FUTURE |
| 3.3 | Role-Based Analytics | Director sees team-wide signals; recruiter sees only their own pipeline | FUTURE |
| 3.4 | Candidate Social Graph | LinkedIn mutual connections, activity patterns as fraud signals | FUTURE |

---

## NEVER BUILD
- Autonomous AI interviewing (Reval's play — doesn't solve human-in-the-loop problem)
- Full ATS replacement (Hivemind's play — too broad, not our market)
- Job posting or sourcing (commodity — not defensible)
- Gate 5/6 (identity realness, criminal check) until real access to a paid vendor exists — do not half-build against infrastructure that isn't there

---

## Competitive Position
| Competitor | Their Strength | Their Gap | Cirot Advantage |
|-----------|---------------|-----------|-------------------|
| Reval ($8k/hire) | Autonomous sourcing + AI screening | Zero fraud detection, scores fake resumes | Fraud fingerprinting, credibility verification, human-in-loop trust |
| Hivemind | Full ATS workflow | No fraud layer, no verification | Fraud prevention, calibration learning, attribution |
