# Cirot — Technical Stack Handoff

*Prepared 2026-08-11 for internal platform team review, ahead of infrastructure scoping (containerization, hosting, and the Anthropic → Microsoft OpenAI enterprise gateway migration).*

*Confidence key: **Certain** = read directly from source (code, config, migrations). **Inferred** = derived from code behavior but not independently confirmed against a live dashboard/account (e.g. actual Vercel plan tier, actual row counts).*

---

## 1. Languages, Runtimes, Frameworks

**Certain** (from `package.json`, `tsconfig.json`):

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript | `^5` (strict mode on) |
| Frontend framework | Next.js (App Router) | `16.2.9` |
| UI library | React / React DOM | `19.2.4` |
| Styling | Tailwind CSS | `^4` (via `@tailwindcss/postcss`) |
| Linting | ESLint | `^9`, `eslint-config-next` `16.2.9` |
| TS compile target | ES2017, module `esnext`, `moduleResolution: bundler` | — |

There is no separate backend language or framework — the backend is Next.js API routes (Node.js), same language and repo as the frontend.

**Inferred:** no `.nvmrc`, `.node-version`, or `engines` field pins a Node version anywhere in the repo. Next.js 16 requires a recent Node LTS (20.x or newer) to run; the exact minimum should be confirmed against Next.js's own release notes rather than assumed, and a version should be pinned as part of containerization (see §6).

Key runtime dependencies: `@anthropic-ai/sdk` (`^0.105.0`), `@supabase/supabase-js` (`^2.108.2`), `@supabase/ssr` (`^0.6.1`), `pdf-parse`, `mammoth` (docx parsing), `word-extractor` (legacy `.doc` parsing), `xlsx` (Excel export), `react-markdown`.

No test framework is installed (no Jest/Vitest/Playwright in `package.json`, no `*.test.ts`/`*.spec.ts` files anywhere in the repo) — **certain**.

---

## 2. Backend Services

**Certain:** this is a single Next.js monolith — one deployable unit serving both server-rendered pages and API routes (`app/api/**/route.ts`). There is no separate backend service, no microservices, and no standalone worker process. All business logic (resume parsing, LLM scoring calls, Supabase reads/writes, Excel export generation) runs inline inside Next.js API route handlers, in the same process/deployment as the UI.

- **19 pages**, **54 API routes** under `app/` (updated count, 2026-08-21 — was 53 on 2026-08-11).
- **No background workers, no job queue, no cron/scheduled jobs.** Every "queue" reference in the code (`fitQueueRef`, `ArchiveFitQueueRow`, etc.) is naming for an in-app review list or a client-side promise chain — not a real task queue or message broker.
- One route (`app/api/screen-resumes/route.ts`) has an extended `maxDuration = 300` (5 minutes) because resume screening synchronously calls the Claude API and waits for the response inside the HTTP request — there is no async/background processing model for long-running AI calls.
- **How it's run today:** `npm run dev` (local), `npm run build` + `npm run start` (production build). No custom server, no `server.js` — standard Next.js serverless deployment model (see §7, hosting is Vercel).
- A handful of one-off admin scripts exist under `scripts/` (`backfill-recruiter-attribution.ts`, `backfill-resume-hashes.ts`, `backfill-transfer-history-links.ts`, `provision-enterprise-teams.ts`) — run manually (e.g. via `ts-node` or `tsx`), not scheduled, not part of the deployed app.

---

## 3. Middleware

**Certain**, all from `middleware.ts` and route-level code:

