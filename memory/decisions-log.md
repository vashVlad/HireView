# HireView — Decisions Log

Append-only. Newest at top. Each entry: the decision, and the reason — so future sessions don't reverse a decision without knowing why it was made.

---

**2026-07-06 — Interview View uses two separate buttons (one popup each), not one button opening multiple windows.**
Browsers block all but the first `window.open()` per user gesture. Tried: single container with 3 iframes (popup blocker), navigate current tab + one popup (timing issues). Final design: two icon buttons on the card — one for resume, one for notes — each triggering exactly one popup. Clean, reliable, no workarounds needed.

**2026-07-06 — Window sizing uses complement math: `sw - halfW` for resume, `halfW` for notes.**
`Math.floor(sw/2) + Math.floor(sw/2)` can equal `sw - 1` on odd screen widths. Using the complement ensures both windows always sum to exactly `screen.availWidth`.

**2026-07-06 — Credibility signal emoji removed from collapsed pipeline cards.**
OS emoji rendering (⛔, ⚠) looks jarring against the dark UI. Signal is still shown in the expanded card header and CredibilitySection. Do not bring emojis back to the collapsed card.

**2026-07-06 — Career trajectory displayed oldest-first (chronological), reversed at render time.**
Claude outputs trajectory newest-first (resume order). Reversal happens in `TrajectoryRenderer.buildRenderOrder()` by grouping role blocks and reversing the array. No DB regeneration needed — works on all existing records.

**2026-06-30 — Tracker folded into project tabs, not a standalone page.**
The pipeline view now lives as a 5th tab on the project detail page instead of its own `/tracker` route. Keeps the "zero context switching" goal of the redesign intact.

**2026-06-29 — Nav collapsed to 2 items: Projects, All Candidates. Role is the organizing unit, not the action.**
Production usage showed nobody ever screens without a role attached. The old 5-item nav (Screener/JD Analyzer/History/Tracker as siblings) was overhead with no payoff. Root cause: Projects had been layered *on top of* a tool-centric architecture instead of replacing it. Explicitly: no DB schema changes, no API route changes — only navigation/composition changed.

**2026-06-29 — Blueprint v2.0 adopted as the project's operating framework.**
All future HireView work follows the 5-phase methodology in `BLUEPRINT_Operations_Systems_Builder.md`: problem statement with real metrics before any build.

**~mid-June 2026 — Credibility Checker replaced the "Compare" feature entirely.**
Compare covered the same ground with more UI friction. Checker takes optional LinkedIn PDF + second resume, both optional (not every candidate has a LinkedIn PDF).

**~mid-June 2026 — Prompt rewritten for strict one-sentence / label:gap output format.**
Cut AI output tokens ~60%, made results more scannable. Added a "More" button per concern for on-demand 2-3 sentence drill-down, instead of always showing full detail.

**~mid-June 2026 — Comparison/credibility results persist to Supabase instead of recomputing.**
History page needs to show past results without re-running the model each time.

**Early June 2026 — Screener moved to `/` (main route), JD Analyzer moved to `/jd-analyzer` with a Beta badge.**
Screener is the core tool and entry point; JD Analyzer is a supporting utility, not where work starts.

**Early June 2026 — Never use `bash cp` between routes; always use Read/Write/Edit tools for file operations in this repo.**
A path mismatch between the Edit tool's Windows path and the Linux sandbox mount path silently corrupted files via `cp` on at least two separate occasions (once causing full route-file truncation, once corrupting nine source files). This is now a hard rule, not a preference.

**Early June 2026 — Must-have skills weighted 65%, nice-to-have 35% in resume scoring.**
Initial scoring treated every JD bullet equally, which scored too low. Explicit weighting plus "practical equivalence" rules fixed it.

**Early June 2026 — localStorage caching removed entirely, will not be reintroduced without explicit reason.**
Caused a full page crash in production (cached data had the wrong shape after a deploy). Lesson logged: state living outside the deploy cycle has no shape validation.
