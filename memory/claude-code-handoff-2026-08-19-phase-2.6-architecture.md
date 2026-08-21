# Phase 2.6 — File-Level Architecture & Execution Plan

Written 2026-08-19 (Cowork), following Vlad's ask to "architecture the update around existing
code, make a plan for execution, delete unused code, run three checks." This is the technical
companion to `Cirot_Roadmap.md`'s Phase 2.6 table and `decisions-log.md`'s two 2026-08-19
entries — those say WHAT was decided, this says HOW it plugs into the actual code, file by file,
with exact current line numbers (verified live against the repo this session, not assumed).

**Nothing in this document has been built.** This is the plan Claude Code (or a future session
with real build/verify access) should follow. Every piece below was checked against a fresh
read of the real file it touches — see the "ground truth" pass earlier in this session's
transcript for the raw findings this plan is built from.

**Three-check framework applied per tier:** (1) Prediction — what happens when this ships.
(2) Architectural integration — does it fit the existing patterns, or fight them. (3) Evaluation
— does it actually solve the problem it was built for, and what's the honest remaining risk.

---

## Dead code — handled this session, not deferred

Confirmed via full-repo grep (not guessed): `app/api/generate-question/route.ts` had zero
callers anywhere and was a real, live, functional Claude-calling route — stubbed to a 410
(this session, matches the `compare-resumes` pattern already in the codebase). `app/api/compare-
resumes/route.ts`, `lib/compareResumes.ts`, `app/compare/page.tsx`,
`app/compare/[screeningId]/page.tsx` were already inert stubs, confirmed still dead. **None of
the 5 files could actually be `rm`'d from this sandbox** — same permission block already
documented for `better-fit-matches` in `open-questions.md` (2026-07-29). `tsc --noEmit` clean
before and after. **Needs a real machine:** `rm -rf app/compare app/api/compare-resumes
app/api/generate-question lib/compareResumes.ts`.

Also confirmed: the two other previously-flagged dead routes (`regenerate-trajectories`,
`better-fit-matches`) are **already gone** — someone with real delete access removed them
between sessions. `open-questions.md` updated to stop flagging them.

---

## TIER 1 — Gate 1 → Gate 2 pipeline wiring

**Files touched:** `lib/types.ts`, `lib/generateChecklist.ts`, `app/api/screen-resumes/route.ts`,
`lib/screenings.ts` (`saveScreening`, L754-1317).

### 1. `lib/types.ts` — `ChecklistItem` (L1040-1055)
Add `tier: "must-have" | "nice-to-have"`. Additive field, no migration needed for already-stored
checklists (old rows just won't have it — display code should treat a missing tier as
`"nice-to-have"` rather than crash, same graceful-degradation convention this codebase already
uses everywhere for deferred columns).

### 2. `lib/generateChecklist.ts` — `CHECKLIST_TOOL` (L30-58) + `generateChecklist()` (L60-105)
Schema gains `tier` per item (enum, required). Prompt instruction: derive tier from whether the
item came from a must-have or nice-to-have JD signal (the model already implicitly does this via
the points range 8-15 vs 3-8 — making it an explicit field just surfaces what the model is
already reasoning about, not a new judgment). Display code (Filters tab, not yet located this
session — grep for the "Regenerate from JD" button, likely `FilterSetView` per earlier memory
references) sorts must-have first.

### 3. `app/api/screen-resumes/route.ts` — restructure `score()` (currently L222-360)
**This is the actual gate.** Today, `evaluateChecklist()` is the third leg of a `Promise.all`
alongside `scoreCandidate()`/`generateFingerprint()` (L247-267) — all three always run together.
New shape:

```
async function score(resume) {
  try {
    let checklistEvaluation = null, gate1Only = false, result, fingerprint = null;

    if (checklist) {
      checklistEvaluation = await evaluateChecklist({ resumeText: resume.text, checklist })
        .catch(err => { console.error(...); return null; });
      const checklistScore = checklistEvaluation
        ? computeChecklistPercentageScore(checklistEvaluation.results) : null;
      if (checklistScore !== null && checklistScore < scoreThreshold) {
        gate1Only = true;
        result = await buildGate1ArchivedResult(resume, checklistScore); // new helper, see below
      }
    }

    if (!gate1Only) {
      const [scoreResult, fp] = await Promise.all([
        scoreCandidate(jobDescription, resume.fileName, resume.text, calibrationExamples,
          roleContext, linkedInContext, linkedInModeOverride),
        generateFingerprint(resume.text).catch(err => { console.error(...); return null; }),
        // checklist already evaluated above when it exists — no third parallel call anymore
      ]);
      result = scoreResult;
      fingerprint = fp;
    }
    // gate1Only branch: fingerprint stays null — Tier 2 decision, see below

    results.push(result);
    const { id } = await saveScreening({ ...same params as today..., checklistEvaluation,
      gate1Only, fingerprint });
    result.id = id;

    if (!gate1Only) {
      // embedding generation stays exactly as today, gated on !gate1Only —
      // buildCandidateEmbeddingText would have nothing meaningful to embed for a
      // gate-1-archived candidate (no summary/strengths/concerns), so skip it entirely
      // rather than generate a near-empty embedding that pollutes talent search.
    }
  } catch (error) { ...unchanged... }
}
```