- **Auth middleware** (`middleware.ts`, runs on every request except `/login`, `/auth/callback`, `/api/access-requests`, static assets): validates the Supabase session via `supabase.auth.getUser()` (server-verified, not just reading a cookie), redirects unauthenticated page requests to `/login`, returns `401` for unauthenticated API requests.
- **No rate limiting** anywhere in the codebase — no rate-limiting library, no per-user/per-IP throttling. The only concurrency control is client-side (`MAX_FILES = 3` resumes per screening submission, `CONCURRENCY = 3` inside the screening route).
- **No queue, no message broker** (no Redis, no BullMQ, no SQS-equivalent) — confirmed absent from `package.json` and code search.
- **No dedicated caching layer** — no Redis, no `unstable_cache`/`revalidateTag` usage found. Supabase's PostgREST layer and Vercel's own edge/CDN caching for static assets are the only caching in play, both platform-default, not app-configured.
- **No centralized logging/observability service** — no Sentry, Datadog, LogRocket, or similar SDK in dependencies. Logging is `console.log`/`console.error`, captured by whatever the hosting platform captures by default (Vercel's function logs today).
- **Application-layer authorization** sits between routes and data: `lib/auth.ts`'s `isAdmin()`, `teamIdsFilter()`, and per-resource `canAccessProject()`/`canAccessScreening()`/`canAccessCalibrationExample()` checks, called explicitly inside route handlers (this is not framework middleware, it's function calls each route author must remember to include — see §9 for the security implication).

---

## 4. Database(s)

**Certain:** single datastore — **Supabase** (hosted Postgres + Auth + Storage). No ORM; all queries go through `@supabase/supabase-js`, either with the service-role key (server-side, all real data reads/writes, bypasses RLS) or the anon key (browser-side, session/auth handling only — never touches a data table directly).

- **Engine:** Postgres. Exact version is whatever Supabase's hosted product currently provisions — **inferred**, not pinned anywhere in this repo; the migration runbook states "Postgres 14+" as the portability floor if ever moved off Supabase, not the actual running version.
- **Connection model:** no raw `pg`/`postgres` driver dependency exists in `package.json` — the app never opens a persistent Postgres connection. `@supabase/supabase-js` talks to Supabase over its REST layer (PostgREST) via stateless HTTPS calls. **This means the classic serverless connection-pool-exhaustion problem does not apply here** — Supabase manages pooling on its own side. (Documented and verified in `docs/Cirot-Load-Testing-Assessment.md`, §5.)
- **Schema:** 43 SQL files in `supabase/migrations/` (updated count, 2026-08-21 — was 38 on 2026-08-11, all additive since, same idempotent pattern), run manually in the Supabase SQL editor — **there is no automated migration runner**. 13 tables total: `screenings` (the largest and most central — one row per screened candidate), `projects`, `tracker` (pipeline stage tracking), `teams`, `team_members`, `calibration_examples`, `fraud_calibration_examples`, `resume_fingerprints` (duplicate/fraud detection), `screening_batches`, `screening_actions` (audit trail), `archive_fit_candidates`, `access_requests`, `feedback`.
- **File storage:** one Supabase Storage bucket (`resumes`) holds uploaded resume files and LinkedIn PDF exports. Files are fetched server-side via `.storage.from().download()` — **no public URL generation found in the codebase**, meaning file access is gated through the app's own API routes and auth, not a public bucket. **Certain** from code; bucket-level ACL settings themselves should still be confirmed directly in the Supabase dashboard.
- **Row counts / data volume:** **not reliably inferable from code.** Historical session notes in `memory/` mention figures like "78 real candidate screenings" and "225+ candidates" from mid-2026 testing, but these are stale, point-in-time mentions from development sessions, not a current count — a live query against the `screenings` table is the only trustworthy source. The load/scale planning that *has* been done (§10) uses recruiter/request concurrency, not stored data volume, as its basis.
- **Row Level Security: explicitly not in use as the authorization boundary.** Two tables (`access_requests`, `feedback`) have RLS disabled by their own migration files; every other table has never had an RLS policy written at all, because the server exclusively uses the service-role key, which bypasses RLS regardless. All real access control is enforced in application code (§9). This is documented in the codebase's own `docs/Cirot-Database-Migration-Runbook.md`, §5, explicitly flagged there for a security-compliance pass: **if RLS-as-defense-in-depth is required, it is net-new work, not a migration of existing policy.**

---

## 5. External API Dependencies

**Certain**, from code and `.env.example`:

