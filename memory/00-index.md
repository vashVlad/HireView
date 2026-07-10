# HireView — Memory Vault (Index)

This folder is HireView's persistent memory. Read this first, every session, before touching code.

---

## READ IN THIS ORDER — EVERY SESSION, NO EXCEPTIONS

**1. [[state]]** — what's built, what's shipped, what's pending migration. Source of truth for "where are we right now."

**2. [[decisions-log]]** — why things are the way they are. Don't reverse a decision without reading why it was made.

**3. [[HireView_Enterprise_Plan]]** — the single source of truth for what gets built, in what order, and why. Contains the feature gate (4 questions every feature must pass), full Phase 1-3 roadmap, UI standards, competitive position, and the Never Build list. Reference this before touching any feature.

**4. [[HireView_Roadmap]]** — lean feature table with priorities, reuse notes, and logged problem statements. Cross-reference with Enterprise Plan on every decision.

**5. [[BLUEPRINT_Operations_Systems_Builder]]** — the methodology governing all work. Every feature follows the 5-phase framework: Embed → Define → Design → Build → Validate. Never skip phases.

**6. [[hireview-enterprise-skill]]** — product governance skill. Apply on every UI decision, every feature scoping question, and every time new ideas are introduced mid-session.

**7. [[open-questions]]** — unresolved items, blockers, things needing Vlad's input. Check before starting work.

**8. [[session-log]]** — dated log of work sessions. Append a new entry at the END of any session with real changes.

---

## CRITICAL CONSTRAINTS — apply every session

- **DO NOT TOUCH:** `lib/scoreCandidate.ts`, `lib/analyzeJD.ts`, `lib/parseResume.ts`, `lib/calibrationExamples.ts`, `app/api/screen-resumes/route.ts` — validated core, build around them never through them
- **Schema changes are additive only** — new columns and tables only, always backward-compatible defaults, never delete or rename existing columns
- **Every feature ships with:** working empty state, working error state, mobile-tested layout
- **Fraud signals** (duplicate detected, previously seen, known fraud pattern) must appear as colored badges on the collapsed pipeline card — never buried in expanded view
- **Build Phase 1 in strict order:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5. Complete and test each before starting next

---

## DOCUMENTATION — update after every session

| Trigger | Update these files |
|---|---|
| Every build session | `session-log.md` (append), `decisions-log.md` (prepend) |
| Every feature ships | `state.md` (move to shipped), `HireView_Impact_Report_Brillio.md` |
| Phase 1.1 ships | `HireView_Prior_Art_Document.pdf` — add Novel Implementation C (duplicate fingerprinting) same day |
| Any novel implementation | Email vladvashchuk2005@gmail.com with subject "HireView Prior Art Update — [date]" |

---

## CURRENT BUILD QUEUE

**Order: Phase 1 → FunnelView → Phase 2 → Phase 3**

**Phase 1 — Fraud Prevention (NOW)**
- 1.1 Duplicate Resume Detection `CRITICAL` — match on skills hash, responsibility vectors, metric claims, career arc. Never on names/contact/company — **shipped 2026-07-08, merged to main (PR #2)**
- 1.2 Recruiter Attribution `CRITICAL` — every action logged with name + timestamp — **shipped 2026-07-09, merged to main**
- 1.3 Teams Architecture `CRITICAL` — Admin → Team → Projects → Users, full isolation — **shipped 2026-07-09, committed (b33f2b1), PR open on phase-1-3-teams-architecture, not yet merged**
- 1.4 Candidate History Alert `HIGH` — reuses fingerprints from 1.1 — **shipped 2026-07-09, committed (ab916ce on phase-1-3-teams-architecture, on top of b33f2b1), PR updated, not yet merged**
- 1.5 Fraud-Aware Interview Questions `HIGH` — reuses existing interview questions + credibility checker — **shipped 2026-07-09, committed (f9d62f8), PR description updated, not yet merged**

**Phase 1 is fully complete and merged to main (2026-07-09).** All of 1.1–1.5 shipped, live-tested, and merged via PRs #1–#6 (confirmed on GitHub: 0 open, 6 closed, all merged). FunnelView is unblocked and ready to start.

**FunnelView — Manager Visibility (after Phase 1, before Phase 2)**
Admin-only, isolated module inside HireView (`app/funnelview/`, `lib/funnelview/`), live data, no CSV/external tools. See [[HireView_Roadmap]] and [[HireView_Enterprise_Plan]] for full details. **Merged to main, 2026-07-09 (`34182e0`) — build/typecheck clean, not yet live-tested.** See [[state]] and [[session-log]].

**Phase 2 — Intelligence Layer (30 days)**
See [[HireView_Enterprise_Plan]] for full details.

**Phase 3 — Enterprise Scale (post-demo)**
See [[HireView_Enterprise_Plan]] for full details.

---

## RELATED DOCS OUTSIDE THIS VAULT

- `../CLAUDE.md` — project brief + agent instructions
- `../docs/HireView_Prior_Art_Document.pdf` — IP protection document, update when novel features ship
- `../docs/HireView-Dev-Log.docx` — full narrative build history
- `../docs/HireView-Architecture-Redesign-Phase2-3.docx` — locked nav redesign (shipped)
- `../docs/HireView-Case-Study.docx`, `../docs/HireView-Impact-Report.docx` — external-facing writeups
- `../supabase/migrations/` — all `supabase-migration-*.sql` files (moved out of repo root 2026-07-09, no rename)

---

## VAULT FORMAT

Plain markdown, Obsidian-compatible (`[[wikilinks]]` work if opened as a vault) but not Obsidian-dependent. Any editor or Claude session can read/write these files directly.

*Last updated: July 9, 2026 (reorg: docx files + Prior Art PDF → docs/, SQL migrations → supabase/migrations/)*
