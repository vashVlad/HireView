# Claude Code handoff — 2026-08-26 (Referred sourcing option + Share this batch button — verify, then merge)

Paste this whole file as your prompt to Claude Code.

This is a **verify, then commit/push — but HOLD on merging** task. If every check below passes, go
ahead and do the actual migration/commit/branch/push at the end without stopping to ask first. Open
a PR (or give me the compare-URL) and stop there. **Do not merge to `main` yet, even if everything
passes** — I want to read your feedback on the logic first (see below) and give an explicit go-ahead
before it merges. If something genuinely fails (not a soft/non-blocking finding — a real "this
doesn't work" result), stop, report it, and don't push either.

**Also: give me (Vlad) your own read on this before I decide on the merge** — not just PASS/FAIL.
Does the design make sense as built? Is there anything about the logic, the data model, or the UI
you'd do differently if you were building it from scratch? I want a real second opinion, not just
confirmation that it compiles and the tests pass. Put this in its own section of your report, not
buried in the step-by-step — this is what I'm waiting on before I say go/no-go on the merge.

---

## Context

This is the Cirot recruiting app (`C:\Portfolio\HireView Production\HireView`). Two independent,
unrelated pieces of work landed in the same Cowork session, both built but **not yet live-tested,
not yet migrated where relevant, and not yet committed**:

### 1. New "Referred" sourcing option (4th `SourceType`)

Full detail: `memory/decisions-log.md`'s newest 2026-08-26 entry (search for "New \"Referred\"
sourcing option"), plus the matching `memory/session-log.md` entry.

Vlad's ask: alongside the existing Applicant / LinkedIn / Agency source types, add a "Referred"
type — mirrors Agency's mechanism exactly (a name captured alongside the type), but for a person
who referred the candidate instead of an agency name. Also asked to remove the sourcing
description text ("— adjusts scoring for profile PDFs" / "— label only, scoring unaffected" /
"— default, no scoring adjustment") from the Screen tab's source picker.

Short version of what changed:

- `lib/sourceType.ts`: `SourceType` gained `"referred"`; `getSourceType()` checks `referrerName`
  after `agencyName` (agency wins if both are somehow set).
- `components/SourceIcon.tsx`: new teal (`#14B8A6`) two-person glyph icon.
- `lib/types.ts`: `referrerName?: string` added to both `CandidateResult` and `ScreeningRecord`.
- **New migration, NOT YET RUN:** `supabase/migrations/supabase-migration-referrer-name.sql` —
  `ALTER TABLE screenings ADD COLUMN IF NOT EXISTS referrer_name text;`
- Deliberately does NOT copy `agencyName`'s write mechanism verbatim. `agency_name` (2026-07-20)
  predates this codebase's deferred-column convention and is wired unconditionally into
  `saveScreening()`'s main INSERT. `referrer_name` instead follows the safer pattern already used
  for `linkedin_url`/`github_signal`/`target_company_matches`: a new isolated
  `attachReferrerNames()` fetch for reads (`lib/screenings.ts`), and a conditional write folded
  into `saveScreening()`'s existing best-effort `updateScreening()` call, not the main insert — so
  a not-yet-run migration doesn't need to be confirmed before this deploys; it just silently skips
  the field until it's run.
- Wired through both DO-NOT-TOUCH routes (`app/api/screen-resumes/route.ts`,
  `app/api/screenings/save-one/route.ts` — new flagged DO-NOT-TOUCH EXCEPTION blocks mirroring the
  existing `agencyName` ones), `lib/screenings.ts` (save/update/`transferScreeningToProject`'s
  copy path), `lib/toCandidateResult.ts`, and `app/api/history/[id]/route.ts`'s PATCH handler.
- **Every surface that already had an Agency picker got a Referred one too** (not just the Screen
  tab Vlad mentioned): the Screen tab's picker and the Pipeline tab's inline source-correction
  popover (both in `app/projects/[id]/page.tsx`), `app/candidates/page.tsx`'s own separate
  `CandidateCard` popover (a third, independent hand-rolled copy of this same picker — easy to
  miss), and `components/ResultCard.tsx`'s badge display.
- **FunnelView extended too**: `lib/funnelview/types.ts`, `lib/funnelview/data.ts`,
  `app/funnelview/page.tsx` — a 4th source bucket in the stacked funnel bar, legend, table badge,
  and Excel export, so referred candidates don't silently get counted as "Applied." `referrer_name`
  is fetched via the existing isolated per-column fetch helper (`fetchCurrentRoleColumn`, widened
  to accept the new column), not bundled into FunnelView's required select — same deferred-column
  safety reasoning as above.
- Screen tab source-picker description text removed entirely.

### 2. "Link to this batch" redesigned into a pure "Share this batch" button

Full detail: `memory/decisions-log.md`'s "2026-08-26 (latest)" entry.

Vlad's ask: "for the 'Link to this batch' button I'd like to have a share this batch button so I
can share it." The old button was a real `<Link>` (navigated to `/projects/[id]/batches/[batchId]`)
that *also* copied the URL to clipboard on click via its `onClick` — a confusing double-action.
Asked one clarifying question; Vlad chose to replace it outright with a pure copy-only button
(no navigation), restyled to match the app's existing per-candidate "Share link" pill pattern
(`rounded-full`/`bg-zinc-100`/clipboard-rect icon) instead of its old outline/chain-link style.
Only change: `app/projects/[id]/page.tsx` (`handleCopyBatchLink` unchanged, JSX swapped from
`<Link>` to `<button type="button">`).

### Files touched, this session, both pieces combined

New:
- `supabase/migrations/supabase-migration-referrer-name.sql`

Modified:
- `lib/sourceType.ts`, `lib/types.ts`, `components/SourceIcon.tsx`, `lib/screenings.ts`,
  `lib/toCandidateResult.ts`, `app/api/screen-resumes/route.ts` (DO-NOT-TOUCH),
  `app/api/screenings/save-one/route.ts` (DO-NOT-TOUCH), `app/api/history/[id]/route.ts`,
  `app/projects/[id]/page.tsx`, `app/candidates/page.tsx`, `components/ResultCard.tsx`,
  `lib/funnelview/types.ts`, `lib/funnelview/data.ts`, `app/funnelview/page.tsx`,
  `memory/decisions-log.md`, `memory/session-log.md`, `memory/state.md`

Nothing from any earlier, still-uncommitted round should be assumed already on `main` — check
`git log origin/main` before you start (see Step 6).

---

## Step 1 — Build, tests, do-not-touch diffs

- `npx tsc --noEmit -p .` — should be clean.
- `node test_*.mjs` for all 11 test files — should all pass unchanged (no new pure-function logic
  was added this round; everything here is UI + DB plumbing).
- `git diff --stat -w -- lib/scoreCandidate.ts lib/analyzeJD.ts lib/parseResume.ts
  lib/calibrationExamples.ts app/api/screen-resumes/route.ts app/api/screenings/save-one/route.ts`
  — confirm the only changes in the last two files are small, clearly-flagged DO-NOT-TOUCH
  EXCEPTION blocks mirroring the existing `agencyName` handling line-for-line (a `referrerName`
  form field read + passthrough to `saveScreening()`, nothing touching scoring logic).

## Step 2 — Run the new migration

`supabase/migrations/supabase-migration-referrer-name.sql` has NOT been run yet. Run it against
the real Supabase project (`ALTER TABLE screenings ADD COLUMN IF NOT EXISTS referrer_name text;`)
before live-testing Step 3 — without it, referrer names will silently fail to persist (by design,
fail-soft) and you won't be able to verify the feature actually works end to end.

## Step 3 — Live: "Referred" sourcing option

1. **Screen tab.** Open a project's Screen tab. Confirm the source picker now shows 4 buttons:
   Applicants / Sourced / Agency / Referred. Confirm the description line that used to sit under
   the buttons ("— adjusts scoring for profile PDFs" etc.) is gone entirely. Click "Referred" —
   confirm a "Referred by…" text input appears (teal focus ring), mirroring the Agency input.
   Type a name, upload and screen a resume. **Screenshot the result.**
2. Confirm the resulting `ResultCard` shows a teal person-icon badge with the referrer's name next
   to it, in the same spot the orange Agency badge would appear.
3. **Pipeline tab.** Find that same candidate in the Pipeline tab. Click the source icon on their
   card to open the correction popover. Confirm a 4th "Referred" option is selectable there too,
   pre-filled with the existing referrer name when reopened. Change it to a different name, save,
   confirm it persists after a page reload.
4. **All Candidates page** (`/candidates`). Find the same candidate. Confirm the source badge shows
   correctly there too, and confirm its OWN independent source-correction popover (this page does
   not share code with the Pipeline tab's) also offers Referred and saves correctly.
5. **FunnelView** (`/funnelview`, admin-only). Confirm the referred candidate shows up as a teal
   segment in the stacked funnel bar, appears in the color legend, shows the correct badge + name
   in the candidate table row, and appears as its own "Referred" row in the exported Excel summary
   sheet (click Export, check the file).
6. **Reload-survival check** (this class of bug has bitten this app before — new deferred columns
   have shipped with no read-back path at least twice this month per `decisions-log.md`): after
   confirming referrer name shows correctly live, hard-reload the Pipeline tab and `/candidates`
   page and confirm the referrer name and Referred badge are STILL there, not just present in the
   live post-screening view. This is the actual point of the `attachReferrerNames()` fetch — if
   this fails, the migration likely didn't take or the attach function has a bug.
7. **Regression check:** confirm Applicant / Sourced / Agency still all work exactly as before —
   pick each, screen or re-source a candidate, confirm no cross-contamination (e.g. picking
   Referred then switching back to Agency correctly clears the referrer name and vice versa).

## Step 4 — Live: "Share this batch" button

1. Screen a batch of resumes in a project's Screen tab (at least 1 new candidate, so
   `currentBatchId` is set).
2. Confirm the button that used to say "Link to this batch" now says "Share this batch," styled as
   a gray pill (not an outlined rectangle) with a clipboard icon (not a chain-link icon).
3. Click it. Confirm: (a) it does NOT navigate anywhere — you stay on the same Screen tab results
   you were already looking at; (b) the button label swaps to "Copied" with a checkmark for ~1.5s,
   then reverts; (c) paste the clipboard contents somewhere and confirm it's the correct durable
   URL, `{origin}/projects/{project.id}/batches/{batchId}`.
4. Manually navigate to that pasted URL directly and confirm the durable batch page still loads
   correctly and shows the same results — the page itself wasn't touched, only the button, but
   worth confirming the URL this button hands out is still valid.

## Step 5 — Full regression pass

Screen a few more resumes end to end (mix of Applicant/Sourced/Agency/Referred sources), confirm
nothing that worked before this round broke.

## Step 6 — Commit, branch, push, open PR (do NOT merge — see top of this doc)

1. `git fetch origin && git log origin/main --oneline -10` — confirm what's actually on `main`
   already before assuming what's missing. If any earlier uncommitted round mentioned in
   `decisions-log.md` (the LinkedIn link, GitHub-at-screening, score-consistency fix, or the full
   consistency-audit fixes — all dated 2026-08-26 earlier-in-day) is NOT yet on `main`, stop and
   ask Vlad how he wants these sequenced rather than silently bundling multiple unreviewed rounds
   into one PR.
2. Base a fresh branch off `main`. Suggested name: `feat/referred-source-and-share-batch` or
   similar — your call on exact naming.
3. Bring in every file listed under "Files touched" above (plus anything else genuinely part of
   this round that the file list missed — double check with `git status` / `git diff --stat -w`
   against your working tree before assuming the list above is exhaustive).
4. Commit with a clear message (or two separate commits, one per feature — your call, whichever
   reads cleaner in history).
5. Push to origin. Open a PR if `gh` is on PATH; otherwise give Vlad the compare-URL.
6. Confirm `npx tsc --noEmit` and `npm run build` both clean on the pushed branch.
7. **Stop here. Do not merge.** Report back with the PR/compare-URL and the feedback section below
   — I'll read your logic feedback and give an explicit go-ahead before this merges to `main`.

---

## Report format

PASS/FAIL/PARTIAL per step above, with what you actually did to verify (screenshots, clipboard
contents, reload checks) — not "looks correct in the code."

Then, **separately and explicitly**, answer:

1. **Does everything here make sense as designed?** Specifically: is mirroring Agency's UI
   mechanism but NOT its DB-write mechanism (deferred/isolated vs. unconditional-insert) the right
   call, or should `agency_name` actually be migrated to the same deferred pattern for consistency
   instead of leaving two different conventions for what are otherwise parallel fields? Is
   duplicating the source-picker logic across three independent components (ScreenTab/Pipeline
   popover in `page.tsx`, and `app/candidates/page.tsx`'s own copy) something worth consolidating
   into one shared component now that there are 4 source types instead of 2-3, or is that
   over-engineering for what it is?
2. **Anything about the "Share this batch" redesign you'd reconsider?** In particular: is losing
   the one-click navigation to the durable batch URL (the recruiter now has to paste the copied
   link somewhere to actually visit it) an acceptable tradeoff, or would a small secondary
   affordance (e.g. the batch results header title itself becoming a link) be worth adding back?
3. Whether the test team/projects/dev server should be torn down now, or kept up for a further
   round.