| Service | Purpose | Notes |
|---|---|---|
| **Anthropic Claude API** | All AI functionality: JD analysis, resume scoring, career trajectory generation, credibility/fraud assessment, interview question generation, cross-project fit matching, name-extraction fallback, resume-fingerprint generation for duplicate detection | **Model:** `claude-sonnet-4-6`, pinned as a single constant (`lib/anthropic.ts`). **14 distinct call sites** across `lib/` and `app/api/`, all synchronous (`messages.create`, awaited inline in the request). Called via `@anthropic-ai/sdk` with a server-side-only `ANTHROPIC_API_KEY`. **⚑ Flagged per your note: this is the integration point that needs to be re-pointed at the Microsoft OpenAI enterprise gateway.** Every call site uses the same thin wrapper (`getAnthropicClient()`), which is a good sign for swap scope — but the tool-use/function-calling schema pattern used throughout (`tools: [...]`, `tool_choice: { type: "tool", name: ... }`) is Anthropic-specific API shape, not a drop-in-compatible request format for an OpenAI-style endpoint. This needs to be scoped as a real porting effort (per-call-site schema translation and output parsing), not a config/env-var swap. See §10 for the load-testing document's existing assumptions about Anthropic's own rate-limit tiers, which will need to be redone against whatever the new gateway's limits are. |
| **Resend** (`api.resend.com`) | Transactional email — feedback and access-request notifications only | Optional: if `RESEND_API_KEY` is unset, the underlying features (saving to DB) still work, email just doesn't send. Low-volume, non-critical path. |
| **Supabase** | Database, Auth, Storage (see §4) | Also counts as an external managed service dependency, not just "the database." |

**Not integrated (despite documentation existing for some of these — worth flagging so the platform team doesn't assume they're live):**

- **LinkedIn** — no API integration. A "Lever profile"-style free-text field lets a recruiter paste a LinkedIn URL manually; LinkedIn Recruiter itself is used entirely outside the app, by design (its API is enterprise-only and was never in scope — see `CLAUDE.md`).
- **Lever** — `docs/Cirot-Lever-Integration-Brief.md` is a **written technical proposal only**, scoped for a future build (webhook/polling pull of candidates, status push-back). Nothing in the current codebase calls Lever's API. The only live Lever reference is a plain free-text URL input field where a recruiter can paste a candidate's Lever profile link — a UI convenience, not an integration.
- **GitHub, Stack Overflow, Indeed, Greenhouse, Workday** — no references found anywhere in the codebase. Not integrated, not scaffolded.

---

## 6. Containerization Readiness

**Certain: there is no Dockerfile, no `docker-compose.yml`, no `.dockerignore`, and no container config of any kind in this repo.** The app is built and deployed as a standard Next.js project targeting Vercel's serverless/edge runtime model, not a container runtime.

What would need to change to containerize cleanly:

- **Add a `Dockerfile`.** Next.js supports a `standalone` output mode (`output: "standalone"` in `next.config.ts` — not currently set) that produces a minimal, self-contained server bundle designed for exactly this; without it, a container build would need to ship the full `node_modules` tree, which is unnecessarily large.
- **Pin a Node version.** Nothing in the repo currently declares one (§1) — needed for a reproducible base image.
- **Externalize configuration properly.** The app already reads all secrets via `process.env` (good — see §7), so this part needs no code change, just a real secrets-injection mechanism at the container/orchestration layer instead of Vercel's dashboard-managed env vars.
- **Decide what happens to `maxDuration`.** This is a Vercel-specific serverless function config (`export const maxDuration = 300` etc., §2) with no equivalent meaning in a container/long-running-process model — those values (and the reasoning behind them, documented inline in `app/api/screen-resumes/route.ts`) should inform request-timeout configuration at whatever reverse proxy/ingress sits in front of the container, not be assumed to port over automatically.
- **Decide what happens to file uploads and Storage.** Resume files currently go straight to Supabase Storage from the server route (no local disk writes found in the upload path) — this should containerize cleanly as-is, but is worth an explicit check during the port, since serverless-vs-container environments handle ephemeral filesystem differently.
- **No test suite exists to validate a container build against** (§1) — worth flagging as a gap independent of containerization itself.

