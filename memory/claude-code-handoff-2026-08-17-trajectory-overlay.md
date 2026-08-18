# Claude Code handoff — verify, then commit the credibility trajectory overlay (roadmap 2.5.2) onto `feat/jd-checklist`

Same framing as every AI-call file handed off this project: built and unit-tested in a sandbox with zero network access to the real Anthropic API or Supabase, so the two new tool schemas have never actually executed and the migration has never actually run. **Verify both live before committing.**

## What this is

Full build of roadmap 2.5.2 (credibility trajectory overlay) — the design Vlad approved this session: rewrite the employment side of `assessCredibility.ts`'s comparison as a real structured diff + timeline graph, instead of one big AI call judging every field itself. Full reasoning trail: `memory/decisions-log.md`'s 2026-08-17 entry. File-by-file detail: `memory/session-log.md`'s matching entry.

**The core finding that shaped this build:** there was no structured per-role employment data anywhere in this codebase before today — `careerTrajectory` has only ever been freeform markdown prose. So this couldn't be a small change to `assessCredibility.ts` alone; it needed a new structured field generated at screening time first.

## What changed

New files:
```
lib/matchTrajectoryEntries.ts     — deterministic diff (pairing + field-diff detection), pure, zero AI cost. Also exports the CredibilityRow mapper and date-parsing helpers shared with the graph component.
lib/compareEducationYear.ts       — education year tolerance, moved from an AI-decided field to pure integer math (same rule, verbatim).
components/TrajectoryGraph.tsx    — hand-built CSS/div timeline (no chart library — this app has zero chart dependencies, ScoringLoader.tsx is the existing hand-rolled-SVG precedent).
supabase/migrations/supabase-migration-trajectory-entries.sql  — new `trajectory_entries jsonb` column on screenings.
test_trajectory_match.mjs         — 20/20 pass. Covers identity-based pairing, a deliberate date-fabrication case (same company/title, non-overlapping dates — this is exactly what a naive date-only pairing strategy would silently miss), staffing-agency variants, undisclosed employment, "present" handling.
test_education_year_compare.mjs   — 11/11 pass, matches the old CREDIBILITY_TOOL schema's own worked examples exactly.
```

Modified:
```
lib/scoreCandidate.ts             — DO-NOT-TOUCH EXCEPTION (2026-08-17, Vlad's explicit ask to proceed). New `trajectoryEntries` field on SCORE_TOOL, same call as careerTrajectory, zero extra AI cost. See that file's own comment block for the exact reasoning.
lib/types.ts                      — new TrajectoryEntry, TrajectoryComparisonRow types. CredibilityAssessment gets a new optional trajectoryComparison field; `rows` is now documented as education-only going forward (old assessments still have real employment rows there — backward compatible, nothing removed).
lib/screenings.ts                 — trajectoryEntries read/write, same deferred-column pattern as currentCompany/checklist_evaluation (folded into saveScreening()'s existing best-effort call, new isolated getScreeningTrajectoryEntries() reader).
lib/assessCredibility.ts          — big diff, purely ADDITIVE. New branch (assessCredibilityWithTrajectoryComparison) only runs when a cross-reference doc is provided AND the candidate already has stored trajectoryEntries. Every other case — no cross-ref at all, or a cross-ref but no stored trajectory (every existing candidate as of this migration) — falls straight through to the ORIGINAL single-call CREDIBILITY_TOOL flow, completely untouched. This is the part that most needs a live check: the new branch has two brand-new AI calls (TRAJECTORY_EXTRACTION_TOOL, TRAJECTORY_JUDGMENT_TOOL) that have never executed.
app/api/assess-credibility/route.ts — fetches the candidate's stored trajectoryEntries (getScreeningTrajectoryEntries) alongside the existing Promise.all, passes it through. Fails closed to null/undefined — same graceful degradation as every other deferred field.
components/CredibilitySection.tsx — additive. When assessment.trajectoryComparison is present, employment rows are mapped into the existing CredibilityRow shape and combined with the (now education-only) rows array — the Flags/Matches tabs, counts, and CredibilityRowItem rendering are UNCHANGED code, just fed a combined list. Old assessments render exactly as before. New TrajectoryGraph renders above the tabs only when there's at least one paired role.
```

## Do-not-touch check — two things in the same file, only one is mine

`lib/scoreCandidate.ts` carries TWO uncommitted do-not-touch exceptions right now, not one:
1. **2026-08-15** — `strengths` field description gained an ordering instruction ("list the strongest match first") for the FunnelView Signals export (roadmap 2.5.6). This was already sitting uncommitted in the working tree before this session started — real, Vlad-approved, just never committed. Not something I built or touched this round.
2. **2026-08-17** — the new `trajectoryEntries` field, this round's work.

