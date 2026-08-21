# Cirot — Candidate Insight Roadmap (Summary, Trust Badge, Trajectory Graph)

*Written 2026-08-11. Design-only — no code has been changed against this roadmap yet. Reflects the original 5-item roadmap as narrowed down through discussion: items 4 and 5 dropped (already built / left alone), items 1-3 refined into the shape below.*

## Status of the original 5 items

| # | Original idea | Status |
|---|---|---|
| 1 | AI-generated candidate summary | **Redesigned** — bullet points, not prose; icon-tagged by source; credibility bullets appended later, not automatic |
| 2 | One consolidated overview card | **Redesigned** — stays 3 separate components (not unified into one), each reorganized the same way |
| 3 | Visual confidence tag | **Redesigned + expanded** — a single "Trust" badge, plus a new trajectory graph that wasn't in the original roadmap at all |
| 4 | Recruiter feedback signal | **Dropped** — already exists (`CalibrationButtons.tsx`, thumbs up/down → `calibration_examples`), confirmed live in the app today |
| 5 | Feed feedback into calibration | **Dropped** — already wired end-to-end via #4; not touching the do-not-touch weighting logic in `scoreCandidate.ts` |

---

## 1. Bullet-point summary, icon-tagged, credibility appended on demand

**What it is:** Replace/extend the current single-sentence `summary` field with a short bullet list generated at screening time from trajectory alone — no credibility involved yet, since credibility checks are recruiter-triggered and not run automatically. Each bullet carries an icon signaling what kind of point it is (e.g. a trajectory-shape icon vs. a fit icon). If and when a recruiter later runs a credibility/cross-reference check on that candidate, its findings get **appended** as additional bullets — visually separated from the trajectory bullets by a divider line or a distinct icon set — not regenerated, not blended in, and never triggered automatically.

