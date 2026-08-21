# Claude Code handoff — verify, then commit checklist-only scoring + card cleanup onto `feat/jd-checklist`

Follows directly on the same-day checklist-simplification round (see
`claude-code-handoff-2026-08-17-checklist-simplify.md` — verify/commit that one first if it
hasn't landed yet; this round's diff assumes it's already in). Same verification standard:
`evaluateChecklist`'s real Claude call has never executed against the live API since the
scoring formula built on top of it changed — **verify a real generation + real screening +
real rescreen before committing.**

## What this is

Vlad: "I though that I want to have only the checklist." When a project has a checklist, the
candidate's SCORE should come from the checklist alone, not the AI's own 0–100 judgment.
Confirmed via two direct questions before building: keep the AI's summary/strengths/concerns/
careerTrajectory generated and shown for context (yes), and how points convert to a score
(percentage of total possible points fired, not raw sum). Also confirmed, mid-build, that the
target-company boost should stay — stacked on top of the checklist-percentage base, not folded
in or dropped.

## What changed

```
lib/evaluateChecklist.ts                 — new export computeChecklistPercentageScore(results): round(firedPoints ÷ totalPossiblePoints × 100), returns null when totalPossiblePoints <= 0 (empty checklist or all-zero-point items) so the caller falls back to the AI's own score.
lib/screenings.ts                        — saveScreening() reordered: checklist percentage now OVERRIDES result.score entirely (when non-null) BEFORE the target-company boost runs; boost stacks on top of whichever base that leaves, clamped to 100. No checklist configured → unchanged AI-score + boost behavior.
app/api/history/[id]/rescreen/route.ts   — real gap found and fixed: this route calls scoreCandidate() directly and never went through saveScreening(), so it had ZERO checklist or target-company logic applied. Mirrors saveScreening()'s new ordering directly. Also now passes checklistEvaluation/targetCompanyMatches through to updateScreening() and the JSON response (previously it passed neither).
test_checklist_delta.mjs                 — 8 new cases for computeChecklistPercentageScore, 14/14 total pass locally.
```

## Also included (2026-08-18, later round, same handoff) — candidate card cleanup

Direct Vlad feedback on a live screenshot of the (still pre-fix) candidate card: "these don't make any sense... The card is too full. Also still shows decreased points but we already removed them." Two fixes to `components/ResultCard.tsx`, both UI-only, no scoring change:

```
components/ResultCard.tsx — removed the checklist item breakdown's sign bug (it independently re-derived +/- from `category` instead of trusting the additive-only scoring already in place — a legacy "decrease"-category item still rendered red/negative). Then, per Vlad's separate density request ("don't show the checklist at all", confirmed to include both the itemized breakdown AND the small "CHECKLIST +N" badge near the score), removed both entirely from the card. The checklist still drives the candidate's SCORE (unaffected — see the section above) and is still fully visible on the project's Filters tab; this only changes what renders on the card itself.
```

Verification for this part is simpler than the scoring section above — it's a pure display change, no new AI call, no new scoring path:
1. **Real browser check on a candidate card in a checklist-configured project.** Confirm no "CHECKLIST +N" badge appears near the score, and no "Checklist" section with itemized fired items appears near Strengths/Concerns. Confirm the score itself is unaffected (still checklist-driven per the section above).
2. Confirm no console errors and no leftover empty space where the section used to be.
3. `npx tsc --noEmit` — already clean in the sandbox; re-confirm on real infra.

## Also included (2026-08-18, same day, same handoff) — TrajectoryGraph real axis/grid

Vlad showed the shipped credibility graph next to a generic line-chart reference and asked for "a real looking graph... IF it makes sense." A literal line chart doesn't fit `trajectoryEntries` (no real Y-quantity without inventing one), so instead:

```
components/TrajectoryGraph.tsx — added buildYearTicks() + a background gridline layer + a bottom axis line with year labels, all positioned against the same globalMin/globalMax/span the existing bars already use. The Gantt-style bars-per-role are unchanged (already the right chart type for this data) — they just render against a real time axis now instead of floating with no scale reference.
```

Verification — pure layout/CSS, no data or scoring change, no new AI call:
1. **Real browser check on a candidate with credibility trajectory data** (the panel from the screenshot Vlad sent — Optum/LTIMindtree-style multi-role history). Confirm year gridlines run vertically through all rows, aligned with the axis labels at the bottom, and that a bar's start/end visually lines up with the correct year gridline.
2. Check a candidate with only ONE role / a very short (<1 year) history — confirms the single-year fallback tick logic (start/end month-labeled) doesn't render an empty or broken axis.
3. ~~Check the credibility-check overlay variant...~~ — superseded, see the "two separate graphs" section at the bottom of this doc. The overlay no longer exists.
4. `npx tsc --noEmit` — already clean in the sandbox; re-confirm on real infra.

## Also included (2026-08-18, same day, same handoff) — TrajectoryGraph becomes a real per-role score chart

Direct follow-up to the axis redesign above — Vlad: "I need it to show years for x and y for score for each experience, so it shows up and downs instead of static horizontal line." Pushed back honestly first (the candidate's overall score has no history to plot — it's one number computed once), then asked what real metric should drive Y. Confirmed answer: checklist points attributed to each specific role, via a NEW schema field.

```
lib/evaluateChecklist.ts          — EVALUATE_TOOL gains evidenceSource: for each FIRED item, the model now also names the specific employer/project the evidence came from (free text, e.g. "Optum"), or empty string if the evidence is general/not role-specific. Denormalized onto ChecklistItemResult same as label/category/points.
lib/types.ts                      — ChecklistItemResult.evidenceSource?: string (new, optional — undefined for any evaluation saved before this date).
lib/matchTrajectoryEntries.ts     — companiesLooselyMatch exported (was module-private) for reuse below, not reimplemented.
lib/attributeChecklistToRoles.ts  — NEW FILE. Pure, deterministic, zero-AI-cost: attributeChecklistPointsToRoles(results, entries) matches each fired item's evidenceSource to a trajectoryEntry via companiesLooselyMatch, sums points per role. 10/10 unit tests (test_attribute_checklist_to_roles.mjs, new file).
components/TrajectoryGraph.tsx    — new rolePoints?: number[] prop. When present, renders a real hand-built SVG line/step chart instead of the flat duration bars: one continuous polyline through each role's (start, points)→(end, points) — horizontal segment = real duration at a height = real attributed points, diagonal connector to the next role = the "up/down" shape asked for. Falls back to the original bars when rolePoints is absent (no checklist, or an older evaluation with no evidenceSource). (Cross-reference overlay mentioned in earlier drafts of this handoff was REMOVED same day — see the "two separate graphs" section at the bottom, which supersedes it.)
components/CredibilitySection.tsx — new checklistEvaluation prop; computes rolePoints via attributeChecklistPointsToRoles and passes it to TrajectoryGraph.
components/CredibilityChecker.tsx — CrossReferenceChecker gains checklistEvaluation prop, passed straight through to CredibilitySection.
components/ResultCard.tsx, app/candidates/page.tsx, app/projects/[id]/page.tsx — all 3 call sites of CrossReferenceChecker now pass checklistEvaluation={result.checklistEvaluation} / {s.checklistEvaluation} so real data reaches the chart everywhere it renders.
```

**This is the part of this handoff that most needs live verification** — `evidenceSource` is a brand-new field on an existing, already-live AI call, never executed against the real API:

1. **Regenerate/re-run a checklist evaluation on a real multi-role candidate in a checklist-configured project.** Confirm the real Anthropic response actually includes evidenceSource for fired items, and that it's a real company/project name copied from the resume (not hallucinated, not always empty).
2. **Open that candidate's credibility panel.** Confirm the graph renders as a LINE with distinct heights per role (not flat), confirm hovering a point's circle shows the right role + points in the tooltip, confirm the bottom legend lists each role with its point total, and confirm those totals sum correctly against the checklist breakdown.
3. **Confirm the fallback still works** — a candidate in a project with NO checklist (or an old pre-evidenceSource evaluation) should still show the original flat duration bars, not a broken/empty chart.
4. `npx tsc --noEmit` and `npm run build` — clean in the sandbox, re-confirm on real infra.

## Also included (2026-08-18, same day) — SUPERSEDED: two separate graphs, not one overlaid chart

Kept for the record only — do NOT build against this section, see the FINAL section right below it instead. The single-chart overlay went through two live bug-fix rounds for visibility, then got rebuilt as two fully separate `<TrajectoryGraph>` boxes ("Resume" / "Cross-reference") — then immediately superseded again, same day: "no I don't want to have two graphs, I want to have two full trajectories on one graph." Nothing from this two-box version shipped or needs verifying; the code no longer exists.

## Also included (2026-08-18, same day, FINAL design) — one graph, two full trajectory lines

Third and final version of the cross-reference visualization. Both the invisible-overlay and the two-separate-graphs versions above are fully superseded — verify against THIS design only.

```
components/TrajectoryGraph.tsx    — new secondaryEntries/secondaryRolePoints/secondaryDateDiff props. Renders a SECOND complete polyline on the SAME shared time+score axis as the primary (resume) line, drawn behind it, differentiated by color (violet vs. blue) and a dashed stroke — no forced vertical offset. A clean match means the two lines genuinely overlap (correct, not hidden); a real date discrepancy shows as actual horizontal misalignment plus an amber ring on the affected cross-reference point.
components/CredibilitySection.tsx — computes crossRefFullEntries/crossRefFullPoints/crossRefDateDiff: the cross-reference document's COMPLETE trajectory (includes "undisclosed" cross-ref-only rows, not just the resume-paired subset). A paired role's points = its matched resume role's own attributed points (never independently re-scored against the cross-ref doc); an undisclosed role's points = 0 (honest — no resume evidence exists to attribute a score from). Back to ONE <TrajectoryGraph> call, passing these as the secondary series.
```

Verification:
1. **Open a credibility panel for a candidate with a real cross-reference check on file.** Confirm ONE graph renders with TWO lines — solid blue (resume) and dashed violet (cross-reference) — sharing the same axis, not two separate boxes.
2. **Find (or construct) a case with a real date discrepancy on a paired role.** Confirm that role's cross-reference point renders with a visible amber ring, and the two lines show actual horizontal misalignment at that point (not just relying on the ring).
3. **Confirm a clean match (dates line up) shows the two lines genuinely overlapping** — that's correct now, not a bug to chase a third time.
4. **Confirm an "undisclosed" cross-reference-only role** (no resume counterpart) still shows on the cross-reference line, sitting at 0 points — check it doesn't crash or silently vanish.
5. `npx tsc --noEmit` and `npm run build` — clean in the sandbox, re-confirm on real infra.

## Do-not-touch check

None of the touched files are on the do-not-touch list. `git diff --stat -w -- lib/scoreCandidate.ts lib/analyzeJD.ts lib/parseResume.ts lib/calibrationExamples.ts app/api/screen-resumes/route.ts` shows zero real change from this round (whitespace flag needed — this sandbox's working tree had picked up unrelated CRLF line-ending noise across most of the repo at some point this session; normalize with `sed -i 's/\r$//' <file>` on any file before trusting a raw `git diff` on it, or just always diff with `-w`).

## Before committing — live verification

1. **Screen a real candidate against a project that has a checklist.** Confirm the final score exactly equals `round(firedPoints ÷ totalPossiblePoints × 100)` — pull the checklist evaluation off the response and hand-check the math against the score shown.
2. **Confirm the target-company boost still applies on top.** Screen a candidate whose resume mentions one of the project's target companies — confirm the final score is the checklist percentage PLUS the boost (clamped to 100), not just the raw percentage.
3. **Screen a candidate against a project with NO checklist.** Confirm scoring is completely unchanged from pre-this-round behavior (AI's own score + target-company boost, no checklist involved).
4. **Rescreen an existing candidate in a checklist-configured project** (the actual bug fix). Confirm the rescreened score reflects the checklist percentage, not a reversion to the AI's raw judgment — this is the specific regression this round exists to prevent.
5. **Edge case: a checklist where every item is 0 points, or an empty checklist** (if reachable via the UI). Confirm the score falls back to the AI's own judgment rather than showing 0.
6. `npx tsc --noEmit` and `npm run build` — clean in the sandbox, re-confirm on real infra.

## Files to commit

```
lib/evaluateChecklist.ts
lib/screenings.ts
lib/types.ts
lib/matchTrajectoryEntries.ts
lib/attributeChecklistToRoles.ts        (new)
app/api/history/[id]/rescreen/route.ts
components/ResultCard.tsx
components/TrajectoryGraph.tsx
components/CredibilitySection.tsx
components/CredibilityChecker.tsx
app/candidates/page.tsx
app/projects/[id]/page.tsx
test_checklist_delta.mjs
test_attribute_checklist_to_roles.mjs   (new)
memory/session-log.md
memory/decisions-log.md
memory/Cirot_Roadmap.md
memory/claude-code-handoff-2026-08-17-checklist-scoring.md   (new — this file)
```

Same branch, `feat/jd-checklist`. No new branch, no merge to main.
