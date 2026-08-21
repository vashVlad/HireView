# Claude Code handoff — 2026-08-20 (full-system constraint audit + maintainability review)

Paste this whole file as your prompt to Claude Code.

**This is an audit-and-report task. Do not change any code as part of this pass** — Vlad's explicit
call: report findings, he picks which ones to act on afterward. The one exception: if you find
something that is actively broken in production right now (not "could be cleaner" — genuinely
wrong behavior a recruiter would notice), flag it at the top of your report as urgent and ask
before touching it, same as everything else, but call out the urgency.

---

## Context

This is the Cirot recruiting app (`C:\Portfolio\HireView Production\HireView`). Several Cowork
sessions have built this up feature by feature — most recently Phase 2.6 (two-gate screening
architecture: `memory/Cirot_Roadmap.md`'s Phase 2.6 table, `memory/decisions-log.md`'s 2026-08-19/
20 entries), which you already live-verified. Vlad's ask now, verbatim: "I need you to whether
tell claude code to run through the whole system and make sure that we have all constraints
engaged and doing what they're supposed to do. I need to reed the whole system and inspect it and
then make it easier and more simple to maintain if possible." Confirmed scope: **whole system**,
not just Phase 2.6. Confirmed depth: **report only, no direct changes**.

Two parts, run them in order.

---

## Part 1 — Constraint verification (live, real Supabase/Anthropic — this is what you're set up for)

Go through every gate/threshold/business rule in this app and confirm it actually fires, not just
that the code exists. For each one: state what SHOULD happen, what you observed, and pass/fail.

