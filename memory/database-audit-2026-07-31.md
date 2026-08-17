# Cirot Database Audit — 2026-07-31

Full read-through of every table (via `supabase/migrations/*.sql`, cross-checked against `lib/*.ts` read/write usage — no live DB access this session, so row counts/actual query plans aren't verified, just schema + code paths). 14 application tables total, plus Supabase-managed `auth.users`.

## Bottom line

The schema is in good shape overall — every migration this project has wired in follows a consistent, deliberate pattern (additive-only, deferred-column safety, documented reasoning). One genuinely dead table found (real efficiency win, needs your call on how to resolve). One missing index fixed already. Two "could we merge these tables" questions investigated and answered "no, keep separate" with reasons. One schema/app type mismatch worth a second look. No urgent risk found.

---

## Fix already made (safe, zero-risk, no migration run needed)

**Missing index on the new `blacklisted` column.** `listBlacklist()` runs `WHERE blacklisted = true` on every single pre-screen check (every resume upload), but the migration I wrote for it earlier today didn't include a partial index — every other boolean flag column that gets filtered on (`duplicate_flag`, `history_alert_type`, `batch_id`) has one. Added `CREATE INDEX ... WHERE blacklisted = true` to `supabase-migration-blacklist.sql` (not yet run, so this was a free fix, not a live migration).

---

## RESOLVED — `screening_batches` removed, 2026-07-31

Vlad's call, after double-checking the "fully unused" finding once more (a repo-wide grep for every form of the name — table, function, comments, memory files — found the only real code references were the write path itself and comments explicitly documenting the 2026-07-17 cutover away from it): drop it.

- Removed the `saveScreeningBatch()` call from `app/api/screen-resumes/route.ts` (do-not-touch file, authorized exception, explicitly Vlad's ask).
- `lib/screeningBatches.ts` gutted to a dead-file marker comment — this sandbox can't delete files on this mount (known quirk), so it's flagged for `git rm` / `rm` on a real machine instead, to run AFTER the migration below.
- New `supabase-migration-drop-screening-batches.sql` — **NOT YET RUN**. Must run AFTER the code above deploys (opposite ordering from every other migration in this project — a DROP has to come after its last writer stops, not before). Includes an export command in its header in case the 284 rows of history are wanted before they're gone for good.
- `npx tsc --noEmit -p .` clean. Do-not-touch diff on `screen-resumes/route.ts` confirmed scoped to exactly this removal; the other 4 protected files confirmed zero diff.

## (Original finding, for reference)

`lib/screeningBatches.ts` only ever calls `.insert()` — grepped the entire codebase, there is no `.select()` from `screening_batches` anywhere. Both places that used to read it (Analytics, FunnelView) were rewritten on 2026-07-17 to compute live counts directly from `screenings`/`tracker` instead, specifically because this table is an immutable append-only log that goes stale the moment a screening is later deleted. The code comments in both files say so explicitly — this wasn't an oversight, it was a deliberate cutover that just never circled back to the write side.

Right now, every single screening batch still pays the cost of an insert plus 3 index updates (`user_id`, `project_id`, `created_at`) into a table nothing reads. That's a real, measurable inefficiency — small per-request, but it's pure waste on every screening run.

**Confirmed live via Claude Code, 2026-07-31: 284 rows, spanning 2026-06-23 to 2026-07-31 — essentially the whole project's history to date (~5 weeks).** Zero-reads finding reconfirmed against the real checked-out repo too, nothing new.

**Your call, two options:**
1. **Stop writing to it, leave the table in place** — keeps the 284 existing rows untouched in case you ever want them, removes the write cost going forward. Low-risk, one-line change (delete the `saveScreeningBatch()` call in `screen-resumes/route.ts` — that file is do-not-touch, so this needs your explicit sign-off).
2. **Drop the table entirely** — same write-cost savings, plus reclaims that storage. Only makes sense if you're confident you'll never want that ~5-week aggregate history (total/passed counts per batch, pre-2026-07-17).

I didn't touch this — it's a `screen-resumes/route.ts` change either way, and that's your do-not-touch file. Still awaiting your decision.

---

## Investigated, decided against merging

**`calibration_examples` vs. `fraud_calibration_examples`.** Structurally near-identical — both store a self-contained resume copy (`resume_path`, `resume_mime_type`, `extracted_text`), both have `user_id`/`created_at`. Tempting to merge into one table with a `kind` discriminator. Decided against recommending it: `fraud_calibration_examples`'s own migration explicitly documents why it's separate — fraud patterns are deliberately system-wide (not project-scoped like fit calibration), and `scoreCandidate.ts` (do-not-touch, reads `calibration_examples`) is intentionally isolated from the fraud-risk system. Merging the tables would either entangle two systems that were kept apart on purpose, or require enough conditional logic that it'd cost more in code complexity than it saves in schema tidiness. Two small, near-identical tables is the right tradeoff here.

**`resume_fingerprints`** is strictly 1:1 with `screenings` (`UNIQUE` + `ON DELETE CASCADE` on `screening_id`) and could theoretically be 4 columns directly on `screenings` instead of a joined table — that would remove a join from every duplicate/fraud-match check. Real efficiency idea, but a genuinely large refactor (rewrites every function in `lib/resumeFingerprints.ts` and `lib/generateFingerprint.ts`'s call sites) for a join that Postgres already handles cheaply via the unique index. Not worth doing now — flagging as a "worth revisiting only if this table's read pattern ever becomes a measured bottleneck," not an active recommendation.

**The six "this candidate relates to another screening" signals** (`duplicate_match_id`, `history_alert_match_id`, `name_match_id`, `transferred_to_screening_id`, the ephemeral cross-project-name-match fields, `archive_fit_candidates.screened_screening_id`) each got added independently as separate features shipped over time, all self-referencing `screenings(id)`. A single generic `screening_relations(screening_id, related_screening_id, relation_type, confidence)` table could replace all of them someday. I'm not recommending this now — every existing column already has its own index, so there's no real data-efficiency loss today, and the refactor would touch nearly every fraud/match code path in the app for a payoff that's mostly code clarity, not runtime speed. Worth keeping in mind if an 8th or 9th signal gets added later.

---

---

## Confirmed healthy, no action needed

- **`previous_status`/`previous_stage`** (DB triggers, auto-populated on every `UPDATE`) — confirmed actually read by FunnelView for archived/rejected candidate attribution. Not dead weight.
- **`resume_fingerprints`'s 4 semantic columns** (`skills_hash`, `responsibility_vectors`, `metric_claims`, `career_arc_signature`) — all confirmed actively used in real matching logic, not write-only.
- **`screening_actions`** — correct append-only shape, indexed on the two columns actually queried (`screening_id`, `created_at`); no missing index (nothing ever filters this table by `user_id` alone).
- **`teams`/`team_members`** — clean join-table shape, correct indexes both directions.
- **`access_requests`/`feedback`** — small, correctly isolated utility tables, RLS explicitly and deliberately disabled (service-role key bypasses it everywhere in this app anyway — every access-control decision lives in `lib/auth.ts`, not Postgres RLS, which is already documented in `bootstrap-core-tables.sql`).
- **`screenings.job_description`** — looked like possible duplication of `projects.job_description` at first glance (every screening row stores the full JD text even though `project_id` already links to the project). Checked the actual behavior: this is a deliberate snapshot of the JD *at scoring time*, not a stale copy — a later JD edit or a rescore intentionally diverges from it. Correct design, not a redundancy.
- **`screenings` is a wide table (~46 columns)**, having accumulated one column per feature shipped over roughly two months. This is normal for an actively-developed product and isn't a real efficiency problem in Postgres — the thing that would actually hurt (a `SELECT *` pulling every column on every load) is already avoided everywhere via the explicit `SCREENING_COLUMNS` constant. No action needed, just noting it as the natural result of the deferred-column-safety pattern this project already follows correctly.
- **`tracker.steps_completed` — resolved, 2026-07-31, via Claude Code.** Every migration file declared this column `text[]`, but the app has only ever treated it as a plain string. Direct write-then-read test against the live table confirmed the real column is `text`, not an array — the feature works fine, someone just hand-altered the column outside the migration-file convention at some point (same story as this project's other pre-convention tables) and the migration files never caught up. Fixed `bootstrap-core-tables.sql`'s declaration to `text` so a future fresh-DB bootstrap matches reality. No app code was ever wrong; this was a documentation-only mismatch.

---

## Full table inventory (for reference)

| Table | Purpose | Relationship |
|---|---|---|
| `screenings` | One row per screened candidate — the core table | `project_id` → projects, `team_id` → teams, several self-referencing match columns |
| `tracker` | One row per screening in the interview pipeline | 1:1 with screenings |
| `projects` | One row per open role | — |
| `calibration_examples` | JD-fit calibration resumes | `project_id` → projects |
| `fraud_calibration_examples` | Fraud-pattern calibration resumes, system-wide | loose pointer to screenings (not FK'd, by design) |
| `resume_fingerprints` | Fraud/duplicate matching fingerprint data | 1:1 with screenings |
| `screening_actions` | Append-only activity/attribution log | many:1 with screenings |
| `archive_fit_candidates` | Archive-fits review queue | project_id + screening_id, unique pair |
| `screening_batches` | Legacy per-upload analytics aggregate | **write-only, unused — see above** |
| `teams` | Team roster | — |
| `team_members` | Team ↔ user membership | join table |
| `access_requests` | Login access request form submissions | — |
| `feedback` | In-app bug/feedback submissions | — |
| `auth.users` | Supabase-managed auth | — |