Nothing else in the app's architecture (stateless request handling, no local file writes, no in-memory session state outside the request lifecycle) looks like it would resist containerization — the gap is entirely "this config doesn't exist yet," not "this app is built in a way that fights containers."

---

## 7. Current Hosting and Secrets

**Certain:**

- **Hosting: Vercel.** `.vercel` is gitignored (confirms Vercel CLI/dashboard-linked deployment); `app/api/screen-resumes/route.ts` contains an extensive inline comment explicitly reasoning about Vercel plan tiers (Hobby vs. Pro/Enterprise, Fluid Compute) — the code assumes and requires a plan where `maxDuration` above 60s is supported. **Inferred:** since this ships and presumably runs today, the live deployment is on a Pro/Enterprise plan or Hobby-with-Fluid-Compute — not independently confirmed against the Vercel dashboard.
- **Secrets management: environment variables only, no secrets manager.** `.env.example` documents every required/optional variable (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `NOTIFICATION_EMAIL`, `NEXT_PUBLIC_APP_URL`) with inline comments on what each does and what breaks if unset. In production, these are set directly in Vercel's Project Settings → Environment Variables UI — no Vault, no AWS Secrets Manager, no equivalent.
- `.gitignore` excludes all `.env*` files except `.env.example` — **no secrets found committed to the repository** in the review for this document.
- One real fallback URL is hardcoded in two notification routes (`https://hire-view.vercel.app`, used only if `NEXT_PUBLIC_APP_URL` is unset) — not a secret, but worth knowing it points at the original personal deployment and should be overridden via env var for any other environment.

---

## 8. CI/CD

**Certain: none exists.** No `.github/workflows/` directory, no other CI config file (no CircleCI, GitLab CI, Jenkins, etc. config found) — confirmed via direct search of the repo.

- **Build/deploy today** is Vercel's git-integration auto-deploy (push to a connected branch → Vercel builds and deploys) — **inferred** from the Vercel hosting setup (§7) and the project's own history of PR-based merges to `main`, not independently confirmed against Vercel's project settings.
- **No automated test gate** (no tests exist to gate on, §1) and **no automated lint/typecheck gate** in CI — `npm run lint` and `tsc --noEmit` exist as scripts but nothing invokes them automatically on push/PR today.
- **No staging environment config found** — no separate `.env.staging` or environment-specific Vercel project references in the repo; whether a staging deployment exists is a Vercel-dashboard question, not something this codebase answers.

---

## 9. Existing Security Posture

**Certain, from code:**