1. **Gate 1 (checklist pass/fail).** A candidate whose checklist score comes in below a project's
   `scoreThreshold` should archive immediately with zero AI summary/strengths/trajectory — you
   already confirmed this works. Now check the EDGE cases: a project with a checklist where every
   item has 0 points (degenerate — does `computeChecklistPercentageScore` correctly return `null`
   instead of a fake 0, letting the candidate fall through to full scoring?); a checklist item
   evaluation that errors out (does it fail open to full scoring, per `evaluateChecklist`'s own
   `.catch()`, or silently archive someone who should've been scored?).
2. **Score threshold auto-archive** (the ORIGINAL rule, 2026-07-15, unrelated to Gate 1) — a
   candidate scoring below `project.scoreThreshold` after a REAL scoreCandidate() call should also
   auto-archive. Confirm this still works for a project with NO checklist configured at all — the
   original, checklist-free path.
3. **Team/auth scoping.** Pick 3-4 routes at random across the app (not just ones you touched) and
   confirm `canAccessScreening`/`canAccessProject`/team-id filtering actually blocks a
   cross-team request, not just that the check exists in the code. Cirot is multi-recruiter —
   this is the one category of bug that would be a real incident, not just an inconvenience.
4. **Fit-suggestion acceptance margin.** `FIT_ACCEPT_MARGIN = 15` in
   `app/api/cross-project-fit/route.ts` — confirm a candidate scoring, say, 12 points above a
   project's threshold is correctly REJECTED as a suggestion (not just ones scoring way above).
   Off-by-one/boundary errors on `>=` vs `>` are the likely failure mode here.
5. **"Never recompute" contracts** — there are now TWO of these (Tier 2's `gate1_fit_suggestion`,
   and today's `suggested_role_fits` lazy generation). For each, open the same candidate 3 times
   in a row and confirm zero new Claude calls fire after the first (check server logs / Network
   tab, not just that the UI looks right).
6. **Blacklist/rejection-history suppression** — upload a resume matching a blacklisted or
   previously-rejected candidate, confirm the warning fires BEFORE scoring (pre-score check), not
   just as an after-the-fact banner.
7. **Do-not-touch file integrity** — `git diff --ignore-space-at-eol -b -w lib/scoreCandidate.ts
   lib/analyzeJD.ts lib/parseResume.ts lib/calibrationExamples.ts app/api/screen-resumes/route.ts
   app/api/screenings/save-one/route.ts` against `origin/main` — confirm every changed line in the
   two files with real diffs (`scoreCandidate.ts`, `screen-resumes/route.ts`) carries a
   `DO-NOT-TOUCH EXCEPTION` comment, and that nothing else moved.
8. **The just-built Archive Fits → Gate 1 wiring** — run an actual Archive Fits "Screen" decision
   against a checklist-gated project with a candidate who should fail the checklist. Confirm they
   land as `gate1Only`, not a real score, in the destination project.

Report each as PASS/FAIL/PARTIAL with what you actually did to check it — not "looks correct in
the code," actually exercised it against the real app wherever practical, same standard as your
last verification pass.

---

## Part 2 — Full-system read + maintainability audit (static, no live access needed)

Read broadly, not just the files you already know from prior handoffs. Look specifically for:

1. **Duplicated Gate 1 branching logic — I already know this exists, confirm the extent and
   assess.** The "evaluate checklist → check against threshold → either build a gate1Only
   stand-in or fall through to real scoring" pattern now exists in THREE places:
   `app/api/screen-resumes/route.ts` (do-not-touch, the original), `app/api/cross-project-fit/
   route.ts` (Tier 2's pre-filter, similar but not identical — only checks the threshold, doesn't
   build a stand-in result), and `app/api/projects/[id]/archive-fits/[screeningId]/decide/
   route.ts` (today's fix, closest to a straight copy of the original). Assess whether this is
   worth extracting into a shared `lib/` helper the do-not-touch file could call (same precedent
   as `evaluateChecklist`/`buildGate1ArchivedResult` already being separate lib files it calls) —
   and if so, what the do-not-touch exception for that specific call-site change would need to say.
2. **How many distinct "suggest a better fit" mechanisms exist now, and do they overlap
   confusingly.** Count them: the live in-session `onFindBetterFit`/`onCheckCrossProjectPromise`
   (resumeFile-based), Tier 2's lazy `screeningId`-based fit-suggestion (same route, second input
   mode), Archive Fits' `suggested_role_fits`/`generateRoleFit` (JD-independent), and the Archive
   Fits matching QUEUE itself (`archive_fit_candidates`, matches `suggested_role_fits` against a
   NEW project's JD at creation time). Is a recruiter going to be able to tell these apart in the
   UI, or does this need a naming/labeling pass even if the underlying mechanisms stay separate?
3. **Deferred-migration column count and pattern repetition.** Count how many `NOT YET CONFIRMED
   RUN` deferred columns exist across `lib/screenings.ts` (the `updateScreening` params list is
   long). Is the boilerplate (isolated read function + conditional update line + doc comment
   citing the migration file) still the right tradeoff at this volume, or would a small shared
   helper reduce the repetition without weakening the "one bad migration can't take down a shared
   select" safety property that pattern exists for?
4. **`ResultCard.tsx`'s prop surface.** This component now accepts props for status, stage,
   archive reason, blacklist, name match, rejection history, credibility, fraud risk, cross-project
   fit (3 props), suggested role fits, checklist breakdown, notes, activity timeline... Is it still
   maintainable as one component, or has it grown into something that should split (e.g. a
   sub-component per "signal panel," composed by the parent)? Note real constraints before
   recommending a split: it's used in 3 different contexts (live Screen tab, `/candidates/[id]`,
   batch page) with different prop subsets available in each — any split needs to preserve that.
5. **Dead/orphaned code, whole repo** — not just this session's additions. Grep for anything with
   zero importers. Flag, don't delete (same as every prior audit this project has done).
6. **Test coverage gaps** — which pure, deterministic functions in `lib/` have no
   `test_*.mjs` counterpart? Prioritize ones that gate real decisions (score/archive/suppress),
   not display-only formatting helpers.
7. **Any other business rule that's drifted or been duplicated inconsistently** — e.g. is
   `scoreThreshold`'s default (45) hardcoded in more than one place and could drift out of sync;
   is the ~2-month date-rounding tolerance (`lib/matchTrajectoryEntries.ts`,
   `lib/detectEmploymentGaps.ts`) the same number everywhere it should be. You know this codebase
   better than this prompt can enumerate — use judgment on what else fits this category.

## Report format

One document, two sections matching the two parts above. Part 1: a table or list,
PASS/FAIL/PARTIAL + what you did to verify. Part 2: findings grouped by severity/effort
(quick win vs. real refactor vs. needs Vlad's product judgment, not just a technical call) — for
each, what it costs to leave as-is vs. what fixing it would involve, not just "this could be
cleaner." Vlad picks what to act on from there.
