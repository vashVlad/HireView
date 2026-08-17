# Claude Code handoff — 2026-08-17 (JD checklist + accumulated uncommitted work)

Paste this whole file as your prompt to Claude Code. It supersedes any earlier incremental handoff prompt for this feature — this is the complete, current scope.

---

## Context

This is the Cirot recruiting app (`C:\Portfolio\HireView Production\HireView`). A Cowork session just built the JD checklist ("Trust badge") feature end-to-end in the working tree — real code, not a plan, but built in a sandbox with no live Supabase/Anthropic network access, so nothing below has been live-tested. Everything passed `npx tsc --noEmit` and every do-not-touch file was diff-checked clean (`git diff --ignore-space-at-eol -b -w`), but that's the ceiling of what could be verified without real access.

Full narrative: `memory/session-log.md`'s 2026-08-17 entry. Design rationale and one correction to an earlier plan: `memory/open-questions.md`'s 2026-08-17 entry.

## What you're verifying/finishing (in order)

### 1. Build verification
- `npm install`, `npx tsc --noEmit`, `npm run build` — all should be clean. Confirm before touching anything else.
- Confirm do-not-touch files are genuinely clean: `git diff --ignore-space-at-eol -b -w lib/scoreCandidate.ts lib/analyzeJD.ts lib/parseResume.ts lib/calibrationExamples.ts app/api/screen-resumes/route.ts`. Expect zero output on the first four, and only the two flagged JD-checklist additions on the fifth (a new import line and a new parallel `Promise.all` branch + a new `checklistEvaluation` param passthrough — both commented `DO-NOT-TOUCH EXCEPTION (2026-08-17...)`).

### 2. Run the migration, then live-test the checklist feature
The full migration list (today's + everything else still outstanding) is in `docs/Cirot-Supabase-Migrations-To-Run-2026-08-17.md` — **run `supabase-migration-checklist.sql` at minimum before testing anything below.** Whether to also run the older outstanding ones is Vlad's call — see that doc's notes on each.

Live-test checklist:
1. Open a project's Filters tab. Confirm the new "JD checklist" card renders below "Score boost companies," starts empty, "Generate checklist" button works and produces 5-12 items split across the two tabs.
2. Edit an item's label and points inline, confirm it saves on blur (check via reload that it persisted).
3. Add and remove an item in each tab.
4. Hit "Regenerate from JD," confirm the one-line warning appears and regeneration replaces every item.
5. Screen a resume against that project. Confirm the ResultCard shows a "Checklist ±N" badge (only if the net delta is nonzero) and, below Strengths/Concerns, a "Checklist" breakdown section listing only the fired items with their reasoning.
6. Reload the page (Pipeline tab) and confirm the checklist breakdown on that same candidate's card still shows — this is the part that specifically needed the isolated `attachChecklistEvaluations` read path (see the open-questions.md entry for why this one field couldn't follow the same pattern as `target_company_matches`/`current_company`).
7. Confirm a candidate's score actually reflects the checklist delta (compare the badge's stated delta against the visible score, and sanity-check against what the score would've been without it if you have a way to tell).
8. Confirm a project with NO checklist configured screens exactly as before — no badge, no breakdown, no behavior change. This is the most important regression check.

### 3. Wire the loading animation into the rest of its intended spots
`components/ScoringLoader.tsx` is a finished, unit-tested component (see `lib/evaluateChecklist.ts`'s sibling test `test_checklist_delta.mjs` and the component's own history in `memory/session-log.md`'s 2026-08-15 entries for the design rationale — two real animation bugs were found and fixed during prototyping, plus a third real bug caught by a unit test: points could clip outside the SVG's own viewBox after the loop-closing drift correction, now re-clamped). It's wired into exactly one spot so far (checklist generation, this session). Vlad's original ask covered every wait-state in the app that currently has no indicator or a generic one:
- Suggested role fit during new project creation (explicitly called out as having **no loading indicator at all** currently — check `app/projects/page.tsx`'s New Role modal flow).
- Cross-reference / credibility check (`components/CredibilityChecker.tsx`).
- Fraud risk check (`components/FraudRiskChecker.tsx`).
- Archive-fit checking (`app/api/projects/[id]/archive-fits/check/route.ts`'s caller in `app/projects/[id]/page.tsx`'s Settings tab).
- Main resume screening itself, if there's a sensible per-batch or per-file spot for it (check `ResumeUploader.tsx`/the Screen tab's existing progress UI first — don't duplicate an indicator that's already there, just upgrade it).

Use `<ScoringLoader className="h-6 w-40" />` (or size to fit) as a drop-in replacement for whatever spinner/text-only "loading" state exists in each spot — see the Filters tab's checklist-generation usage in `app/projects/[id]/page.tsx` as the reference implementation.

### 4. Dead code cleanup (blocked in the sandbox, needs your delete permission)
`app/api/screenings/regenerate-trajectories/route.ts` and `lib/generateTrajectory.ts` are confirmed orphaned — the "Regenerate trajectories" button that called this route was removed 2026-08-15 (FunnelView's trajectory fields now populate automatically at scoring time), and a repo-wide grep confirms `generateTrajectory` has no other importer. `tsc --noEmit` stays clean either way. Delete both files. Also `app/api/projects/[id]/better-fit-matches/route.ts` — flagged dead since 2026-07-29 (returns 410, superseded by Transfer), never deleted because of the same sandbox permission block. Safe to delete, low priority.

### 5. Commit, branch, PR
Working tree has substantial pre-existing uncommitted changes unrelated to this session (per `memory/state.md`'s history — this project has had a running "left uncommitted per standing instruction" backlog for weeks). **Scope your branch to just this session's real changes**, listed below — don't sweep up unrelated dirty-tree content into the same commit. New/modified files this session:
```
lib/generateChecklist.ts          (new)
lib/evaluateChecklist.ts          (new)
lib/types.ts                      (ChecklistItem/ProjectChecklist/ChecklistItemResult/ChecklistEvaluation + CandidateResult/ScreeningRecord/Project fields)
lib/projects.ts                   (getProjectChecklist/updateProjectChecklist)
lib/screenings.ts                 (checklist score-delta application, attachChecklistEvaluations, updateScreening field)
app/api/screen-resumes/route.ts   (do-not-touch exception — 3rd parallel call + passthrough)
app/api/projects/[id]/route.ts    (checklist merged into GET response)
app/api/projects/[id]/checklist/route.ts   (new — GET/POST/PATCH)
app/projects/[id]/page.tsx        (Filters tab checklist UI + props threading)
components/ResultCard.tsx         (checklist badge + breakdown)
supabase/migrations/supabase-migration-checklist.sql   (new)
memory/session-log.md, memory/open-questions.md, memory/Cirot_Roadmap.md   (doc updates)
```
Also flag but leave alone unless Vlad says otherwise: `test_checklist_delta.mjs` at repo root (plain-Node scratch verification script, not part of the app, safe to delete or keep — sandbox couldn't delete it either).

Branch name suggestion: `feat/jd-checklist`. Confirm `origin/main` is the right base (fetch first, check for drift same as prior handoffs in this project's history).

### 6. What's next after this (not in scope for this handoff, just context)
Two roadmap items were explicitly blocked on the checklist landing (see `memory/open-questions.md`'s 2026-08-14 entry): item 2 (trajectory overlay replacing the field-by-field credibility comparison) and item 5 stage 2 (archive-fit matching against `strengths[]`/`concerns[]` vs. the checklist). Both are now unblocked but not started — Vlad will scope the next session for these.
