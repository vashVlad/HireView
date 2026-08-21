# Claude Code handoff — verify, then commit global talent search backend onto `feat/jd-checklist`

Same framing as `memory/claude-code-handoff-2026-08-17-verify.md` (the one you just ran for Archive Fits stage 2 + GitHub corroboration — that one caught two real bugs before commit, do the same rigor here): **verify this actually works before committing it**, not just package and push.

## What this is

Roadmap 2.5.9, global talent search — natural-language search across every candidate via embeddings. Backend only. No UI wired up yet (deliberate — see "Not in scope" below).

## New files

- `lib/embeddings.ts` — Voyage AI REST wrapper (`generateEmbedding`) + `buildCandidateEmbeddingText` (pure, unit-tested).
- `supabase/migrations/supabase-migration-candidate-embeddings.sql` — enables `pgvector`, adds `screenings.embedding vector(1024)`, an ivfflat index, and a `match_screenings_by_embedding` Postgres function for cosine-similarity search.
- `lib/candidateSearch.ts` — `searchCandidatesByText` (embeds query, calls the RPC) + `highlightQueryOverlap` (pure, unit-tested — cosmetic literal-term-overlap chips, NOT the ranking signal).
- `app/api/candidates/search/route.ts` — `POST { query, projectId? }` → ranked candidates, team-scoped via `teamIdsFilter`.
- `scripts/backfill-candidate-embeddings.ts` — one-time backfill for existing screenings (mirrors `scripts/backfill-resume-hashes.ts`).
- `test_embeddings_pure.mjs` — 8 cases for the two pure functions above.

## Modified files

- `lib/screenings.ts` — added `setScreeningEmbedding(id, embedding)`, isolated write, NOT in `SCREENING_COLUMNS`.
- `app/api/screen-resumes/route.ts` (do-not-touch, new exception dated 2026-08-17) — after `saveScreening()` succeeds and `result.id` is set, builds embedding text from the just-generated `result` (summary/strengths/concerns/careerTrajectory), embeds it (`input_type: "document"`), and writes it via `setScreeningEmbedding`. Awaited, best-effort, wrapped in try/catch — a failure here never touches the actual screening save.
- `.env.example` — added `VOYAGE_API_KEY` (optional; documented as silently-skipped-if-unset).
- `memory/Cirot_Roadmap.md`, `memory/session-log.md` — status updates, including fixing a stale 2.5.5 row that still said "not started" after it had already shipped.

## Status update: both blockers are cleared — Vlad has done his part

`VOYAGE_API_KEY` is set (both `.env.local` and Vercel). **Both** pending migrations have been run against the real database:
- `supabase/migrations/supabase-migration-checklist.sql` (older, roadmap 2.5.1 — JD checklist. This one was never actually live-verified after running, since it ran around the same time as this handoff was written. Check it too, not just the embeddings one.)
- `supabase/migrations/supabase-migration-candidate-embeddings.sql` (this round, roadmap 2.5.9)

So there's no more excuse to defer any of the checks below to "once Vlad sets things up" — do them now, for real, against the live database and a live Voyage call.

## Step 0 — verify BOTH migrations actually applied correctly, before testing anything built on top of them

Don't assume "ran without error" means "schema is exactly right." Check directly:

**Checklist migration:**
- `projects.checklist` column exists, type `jsonb`.
- `screenings.checklist_evaluation` column exists, type `jsonb`.
- Generate a checklist on a real project (Filters tab), confirm it saves and reloads correctly — this was built weeks... hours ago in Cowork and has never been exercised against a live DB at all until now.

**Embeddings migration:**
- `vector` extension is enabled (`select * from pg_extension where extname = 'vector';`).
- `screenings.embedding` column exists, type `vector(1024)`.
- `screenings_embedding_idx` (ivfflat index) exists and built without error.
- `match_screenings_by_embedding` function exists — check its signature matches `(query_embedding vector(1024), match_count int, filter_team_ids int[], filter_project_id int)` exactly, since a mismatched signature will fail every call from `lib/candidateSearch.ts` at runtime, not at build time.

If either migration is missing something or came in with an unexpected type, fix the migration file and note it — don't just patch around it in application code.

## What genuinely needs YOUR verification (no network access in the sandbox that built this)

1. **The Voyage API call itself**, now that a real key exists. `lib/embeddings.ts`'s request shape (`POST https://api.voyageai.com/v1/embeddings`, `Authorization: Bearer <key>`, body `{input, model: "voyage-3.5", input_type, output_dimension: 1024}`) was confirmed against Voyage's docs via web search, never executed. Also: Voyage has since released a `voyage-4` family (same 1024-dim default) — worth bumping `VOYAGE_MODEL` in `lib/embeddings.ts` from `"voyage-3.5"` to `"voyage-4"` while you're in there verifying this, since that's now the current recommended model, not the one this was built against blind. Confirm:
   - The response shape matches (`data[0].embedding`, length exactly 1024).
   - `input_type: "document"` vs `"query"` are both accepted as-is.
   - Error handling: a bad key degrades to `null` (logged), not an uncaught throw.

2. **The RPC function**, called for real (not just schema-checked in Step 0): call `match_screenings_by_embedding` with a hand-built 1024-length dummy vector and confirm it returns rows in the expected `{id, similarity}` shape, filters correctly by `filter_team_ids`/`filter_project_id` when passed, and returns everything when both are `null`.

3. **End-to-end: screen a real resume, confirm an embedding gets written.** Screen a test candidate and check `screenings.embedding` is populated (not null) for that row. Then run `scripts/backfill-candidate-embeddings.ts` for real — this is the actual backfill for Vlad's ~397 existing candidates, not a dry run — and confirm it completes and reports a sane success count.

4. **A real search**, once rows have embeddings: `POST /api/candidates/search` with a plausible query (e.g. "led a Kubernetes migration") and confirm it returns a sensibly-ranked result, not an empty array or an error. Check that `matchedTerms` (the highlight chips) look reasonable — remember empty is a valid, expected outcome when the match is semantic-only (see `lib/candidateSearch.ts`'s header comment), don't treat that alone as a bug.

## Not in scope — do not build this as part of committing

The All Candidates page UI (search bar, filter-panel consolidation into a single "Filters" button) is NOT part of this round. It's already fully speced in `memory/session-log.md`'s 2026-08-15 entry if you want to read ahead, but building it isn't part of this handoff — commit the backend, verify it works, and stop there unless Vlad asks for the UI in the same pass.

## Do-not-touch check

`app/api/screen-resumes/route.ts` has ONE new addition this round (the embedding write, clearly marked with a `DO-NOT-TOUCH EXCEPTION (2026-08-17, roadmap 2.5.9...)` comment). `lib/scoreCandidate.ts`, `lib/analyzeJD.ts`, `lib/parseResume.ts`, `lib/calibrationExamples.ts` — confirm zero diff from this round the same way you did for the last handoff.

## Environment quirk reminder

Same mount-level LF→CRLF issue flagged in the last handoff — every file this round was checked with `git diff --stat` scoped to itself and confirmed clean (no CRLF noise) before being written, but re-verify in your own environment before running `git add -A`. Only add the files listed above, explicitly.

## Before committing

- `npx tsc --noEmit` clean.
- `node test_embeddings_pure.mjs` passes (8/8).
- Both migrations confirmed applied correctly (Step 0), the live Voyage call confirmed working, a real search confirmed returning results. If any of those still doesn't work even with the key/migrations in place, say so explicitly and fix it before committing — same rigor as the bugs you caught last round.

Same branch: `feat/jd-checklist`. No new branch, no merge to main.