**What has to change:**
- `lib/generateTrajectory.ts` — new structured-output field for the bullet list (this file isn't do-not-touch, safe to extend directly).
- `lib/scoreCandidate.ts` — **do-not-touch exception required** to mirror the same field, following the exact pattern already used for `careerTrajectory`/`currentCompany`/`currentTitle` this session. Needs explicit sign-off before touching, per this project's standing rule.
- `lib/assessCredibility.ts` — needs its output reshaped (or a new field added) into bullet-point form so it can be appended in the same visual language as the trajectory bullets, rather than staying in its current `rows`/`trajectoryNote`/`industryNote` shape.
- `lib/types.ts` / `lib/screenings.ts` — new column(s) to persist the bullet list (and, separately, whatever credibility bullets get appended after the fact) — another "deferred column" needing the isolated-fetch/separate-write pattern this project already uses everywhere else for not-yet-migrated fields.
- UI: `ResultCard.tsx` and the two other card renderers (see #2) need a bullet-list component with icon support, replacing however the current terse `summary` renders today.

**Concerns:**
- This adds a **third** place the app makes a prose/summary judgment call, alongside the existing terse `summary` (1 sentence) and the trajectory's own closing recommendation paragraph (3-4 sentences, built this session). Worth deciding on go: does the terse `summary` field get retired once this ships, or does it keep a separate purpose (e.g. list-view scanning) while the new bullets are the detail-view feature? Left open — flag before building so it isn't decided by accident.
- Two-stage generation (trajectory bullets now, credibility bullets later, appended) means the summary is never a single atomic thing — the UI has to handle "bullets exist, no credibility yet" as a normal, permanent state for most candidates, not a loading/incomplete state.
- Another do-not-touch exception in `scoreCandidate.ts`. Not a blocker — this project has a clean, established process for it — but it's real scope, not a free addition.

## 2. Reorganized cards, kept as 3 separate components

**What it is:** Not a unified shared component — a deliberate choice to keep `ResultCard.tsx`, `PipelineTab`'s own inline card markup (`app/projects/[id]/page.tsx`), and `app/candidates/page.tsx`'s own inline card markup as three independent implementations, but reorganize each the same way: new bullet summary at top, Trust badge (see #3) next to it, then Strengths/Concerns and Credibility detail as **tabs** within the card instead of two stacked, always-visible sections. Target company match moves from its own standalone badge into a line item inside the Strengths tab. The existing small credibility signal badge (`overallSignal`-based, next to "Career story") is removed outright, superseded by the Trust badge.

**What has to change:**
- All three card implementations need the same restructuring applied independently — this is the real cost of keeping them separate. `PipelineTab`'s own code already has a comment acknowledging this exact drift risk ("this tab renders its own inline card markup, not ResultCard.tsx, so anything added to ResultCard doesn't automatically appear here too") — that risk applies fully here, three times over, not once.
- A new tabbed sub-component (Strengths/Concerns vs. Credibility) — doesn't exist today in any of the three card renderers; credibility currently renders as an always-present `CrossReferenceChecker` block, not something tab-gated.
- `CrossReferenceChecker`'s trigger button (the on-demand credibility check action) needs to live inside the new Credibility tab rather than its current placement — a real layout change, not just moving a badge.
- Target company match's existing standalone badge (`ResultCard.tsx`, built earlier this session) gets removed as a separate element and folded into the Strengths tab's content instead.

**Concerns:**
- Three implementations to update, by design, not by oversight — worth confirming this is genuinely intended long-term (vs. a step toward eventual unification later) so the choice doesn't get silently revisited mid-build.
- Turning credibility into a tab means it's no longer glanceable without a click — worth a sanity check that this doesn't quietly undercut the Trust badge's whole purpose (a badge that says "needs a check" but then requires two clicks — expand card, switch tab — to actually see the check).

## 3a. Trust badge

**What it is:** A single overall "Trust" indicator, replacing the old credibility-only signal badge, based on the candidate's whole picture (not just credibility) — presumably score plus trajectory plus, once one exists, credibility. Recalculates every time a credibility/cross-reference check runs; not automatic before that.

**What has to change:**
- New computation logic combining multiple existing signals (`score`, `mustHaveScore`/`niceToHaveScore`, `overallSignal` once present) into one label.
- **Recommend building this as a deterministic, code-computed mapping, not a new AI judgment call** — this matches an established, deliberate pattern already used repeatedly in this codebase this session (the target-company score boost, credibility score deltas) specifically so the badge's logic stays auditable and independent of any single model call's mood. Needs sign-off since it's a new synthesis layer, but doesn't need to touch `scoreCandidate.ts` itself if built this way.
- UI: replaces the removed credibility badge in all three card renderers (same three-times-over cost as #2).

**Concerns:**
- "Based on the whole summary of the candidate" is still a little open — needs an actual formula (which signals, what weighting) before this can be built, not just a label. Worth a short follow-up to nail the exact inputs once #1/#2 are further along, rather than guessing at a formula now.
- Same default-state question as #1: most candidates won't have a credibility check run, so most Trust badges will be based on trajectory/score alone. Worth deciding whether the badge visually signals "credibility not yet checked" as part of its own display, or looks identical either way.

## 3b. Trajectory graph — JD-alignment over time

**What it is:** The genuinely new piece, not in the original 5-item roadmap. A chart plotting one point per role (not per calendar year), where each point's value is a **score of how well that role's experience matches a checklist derived from the JD** — title and responsibilities both weighed, not a generic seniority ladder. Shows whether the candidate's experience has trended toward or away from what this specific role needs over their career, not just whether they got more senior in the abstract.

**What has to change:**
- `lib/generateTrajectory.ts` — extend the existing role-breakdown output with a new per-role numeric alignment score, computed in the same call that already generates the role list (confirmed direction: reuse existing trajectory data, no new dedicated AI call). This call already has the JD as context, so the checklist comparison happens inside the same generation pass.
- **Open question, flagged, not yet answered:** is the "checklist" the same must-have/nice-to-have list `scoreCandidate.ts` already derives from the JD for overall scoring (reused per-role instead of once), or a separate checklist built just for this graph? The first keeps one JD-requirements concept across the whole app and avoids inventing a second one; the second gives more control but is genuinely new machinery. This decision also determines whether `scoreCandidate.ts` needs to know about it at all — if it's the same checklist, this can likely stay entirely inside `generateTrajectory.ts`, out of do-not-touch territory.
- A new charting UI component. **No charting library exists in this codebase today** (`package.json` has no Chart.js/Recharts/similar) — the one existing chart, Analytics' score distribution, is a hand-built bar component, not a general-purpose charting solution. A per-role trend line is a different shape of problem (continuous line, positive/negative movement, hover detail per point) — worth deciding whether to hand-build another custom SVG component (consistent with the rest of this codebase's own-build convention) or bring in a real charting dependency for the first time.
- Persistence: per-role scores need a place to live — likely inside the existing `career_trajectory` structure rather than a new table, but needs a concrete shape decided before building.

**Concerns:**
- This is the least-specified item of the three and the biggest net-new build — not a UI reorganization like #2, not a schema extension of something that already has a close analog like #1, but a new scoring dimension plus a new visualization type. Worth treating as its own scoped mini-project rather than folding into the same pass as #1/#2.
- Depends on #1's do-not-touch/schema work being settled first if the checklist ends up needing anything from `scoreCandidate.ts` — sequencing matters here more than for the other items.
- "Moving up or down" is inherently a judgment call the model makes per role — worth a real accuracy check once built (a handful of known resumes, does the graph's shape match what a recruiter would say by eye) before trusting it as a first-glance signal, the same way the career trajectory prompt itself went through several rounds of tightening this session before the wording held up.

---

## Suggested build order

1. **#1's schema work first** (trajectory bullets, do-not-touch exception, deferred-column persistence) — smallest, most self-contained, and resolves the "which checklist" question for #3b along the way, since it forces a decision about how JD requirements get represented and reused.
2. **#2's layout work**, applied to `ResultCard.tsx` first (single implementation, lowest risk), then the other two card renderers once the pattern is proven — rather than building all three in parallel and risking the same kind of drift already documented in `PipelineTab`'s own code comments.
3. **#3a (Trust badge)** once #1 and #2 are in place — it needs both the new bullet summary and the tab restructuring to have somewhere sensible to live.
4. **#3b (graph)** last and treated as its own scoped effort — biggest unknown, most new surface area, and benefits from #1's checklist decision already being resolved.

## Cross-cutting concerns

- **Do-not-touch scope**: at least one exception in `scoreCandidate.ts` is likely needed (#1's bullet summary field, if `careerTrajectory`'s sibling fields are any guide). Each one needs explicit sign-off and a targeted diff check against `origin/main`, per this project's standing process — not a blocker, but real overhead to budget for, not skip.
- **Three-times-over UI cost**: every visual change in #2 and #3a has to be built and verified three separate times (`ResultCard.tsx`, `PipelineTab`, `app/candidates/page.tsx`) since they're deliberately staying independent. Worth budgeting accordingly rather than estimating off a single-component change.
- **New dependency question**: #3b may be the first feature in this codebase to need an actual charting library, or the next in a line of hand-built visualization components — worth deciding as a matter of general policy, not just for this one feature, since it'll come up again.
- **Nothing here is automatic** — repeated deliberately across #1 and #3a per your explicit instruction. Credibility checks stay recruiter-triggered; nothing in this roadmap changes that, it only changes what happens to the results once a recruiter chooses to run one.