- **Authentication:** Supabase Auth (email/password), session managed via cookies, verified server-side on every request through `middleware.ts` using `supabase.auth.getUser()` (a real round-trip to the Auth server, not just trusting a cookie's contents — explicitly chosen over `getSession()` for this reason, per an inline code comment).
- **Authorization model:** role-based (`admin` | `recruiter`, stored in `user.app_metadata.role`) plus a Teams model (`teams`/`team_members`) for multi-tenant-style scoping — a recruiter sees only their team(s)' projects/candidates; an admin sees everything. Enforced entirely in application code (`lib/auth.ts`), not database RLS (§4) — meaning every new route that touches team-scoped data must remember to call the right helper, or it silently has no access boundary. The codebase's own audit history (`memory/decisions-log.md`) documents at least one real cross-team data-leak bug found and fixed this way in the past (a by-id route missing a team-ownership check) — worth the platform/security team independently re-auditing every route rather than trusting this document's snapshot.
- **PII / candidate data handled:** candidate name, resume files (PDF/Word, stored in Supabase Storage), parsed resume text (stored inline in the `screenings` table as `job_description`/summary/etc. text columns), a `credibility` JSONB blob (AI-generated assessment, may reference discrepancies found in the resume), an optional `photo_url`, and free-text fields a recruiter can add (`notes`, `flag_note`). No SSNs, financial data, or government IDs are collected anywhere in the schema.
- **Encryption:** at-rest and in-transit encryption for both the database and storage bucket are Supabase platform defaults — **inferred**, not configured or overridden anywhere in this codebase, so whatever Supabase's standard guarantee is applies as-is.
- **No RLS as a second authorization layer** (§4) — flagged again here because it's the most likely finding in a formal security review; the codebase's own migration runbook already anticipates and documents this gap.
- **No rate limiting, no WAF/bot-protection config, no CSRF-token mechanism found** beyond what Next.js/Vercel provide by default. No dependency-scanning or SAST tooling configured in-repo.
- **No compliance documentation** (SOC 2, data processing agreements, etc.) exists inside this codebase — out of scope for a code inventory, flagged only so the platform team doesn't expect to find it here.

---

## 10. Expected Load

Real production figures (~54 recruiters, ~18,900 candidates/month) will be supplied separately per your note — this section covers what the codebase itself assumes and what's already been analyzed, so the real numbers can be checked against it directly.

**Certain, from `docs/Cirot-Load-Testing-Assessment.md`** (an existing internal assessment written 2026-07-23 for a prior 56-recruiter pilot — close to your stated 54, so its math is directly reusable):

- Hard-coded client-side cap: **3 resumes per screening submission** (`MAX_FILES`), processed in-app with **concurrency of 3** — so one recruiter's one submission generates at most **6 concurrent Claude API calls** (scoring + fingerprinting run in parallel per resume).
- At 10 concurrently active recruiters (a realistic sustained-peak estimate across time zones), that's **60–120 concurrent Claude API calls**; the full 54-56-recruiter simultaneous worst case is **~320-336 concurrent calls** — a real upper bound, not a realistic steady state.
- The architecture itself (stateless serverless functions, PostgREST-based Supabase access with no connection pool to exhaust) **scales horizontally with no shared-state bottleneck in the code** — the existing assessment's conclusion was that the *code* isn't the constraint at this scale; the **LLM provider's rate-limit tier is**.
- **This is the section most directly affected by the Microsoft OpenAI gateway migration you flagged in §5:** the existing load assessment's rate-limit analysis is entirely about Anthropic's tier system and does not transfer to the new gateway. Whatever request-per-minute / token-per-minute ceiling the OpenAI enterprise gateway account is provisioned at needs the same kind of explicit confirmation this document gave for Anthropic, before go-live — this is flagged in the existing assessment as "the single most important unresolved item," and that's equally true for whichever provider ends up serving these calls.
- 18,900 candidates/month, spread over reasonable working hours, works out to roughly 600-700 candidates/day — well within what the *architecture* supports per the above; the open question is purely the provider-side rate limit once the gateway swap happens, not anything in this codebase.

---

## Addendum, 2026-08-21 — one architecture change since this doc was written

A "Gate 1" checklist pass/fail step was added ahead of the full AI scoring call (2026-08-19/20):
for a project with a configured checklist, a cheap Claude call evaluates the resume against a
short checklist first; only candidates who clear it proceed to the full scoring/fingerprinting
pipeline described in §2 and §10. Below-threshold candidates skip the expensive calls entirely.
**Relevant to §10 (Expected Load):** this reduces average Claude calls per candidate for
checklist-gated projects, not increases it — the existing concurrency/rate-limit analysis in §10
is still a valid upper bound, just conservative for projects using this gate. No new external
service, no new call pattern shape (same `tools`/`tool_choice` schema as every other call site) —
does not change anything in §5's gateway-migration scope.

---

## Summary of flags for the platform team

1. **Anthropic → Microsoft OpenAI gateway swap is a real porting effort**, not a config change — 14 call sites use Anthropic's tool-use API shape.
2. **No containerization exists today** — clean gap, not a fight against the architecture; needs a `Dockerfile`, `output: "standalone"`, and a pinned Node version at minimum.
3. **No RLS, no rate limiting, no CI/CD, no automated tests** — all real gaps for an enterprise platform review, all already self-documented inside this codebase's own `docs/`.
4. **Authorization is entirely application-code-enforced**, not database-enforced — worth an independent security audit of every route, not just this document's read of it.
5. **LLM rate-limit tier at the new gateway is the load-bearing unknown** for the stated recruiter/candidate volume — the code itself is not the bottleneck.
