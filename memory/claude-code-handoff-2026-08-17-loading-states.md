# Claude Code handoff — commit loading-state work + bugfix onto `feat/jd-checklist`

Paste this whole file as your prompt.

## Context

You already committed the JD checklist feature to `feat/jd-checklist` (commit `4f598d7`) and pushed it. Since then, two more rounds of real work landed in the same working tree, still uncommitted:

1. **A real bug fix.** The checklist commit's `app/api/projects/[id]/route.ts` change let a checklist read throw all the way out of the route's try/catch whenever the migration hadn't run — which 500'd the route for EVERY project, not just checklist-related requests, and the frontend renders any error response as "Role not found." Fixed: that read now degrades to `null` on any error instead of taking the whole route down.
2. **`ScoringLoader` wired into every remaining wait state**, then resized larger per Vlad's direct feedback. Vlad's ask was explicit: "make sure that loading part shows EVERYWHERE it takes time to load." Every remaining `animate-spin` in the app (confirmed via repo-wide grep, zero left) was replaced with `ScoringLoader`, then every instance was sized up (~30% bigger for page-level loaders, roughly doubled width for inline/button ones) after Vlad said the first pass looked too small. Also added a `stroke` prop to `ScoringLoader` itself (`components/ScoringLoader.tsx`) — needed because a couple of these sit on colored buttons (white text on violet gradient / dark background) where the hardcoded Cirot blue was invisible.

**Task: commit both onto `feat/jd-checklist` and push — same branch, no new branch, no merge into `main` (that still depends on `feat/target-company-boost-trajectory-restructure-and-cirot-rebrand` merging first, per the last handoff).**

## Important — the working tree has unrelated pre-existing dirty content, again

Same situation as the last handoff: `git status` will show far more than these two changes. Confirmed via `git diff --ignore-space-at-eol -b -w --stat HEAD` that the following files carry changes that are **NOT part of this round** and must stay uncommitted:
- `app/funnelview/page.tsx`, `lib/funnelview/data.ts`, `lib/funnelview/types.ts`, `lib/scoreCandidate.ts` — an older, separate "Signals export" feature (FunnelView column rename + a `scoreCandidate.ts` do-not-touch exception for strengths-ordering) that predates even the checklist work and was never committed. Real, Vlad-approved work — just not this commit's scope.
- `memory/decisions-log.md`, `supabase/migrations/supabase-migration-blacklist.sql` — unrelated doc/migration edits, already flagged as out-of-scope in the last handoff too.
- `components/StatusStageControl.tsx` — an unrelated link fix, not touched this round.
- **`components/TransferControl.tsx` is MIXED** — it carries that same unrelated link fix AND this round's `ScoringLoader` wiring, in the same file. Do not commit the whole file's diff blind. Only stage the hunks that add `import { ScoringLoader } from "@/components/ScoringLoader"` and the `<ScoringLoader .../>` JSX insertions (there are 6: the precheck-loading state, the preview-loading state, the previewReady+committing state, and the "Transfer to that result" button's committing state). Use `git diff components/TransferControl.tsx` and `git add -p` (or equivalent) to separate them — everything else in that file's diff is the older unrelated fix, leave it staged-out/uncommitted.

## Exact scope of this commit

Files to commit in full (every change in these is from this round, safe to stage entirely):
```
app/api/projects/[id]/route.ts        (bugfix — checklist read degrades to null instead of throwing)
app/candidates/[id]/page.tsx          (ScoringLoader on page load)
app/candidates/page.tsx               (ScoringLoader on page load)
app/projects/[id]/batches/[batchId]/page.tsx   (ScoringLoader on page load)
app/projects/[id]/page.tsx            (ScoringLoader: main page load + Rescreen button)
app/projects/page.tsx                 (ScoringLoader: JD file extracting, Create role saving, page load)
components/ActivityTimeline.tsx       (ScoringLoader on activity fetch)
components/CalibrationPanel.tsx       (ScoringLoader on calibration upload)
components/CredibilityChecker.tsx     (ScoringLoader: re-check overlay + re-run button)
components/FraudRiskChecker.tsx       (ScoringLoader: re-check overlay + re-run button)
components/InsightList.tsx            (ScoringLoader on "elaborate concern" link)
components/ResultCard.tsx             (ScoringLoader: cross-project-fit checking + fit-suggestion transfer button; also added the missing ScoringLoader import — it was used without being imported, would have failed to build)
components/ScoringLoader.tsx          (new `stroke` prop; every default size bumped up)
```

Files to partially stage (see above): `components/TransferControl.tsx`.

Verify before committing: `npx tsc --noEmit` clean (it was clean in the sandbox this was built in — re-confirm on your end since sandbox/real-environment behavior has differed before in this project). Run `npm run build` too if you can — the sandbox that built this has never been able to complete a real build.

## Commit message suggestion

```
Fix: checklist read on the main project GET route could 500 every project page when the migration hadn't run yet — now degrades to null.
Feat: loading animation (ScoringLoader) now covers every wait state in the app, not just screening/checklist-generation; sizes increased per feedback.
```

## After committing

Push to `feat/jd-checklist` (same remote branch, adds commits on top of `4f598d7`). No PR action needed beyond what the last handoff already covers — this just updates the existing branch before that PR gets reviewed/merged.