**Gap resolved (checked the actual file, 2026-08-19 later) — `buildGate1ArchivedResult()`'s
`candidateName`.** `lib/extractCandidateNameFallback.ts`'s `extractCandidateNameFromPdf()` is
confirmed genuinely PDF-only — it sends a raw PDF as an Anthropic `document` content block,
hardcoded `media_type: "application/pdf"`. It solves a different, narrower problem (some PDF
exports, confirmed Google Docs specifically, hide the header text layer even though it's visibly
there) and doesn't apply to `.docx` at all. **Not the right reuse for this case anyway** — a
gate-1-only candidate already has `resume.text` (plain-text extraction ran for every file type
before Gate 1 evaluates the checklist), and ordinary text extraction reliably includes the name
for both PDF and DOCX in the normal case; the PDF-vision fallback exists for the rare exception,
not the default path. **Right answer: one small new text-based name-extraction call** (or a
cheap regex/heuristic over the first few lines of `resume.text` — worth trying regex first since
this is a purely-cosmetic archived-card label, not a scored field) — falling back to
`extractCandidateNameFromPdf()` only in the rare case the file is a PDF and even that comes up
empty, same `looksLikeMissingName()` gate already used elsewhere.

The rest of `buildGate1ArchivedResult()`: `score = checklistScore`, `mustHaveScore`/
`niceHaveScore` = not meaningful here, leave `0` or mirror `score` (cosmetic only, this codebase
already treats these as JD-fit sub-scores that don't apply to a checklist-only outcome — a UI
consideration for the simplified archived card, not a scoring one), `summary`/`strengths`/
`concerns`/`careerTrajectory` = empty (the archived-card UI decided earlier this session branches
on `gate1Only` to show the matched/unmatched checklist list instead of these fields, so empty is
correct, not a placeholder to fill in later), `trajectoryEntries` = `[]` (no Gate 4 graph data
for a candidate who never got read for it), `recommendation = "decline"` (below-threshold is
definitionally not a proceed).

### 4. `lib/screenings.ts` — `saveScreening()`, the override at L959-979
**Today:** `if (checklistEvaluation) { result.score = computeChecklistPercentageScore(...) }` —
unconditional override whenever a checklist evaluation exists, which is exactly the 2026-08-17
"checklist IS the score" behavior this phase reverses.

