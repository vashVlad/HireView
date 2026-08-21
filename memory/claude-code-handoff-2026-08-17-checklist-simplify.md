# Claude Code handoff — verify, then commit the JD checklist simplification onto `feat/jd-checklist`

Smaller scope than the trajectory overlay round, same verification standard: the checklist generation call has never executed against the real API since this change (schema itself changed — dropped the `category` field from what the model returns), so **verify a real generation + real screening before committing.**

## What this is

Direct Vlad feedback on the shipped Filters tab: the "Decrease score" / "Add score" tab split was confusing — items were phrased as positive signals ("Python used in AI or software project on resume") but sat under "Decrease score" because of an inverted `fired=true means the gap IS present` rule that had nothing to do with how the label read. Ask: one list, checklist only ever builds score up, real deductions live entirely in the credibility check.

## What changed

```
lib/generateChecklist.ts    — CHECKLIST_TOOL no longer has a category field; every generated item is hardcoded category: "add". Prompt simplified to ask for positively-phrased signals only, drawing from both must-have and nice-to-have lists (must-haves generally worth more points, but never a penalty).
lib/evaluateChecklist.ts    — EVALUATE_TOOL's fired description simplified to one uniform rule. computeChecklistScoreDelta now ALWAYS adds points on fire, ignoring category entirely — this is the actual fix, and it's deliberately written so it works correctly on ANY already-existing project checklist without a data migration (a legacy "decrease" item now scores identically to "add" the moment it fires).
app/projects/[id]/page.tsx  — FiltersTab: removed the two-tab switcher, checklistTab state, and category-conditional styling — one list, one "+ Add item" button. Also simplified the Archive Fits "Evidence" chip's now-meaningless category-based color branch to one consistent style.
lib/types.ts                 — comments updated; category field kept on ChecklistItem/ChecklistItemResult (not removed) specifically so already-frozen historical evaluations keep rendering accurately (ResultCard.tsx's checklist breakdown intentionally still shows an old decrease-category fired result as negative — that's real history, don't touch it).
test_checklist_delta.mjs     — rewritten, 6/6 pass, including two new cases proving a legacy "decrease"-category result still adds when fired.
```

## Do-not-touch check

None of the touched files are on the do-not-touch list. `git diff --stat` for `lib/scoreCandidate.ts`, `lib/analyzeJD.ts`, `lib/parseResume.ts`, `lib/calibrationExamples.ts`, `app/api/screen-resumes/route.ts` should show zero real change from this round specifically (the first one still carries the two exceptions from the trajectory-overlay round, already committed as `88e08dc` — nothing new here).

## Before committing — live verification

1. **Regenerate a checklist for a real project** (Filters tab → Regenerate from JD, or a fresh project). Confirm the real Anthropic response actually omits `category` from what it returns and every item reads as a positive signal, not a negation ("AWS certification", never "No AWS certification"). This schema has never executed live since the `category` field was removed from `CHECKLIST_TOOL` — confirm the API call itself still succeeds with the smaller schema.
2. **Screen a real candidate against that checklist.** Confirm the final score only ever moves UP from checklist hits (never down), and confirm `ChecklistItemResult`s all show `category: "add"`.
3. **If any EXISTING project still has a checklist with legacy `category: "decrease"` items** (generated before this change, not yet regenerated): screen a candidate against it and confirm those items, if they fire, still ADD points rather than subtracting — this is the specific backward-compatibility guarantee `computeChecklistScoreDelta` is supposed to provide without a migration. Worth a deliberate check, not just an assumption.
4. **Real browser check on the Filters tab** — confirm the single list renders correctly (no leftover tab UI, no console errors), add/edit/remove an item, confirm save works.
5. `npx tsc --noEmit` and `npm run build` — clean in the sandbox, re-confirm on real infra.

## Files to commit

```
lib/generateChecklist.ts
lib/evaluateChecklist.ts
lib/types.ts
app/projects/[id]/page.tsx
test_checklist_delta.mjs
memory/session-log.md
memory/Cirot_Roadmap.md
memory/claude-code-handoff-2026-08-17-checklist-simplify.md   (new — this file)
```

Same branch, `feat/jd-checklist`. No new branch, no merge to main.