Both are legitimate and should be committed together. Confirm `git diff -- lib/scoreCandidate.ts` shows ONLY these two additions (both clearly commented, dated, with their own reasoning) and nothing else. Every other do-not-touch file (`lib/analyzeJD.ts`, `lib/parseResume.ts`, `lib/calibrationExamples.ts`, `app/api/screen-resumes/route.ts`) should show zero real diff — if `git diff --stat` shows anything for those, run `git diff --ignore-space-at-eol -b -w --stat` too; this sandbox's mount has a known LF→CRLF artifact that makes whole files show as 100%-changed with zero actual content difference (confirmed present on `analyzeJD.ts`/`parseResume.ts`/`calibrationExamples.ts` as of this handoff — real code identical, just line endings).

## Before committing — live verification, in order

1. **Run the migration**: `supabase-migration-trajectory-entries.sql`. Confirm `trajectory_entries` column exists (`select column_name from information_schema.columns where table_name = 'screenings' and column_name = 'trajectory_entries';`).

2. **There is no backfill script for this column** (deliberately — see the migration file's own comment). Every existing candidate has `trajectory_entries: null` until rescreened. This means the new comparison flow (`assessCredibilityWithTrajectoryComparison`) CANNOT trigger against any existing candidate yet — you need at least one FRESH screening (or a rescreen of an existing candidate via the Rescreen button) to get real `trajectory_entries` data before the new code path can be exercised at all.

3. **Screen (or rescreen) one real resume.** Confirm in Supabase that the resulting row has a real, non-null `trajectory_entries` array shaped like `[{company, title, employmentType, startDate, endDate}, ...]` — this is the FIRST live confirmation that `scoreCandidate.ts`'s new schema field actually works (never executed against the real API before this).

4. **Run a real credibility check against that same candidate**, with a real cross-reference document (a second resume or LinkedIn PDF). This exercises the entire new path for the first time live:
   - The extraction call (`TRAJECTORY_EXTRACTION_TOOL`) — confirm it returns a real `crossRefTrajectoryEntries` array, not an empty/malformed one.
   - The deterministic diff — confirm `trajectoryComparison` in the response has a sensible number of rows (not obviously wrong, e.g. everything showing as "undisclosed" when the two documents clearly describe the same jobs — that would mean the pairing logic isn't matching correctly against real-world text variance).
   - The judgment call (`TRAJECTORY_JUDGMENT_TOOL`) — confirm `status`/`severity`/`note` values look reasonable on any flagged rows, and that `trajectoryNote`/`industryNote` are populated.
   - **Specifically check the row-index merge** (`assessCredibility.ts`'s `judgedIndex` loop, right after the `judgeTrajectoryComparison` call) — if a flagged row's final status/note look wrong or shifted relative to what you'd expect for that specific comparison, this positional merge is the first place to suspect. It was written and unit-tested in isolation but never run against a real model response.
   - Confirm the UI: `CredibilitySection` renders the new `TrajectoryGraph` above the tabs, and the Flags/Matches counts include both the education row (if any) and the mapped trajectory rows.

5. **Confirm the fallback path still works, unregressed.** Run a credibility check against an OLD candidate (one with `trajectory_entries: null` — any pre-2026-08-17 candidate). Confirm this produces the exact same output shape as before this change (real employment `rows`, no `trajectoryComparison` field, old Flags/Matches rendering) — this is the regression check that the additive branch didn't accidentally break the existing, already-proven flow.

6. **`npx tsc --noEmit` and `npm run build`** — clean in the sandbox, re-confirm on real infra.

## Files to commit

```
lib/scoreCandidate.ts                                          (modified — 2 do-not-touch exceptions, see above)
lib/types.ts
lib/screenings.ts
lib/assessCredibility.ts
lib/matchTrajectoryEntries.ts                                   (new)
lib/compareEducationYear.ts                                     (new)
components/TrajectoryGraph.tsx                                  (new)
components/CredibilitySection.tsx
app/api/assess-credibility/route.ts
supabase/migrations/supabase-migration-trajectory-entries.sql   (new)
test_trajectory_match.mjs                                       (new)
test_education_year_compare.mjs                                 (new)
memory/session-log.md
memory/Cirot_Roadmap.md
memory/decisions-log.md
memory/claude-code-handoff-2026-08-17-trajectory-overlay.md     (new — this file)
```

Same branch, `feat/jd-checklist`. No new branch, no merge to main.

## If something's wrong

This is the least-tested code shipped this project to date — two brand-new AI tool schemas, a new deterministic pairing algorithm running against real-world text variance for the first time, and a positional-index merge that's only ever been checked against hand-written test fixtures. If the extraction or judgment call returns something structurally unexpected (wrong field names, a shape `toolUse.input` doesn't match), or the pairing logic clearly mismatches real entries, that's a legitimate real bug to find and fix here — same as the embeddings/pgvector issues found and fixed in earlier passes today. Don't force a commit past a live failure; report it plainly, same as those rounds did.