**New:** gate the override on the new `gate1Only` param, not just on `checklistEvaluation`'s
presence:
```ts
if (checklistEvaluation && params.gate1Only) {
  result.score = computeChecklistPercentageScore(checklistEvaluation.results) ?? result.score;
  result.checklistEvaluation = checklistEvaluation;
} else if (checklistEvaluation) {
  // Gate 1 passed — checklist data still attaches to the candidate (still needed for
  // Tier 4's graph, still needed for the Filters-tab evidence display) but no longer
  // touches result.score, which is scoreCandidate()'s real judgment now.
  result.checklistEvaluation = checklistEvaluation;
}
```
One-line-of-logic change, not a rewrite — the existing auto-archive status check just below
(L1016-1018, comparing `result.score` against `scoreThreshold`) needs **zero changes**: for a
`gate1Only` candidate, `result.score` is already the checklist percentage, which is by
definition below `scoreThreshold` (that's the only way `gate1Only` became true), so the existing
comparison naturally archives them without any special-casing. Good sign this integrates
cleanly rather than fighting the existing code.

**`app/api/history/[id]/rescreen/route.ts` — known recurring gap, check before shipping.**
Per `decisions-log.md`'s 2026-08-17 entry, this route calls `scoreCandidate()` directly and
bypasses `saveScreening()` entirely, so it's missed every checklist-related change so far. It
will miss this one too unless explicitly updated — same class of gap as before, flag it in the
PR rather than let it silently drift again.

### Tier 1 — three checks
1. **Prediction:** a checklist-configured project's gate-1 failures get archived after one Claude
   call instead of three-to-four; gate-1 passes behave exactly as today except their score is no
   longer overridden by the checklist. Non-checklist projects: zero behavior change.
2. **Integration:** additive — one new type field, one new route-level branch, one new boolean
   param threaded through an existing function, one new helper file. `scoreCandidate.ts`
   untouched. Existing auto-archive logic reused without modification, which is the strongest
   signal this is a clean fit rather than a bolt-on.
3. **Evaluation:** solves the stated cost problem, but only for projects that actually have a
   checklist configured — a project with no checklist gets zero savings, exactly as already
   flagged in the roadmap's Tier 5 dependency note. The one real open risk is
   `buildGate1ArchivedResult`'s name-extraction path for non-PDF resumes — worth resolving before
   this ships, not after.

---

## TIER 2 — Fingerprint skip + lazy fit-suggestion

### Fingerprint skip
Falls out of Tier 1's restructuring for free — the `gate1Only` branch simply never calls
`generateFingerprint()`. The free `resume_content_hash` dedup check is unaffected either way: it
already runs inside `saveScreening()`'s resume-upload path in its own try/catch, independent of
the AI fingerprint call (2026-07-17 fix, per `session-log.md`) — so gate-1-only candidates still
get free exact-duplicate detection automatically, no extra wiring needed.

### Lazy fit-suggestion — real integration gap found
The existing live feature (`app/api/cross-project-fit/route.ts`) is **not** actually reusable
as-is for an archived candidate viewed later. Per this session's earlier investigation into how
it currently works: it re-extracts resume text from the **browser-held `File` object still in
memory from that upload session** — it has no path that accepts a `screeningId` and reads
already-stored resume text from the database. That's fine for triggering it live during a
screening session; it does not work for "recruiter opens an archived candidate three days later"
at all — there's no `File` object anymore.

**Fix:** extend `POST /api/cross-project-fit` to accept either the existing `File`-based input
(unchanged, live-session path) or a `screeningId` (new path). For the new path, reuse
`getScreeningResume(screeningId)` — already a proven function, currently used by the now-stubbed
`generate-question` route to pull a stored resume back out for exactly this kind of "I need this
candidate's resume text again, later" situation. Feed that through the same
`extractResumeText()` → per-other-project `scoreCandidate()` loop the route already has
(`CONCURRENCY = 3`, L150-171), same `best`-match selection logic (L180-182, highest-scoring
project that clears its own threshold and beats `currentScore`). Trigger point: the archived
candidate's card, on mount/open, calls this with its `screeningId` instead of a `File`.

**Refinement, 2026-08-19 (later) — Vlad's ask: gate the fit-suggestion candidates through each
other project's OWN checklist first, not just its final score threshold.** Same "cheap check
before expensive read" philosophy as Gate 1/Gate 2 themselves, applied recursively here: for each
of the recruiter's other active projects, if that project has a checklist configured, run
`evaluateChecklist()` against it first (cheap) and drop any project the candidate wouldn't clear
that project's own threshold on — only run the real `scoreCandidate()` (expensive) for the
survivors, to rank them and confirm the actual best match. For an other-project with no checklist
configured, there's no cheap gate available — falls straight through to the existing full
`scoreCandidate()` call, same as before this refinement. **Honest limitation:** the cost savings
scale with how many of the recruiter's OTHER active projects actually have a checklist set up —
if most don't, this saves little over the original plan. Still strictly better than the original
plan (never worse, only reduces calls when a checklist exists to filter on).

**Second refinement, 2026-08-19 (later still) — quality bar: threshold + 15, not just threshold.**
Vlad's ask, resolved via 4 quick questions. A suggested project must now clear (that project's
own `scoreThreshold` + a flat `+15`, same magnitude for every project, not configurable) on the
real `scoreCandidate()` score — this **replaces** the existing "must beat current score" rule
entirely (a candidate can be suggested for a project they'd score lower on than the one they
just failed, as long as they clear that project's bar with real margin). Applies to **both** the
new lazy archived-candidate flow and the existing live in-session Cross-Project Fit feature —
same underlying logic, one consistent bar either way. The checklist pre-filter (previous
refinement above) stays permissive — only clears that project's own threshold, no +15 added
there — the buffer only gates the final real-score comparison that actually picks the
suggestion, not the cheap filtering pass before it.

### Tier 2 — three checks
1. **Prediction:** opening an archived candidate for the first time fires a small burst of
   `scoreCandidate()` calls (one per the recruiter's other active projects, 3-at-a-time), then
   caches/persists the result so re-opening doesn't re-trigger it. Never-opened candidates cost
   nothing.
2. **Integration:** extends one existing route with an alternate input source rather than
   building a parallel one — reuses `getScreeningResume`, a function already proven in
   (now-dead) code elsewhere in this exact codebase. Clean reuse, not a new pattern.
3. **Evaluation:** matches the confirmed "single best match, on open" design exactly. **Resolved,
   2026-08-19 (later): persist, don't recompute.** Computed once on first open, stored, never
   re-run on subsequent opens of the same candidate — needs a new column/field on the screening
   row, similar shape to the existing `suggested_role_fits` mechanism (`lib/generateRoleFit.ts`)
   but sourced from this new lazy computation instead. A future rescreen or a real change to the
   recruiter's active project list could theoretically stale this, but that's an acceptable,
   low-stakes tradeoff for a suggestion feature, not worth invalidation logic now.

### Tier 2 — BUILT, 2026-08-20
Matches this plan almost exactly, plus two things found and fixed during the build, not
anticipated here:
1. **Persist-then-respond, not persist-at-the-end.** This plan's design ("computed once, stored")
   didn't specify WHERE in the route persistence happens. A first pass persisted only at the
   final `return` — which silently broke the "never recompute" guarantee for a candidate with
   zero eligible other projects (the two early-return branches for "no other active projects" /
   "already screened everywhere" skipped the write). Fixed with a `respond()` helper used at
   every successful exit.
2. **`lib/toCandidateResult.ts` was silently dropping `checklistEvaluation`.** Unrelated to this
   tier's own scope, found while wiring the UI onto `/candidates/[id]` (the natural home for
   "recruiter opens the card" on a persisted, reopened record) — `isGate1OnlyResult()` always read
   false there, so Tier 1's archived-checklist-breakdown card never actually rendered outside the
   same-session live results view. One-line fix, see `decisions-log.md`.

Migration `supabase-migration-gate1-fit-suggestion.sql` written, NOT YET RUN. `tsc` clean, all 9
test files pass, do-not-touch diff clean except the already-flagged Tier 1 exception on
`screen-resumes/route.ts`. `onTransferToProject` deliberately not wired on `/candidates/[id]` yet
— needs a `screeningId` path added to `app/api/screenings/save-one/route.ts` (do-not-touch),
real follow-up, not silent. Not live-tested (no live Anthropic/Supabase access from this sandbox).

---

## TIER 3 — Independent small fixes

### Regenerate-checklist warning — built 2026-08-19 (later still)
**Correction to this doc's own earlier guess:** the checklist UI is NOT `components/
FilterSetView.tsx` (that file is the LinkedIn Keywords/Job Titles boolean-search card, unrelated)
— it's inline in `app/projects/[id]/page.tsx`'s `FiltersTab` function (~L100-568). Built: the
regenerate-confirm banner now lists every current item's label before replacing them, instead of
a generic one-liner. Confirmed target companies were never at risk either way (separate feature,
separate card on the same tab) — noted in the UI copy's surrounding comment, not a user-facing
callout, since there was never anything to warn about there.

### Target-company alias matching
`lib/targetCompanyBoost.ts`'s `computeTargetCompanyBoost()` (L33+) does a plain
`resumeText.toLowerCase().includes(company.toLowerCase())` check (L42-50). Swap in
`companiesLooselyMatch` (`lib/matchTrajectoryEntries.ts`, already exported, already proven in
production for trajectory-role pairing) — but note the shapes don't match directly:
`companiesLooselyMatch` compares two company-name strings against each other, while
`computeTargetCompanyBoost` currently does a raw substring scan of the ENTIRE resume text. Real
integration decision needed: either (a) extract candidate company names first (would need
`trajectoryEntries`, which doesn't exist at the point this boost currently runs — check call
order in `saveScreening`), or (b) keep the substring scan but loosen it — strip common legal
suffixes (`LLC`, `Inc`, `Corp`) from both the target company list and comparison, which gets
most of the "Google" vs "Google LLC" win without needing structured entries at all. **(b) is the
smaller, more contained change and doesn't introduce an ordering dependency on trajectoryEntries
existing yet** — recommend it over trying to force-fit `companiesLooselyMatch` verbatim.

### Tier 3 — three checks
1. **Prediction:** more target-company matches get caught (suffix variants), regenerate gets a
   real confirmation instead of a blind one-liner. Neither changes anything else.
2. **Integration:** both are small, self-contained, no dependency on Tiers 1/2/4.
3. **Evaluation:** solves both stated problems. The alias-matching approach needed a real design
   correction mid-plan (see above) — worth having caught before building the wrong thing.

---

## TIER 4 — Trajectory graph redesign

**Files touched:** `lib/scoreCandidate.ts` (do-not-touch, new exception), `lib/types.ts`
(`TrajectoryEntry`), `lib/assessCredibility.ts` (`TRAJECTORY_EXTRACTION_TOOL`), a new pure
gap-detection module, `components/TrajectoryGraph.tsx`.

### 1. `lib/types.ts` — `TrajectoryEntry` (L145-153)
Add `stepDirection?: "up" | "down" | "lateral" | "first"` and `stepReasoning?: string` (short,
one-sentence — same "reasoning before verdict" pattern already used everywhere else in this
codebase's structured outputs, e.g. `evaluateChecklist.ts`'s per-item `reasoning` field).

### 2. `lib/scoreCandidate.ts` — new do-not-touch exception
`SCORE_TOOL`'s `trajectoryEntries` array item schema gains the same two fields, judged from
title + experience + responsibilities relative to the previous entry (per this session's direct
confirmation). Same shape/precedent as the 2026-08-17 `trajectoryEntries` exception itself — an
additive field on an existing array item, zero cost, zero required-field disruption. First entry
in the array (earliest role) gets `stepDirection: "first"` — nothing before it to compare
against, matches this session's explicit "starts clean, no marker" decision.

### 3. `lib/assessCredibility.ts` — `TRAJECTORY_EXTRACTION_TOOL` (L195-221), `TRAJECTORY_ENTRY_ITEM_SCHEMA`
**Must gain the identical two fields** — this is the real, previously-unconfirmed requirement
(Phase 2.6.9) that the cross-reference line only works as "a full second trajectory on the same
axis" if its own extraction produces the same `stepDirection` judgment the resume side gets.
**These two schemas (this file's and `scoreCandidate.ts`'s) cannot share code** —
`scoreCandidate.ts` is do-not-touch and doesn't import from feature files, so the field
definition and prompt wording need to be kept in sync by convention/comment cross-reference
(each file should comment "keep this field's wording in sync with the twin definition in
[other file]"), not by a shared import. Real, ongoing maintenance cost worth naming plainly
rather than glossing over.

### 4. New pure function — employment-gap detection
No AI cost. Reuses `parseYearMonth`/`toMonthRange`, already exported from
`lib/matchTrajectoryEntries.ts` (L28-56) specifically for this kind of date math — another clean
reuse point, not a new date-parsing implementation. Given a chronologically-sorted
`TrajectoryEntry[]`, returns which consecutive-role transitions have a real gap (end of role N to
start of role N+1 beyond some threshold — 1-2 months, matching the existing "date rounding"
tolerance already used elsewhere in `assessCredibility.ts`'s severity rules, for consistency).
Unit-testable in isolation, same convention as this codebase's other pure functions
(`attributeChecklistToRoles.ts`, `matchTrajectoryEntries.ts` both have real test files already).

### 5. `components/TrajectoryGraph.tsx` rebuild (7th revision this project)
**Good news for integration risk:** the existing overlap/divergence/amber-ring SVG rendering
(L256-287, confirmed current and untouched since 2026-08-18) does not need to change. What
changes is only the Y-value computation feeding it — today that's `rolePoints` (checklist
points); the replacement derives a per-role position from `stepDirection` (accumulate: up = +1,
lateral = 0, down = −1, first = baseline 0) combined with the gap-detection output from #4 above
(a real gap forces a dip regardless of what `stepDirection` said, since a gap is a harder, more
objective signal). Secondary (cross-reference) line: identical computation run against the
cross-reference's own `trajectoryEntries` (now carrying `stepDirection` too, per #3) — genuinely
plotted the same way, which is exactly why it can genuinely overlap when the two agree instead
of needing a fake offset.

New: hover/click detail per point. Needs a small data-assembly step per point — role title/dates
(already available), which checklist items fired there (`attributeChecklistPointsToRoles`,
already built and exported, just no longer drives Y), and `stepReasoning` from #1/#2 above.

### Tier 4 — three checks
1. **Prediction:** the graph looks and behaves exactly as specced in this session's
   back-and-forth — trajectory-direction shape, real gaps as dips, cross-ref line
   overlapping/diverging genuinely, hover detail on every point.
2. **Integration:** touches one do-not-touch file (small, precedented addition), one schema that
   must be kept in sync by hand across two files (real ongoing cost, flagged not hidden), one new
   pure/testable module reusing existing date-math helpers, and a rendering component whose
   actual SVG logic is reused unchanged — only its data-transform layer is replaced. This is a
   contained change relative to how big the visual redesign sounds.
3. **Evaluation:** solves "how does it decrease" with two objective signals instead of a vague
   heuristic, and solves the cross-reference line's meaning without inventing a new visual
   language (reuses 2026-08-18's proven rendering). Real remaining risk, worth testing for
   specifically once built: model consistency of `stepDirection` judgments between the two

### Tier 4 — BUILT, 2026-08-20
Matches this plan closely, with a few real deviations found and made during the build, not
silently:
1. **The SVG rendering needed more than a Y-value swap.** The plan said the overlap/divergence/
   amber-ring logic "does not need to change." True for the amber-ring/overlap mechanism itself,
   but the Y-scale math did need generalizing — `yForSvg` used to assume a fixed `0..maxPoints`
   range (checklist points are never negative); trajectory-direction values genuinely go negative
   (a "down" step), so the scale is now a signed `minY..maxY` range with the baseline (value 0)
   drawn at its own computed position instead of assumed to sit at `CHART_BOTTOM`.
2. **The old Gantt-duration-bar fallback rendering was removed, not just left unreachable.**
   That branch only ever rendered when `rolePoints` was absent (no checklist configured); the
   redesign has no `rolePoints`-equivalent gate anymore — the trajectory-direction chart renders
   unconditionally whenever `entries.length > 0`, same as the early-return guard already at the
   top of the component. Leaving ~55 lines of now-100%-dead code in the file would have
   contradicted this session's own earlier "delete code that isn't being used" standing
   instruction, so it came out.
3. **"Which checklist items fired" needed a new function, not the existing one.**
   `attributeChecklistPointsToRoles` (already unit-tested, still used nowhere near this rebuild)
   only ever returned a point SUM per role — hover/click detail needs the actual fired item
   labels. Added a sibling, `attributeChecklistItemsToRoles`, rather than changing the existing
   function's return shape and risking its own test/call site.
4. **Click interactivity implemented as a small toggleable detail panel below the chart**, not a
   popover/modal — simplest thing that satisfies "click for detail" without a new UI subsystem,
   and works on touch devices where hover tooltips don't (native `<title>` still covers hover).

`tsc --noEmit` clean (including a `--noUnusedLocals --noUnusedParameters` pass). 13 unit tests for
the new `computeTrajectoryValues` accumulation logic (`test_trajectory_values.mjs`) plus 14 for
the gap-detection module (`test_employment_gaps.mjs`), all 11 test files in the repo pass. Do-not-
touch diff: `scoreCandidate.ts` now shows a real, flagged diff (the new do-not-touch exception for
`stepDirection`/`stepReasoning`) alongside the already-flagged `screen-resumes/route.ts` from
Tier 1 — both expected, both carry the required exception comment. **Not live-tested** (no real
Anthropic/Supabase access from this sandbox) — real risk worth calling out again from the original
plan: model consistency of `stepDirection` judgments between the resume-side call
(`scoreCandidate.ts`) and the cross-reference-side call (`assessCredibility.ts`) has never been
observed against a live API run.
   independently-worded (but supposedly-synced) schemas in different files — a real place for
   silent drift if the two comments asking for sync wording aren't actually kept up over time.

---

## Suggested build order

Tier 1 first (foundational, biggest, everything else in Tiers 2/4 either depends on it or is
independent of it anyway). Tier 3 can happen in parallel with anything — zero dependencies. Tier
2 after Tier 1 (needs `gate1Only` to exist). Tier 4 is fully independent of Tiers 1-3 and could
be built in parallel by someone else, but shares the do-not-touch-exception review step with
Tier 1's `scoreCandidate.ts`-adjacent work if the same PR reviewer is doing both.

**Before any of this ships:** resolve the two flagged open items — `buildGate1ArchivedResult`'s
name-extraction path for non-PDF resumes (Tier 1), and whether the lazy fit-suggestion persists
or recomputes on every open (Tier 2). Neither blocks starting the work, both need an answer
before merge.
