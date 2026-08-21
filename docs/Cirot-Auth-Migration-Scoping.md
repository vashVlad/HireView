# Cirot — Supabase Auth Migration Scoping

*Written 2026-08-11, ahead of the Brillio infrastructure transition. Purpose: map exactly what depends on Supabase Auth today, so the eventual migration is a known, bounded piece of work instead of a surprise. This is a scoping document only — no target provider is assumed, and no code changes were made preparing it.*

## Why this isn't just an infra swap

Moving the database off Supabase (Postgres) is close to a pure infra task — the app never opens a raw connection, it talks over `@supabase/supabase-js`'s REST layer, so a new Postgres instance plus a connection-string swap covers most of it. Auth is different: Cirot calls Supabase's own Auth API directly, by name, from application code — session verification, sign-in, and admin user management all go through `supabase.auth.*` methods. Replacing the provider means rewriting every one of those call sites against the new provider's own API/SDK, not just repointing an environment variable.

There's also a schema-level dependency that makes this bigger than the code touchpoints alone: several tables have real Postgres foreign keys pointing at `auth.users(id)` — Supabase's own internal users table. See §3.

## 1. What Supabase Auth actually provides today

- **Identity + session management** — email/password accounts, session cookies, token refresh.
- **The `role` field itself** — admin vs. recruiter isn't a Cirot-owned table column, it's stored in Supabase's own `user.app_metadata.role`, set via the Auth admin API.
- **Bulk user administration** — invite, list, update role, delete — all via `supabase.auth.admin.*`, used by the admin UI and the bulk recruiter-provisioning script.
- **The email confirmation / invite-link flow** — `/auth/callback` exchanges Supabase's one-time code for a session.

## 2. Every direct code touchpoint

| File | Call | Used for |
|---|---|---|
| `middleware.ts` | `supabase.auth.getUser()` | Verifies the session on every request (server-side round trip, not just reading a cookie) |
| `lib/auth.ts` | `supabase.auth.getUser()` | `getAuthUser()` — the single helper nearly every API route calls first |
| `app/login/page.tsx` | `supabase.auth.signInWithPassword()` | Login form |
| `components/SignOutButton.tsx`, `components/SiteHeader.tsx` | `supabase.auth.signOut()` | Sign-out |
| `app/auth/callback/route.ts` | `supabase.auth.exchangeCodeForSession()` | Invite/magic-link landing |
| `app/auth/set-password/page.tsx` | `supabase.auth.updateUser({ password })` | First-login password set |
| `app/api/admin/users/route.ts` | `supabase.auth.admin.listUsers()` / `.createUser()` / `.updateUserById()` / `.deleteUser()` | Admin user management UI (invite, role change, remove) |
| `lib/recruiters.ts`, `lib/screeningActions.ts`, `lib/teams.ts`, `app/api/analytics/route.ts` | `supabase.auth.admin.listUsers()` | Building an id → email/name map for display (Pipeline, Analytics, FunnelView, Tracker) |
| `scripts/provision-enterprise-teams.ts` | `supabase.auth.admin.createUser()` / `.listUsers()` | Bulk recruiter account creation from a roster CSV |

That's **13 call sites across 10 files** — bounded and fully enumerated, not an unknown quantity.

## 3. The bigger dependency: schema-level foreign keys into `auth.users`

Four migration files create real Postgres FK constraints against Supabase's internal `auth.users(id)`:

- `supabase-migration-teams.sql` — `team_members.user_id`, `teams.created_by`
- `supabase-migration-batches.sql` — `screening_batches.user_id`
- `supabase-migration-screening-actions.sql` — `screening_actions.user_id`
- `supabase-migration-archive-fits.sql` — `archive_fit_candidates.checked_by`/`decided_by`

Plus `screenings.user_id` and `projects.user_id`/`calibration_examples.user_id` (added by `supabase-migration-multiuser.sql`) store the same Supabase user UUIDs, without a formal FK in that case, but same dependency in practice.

**This is the part that makes the migration a real data-modeling decision, not just a code port.** Whoever replaces Supabase Auth needs to either preserve the same UUID identity space (so these existing FKs and stored user ids stay valid against the new provider's user records) or run an explicit identity-mapping migration across every one of these columns. Worth deciding this direction early — it changes how much of the existing `user_id` data can carry over as-is.

## 4. What ISN'T affected

Worth stating plainly so this doesn't get overscoped: everything downstream of auth — the actual data layer (`lib/screenings.ts` and the rest), the LLM scoring pipeline, FunnelView, the Excel export, resume storage — reads and writes through the service-role Supabase client (`lib/supabase.ts`), which is unrelated to Supabase Auth and unaffected by this migration. Authorization logic (`isAdmin()`, `teamIdsFilter()`, `canAccessProject()` in `lib/auth.ts`) is Cirot's own code, not Supabase's — it only *reads* `user.app_metadata.role`, sourced from whatever the new auth call returns in its place.

## 5. What to check once a target provider is picked

Not resolvable until Brillio names one, but worth having as a checklist the moment they do:

- **Session model compatibility with `middleware.ts`'s pattern** — Cirot verifies sessions server-side on every request via a cookie-backed client (`@supabase/ssr`'s `createServerClient`). Not every provider's SDK has a drop-in equivalent for Next.js middleware; some (e.g. enterprise SSO/Azure AD-style providers) use a fundamentally different token/redirect flow.
- **An equivalent to the admin API** (`listUsers`, `createUser`, `updateUserById`, `deleteUser`) — needed for both the admin UI and the bulk-provisioning script; not every provider exposes user management the same way.
- **Where `role` (admin/recruiter) lives** — currently Supabase-hosted `app_metadata`. A new provider may want this in Cirot's own `screenings`-adjacent schema instead, which is a small, contained code change (`lib/auth.ts`'s `isAdmin()`) once decided.
- **Identity/UUID continuity** — see §3.

## Summary

13 call sites, 10 files, fully enumerated — plus 4+ tables with real foreign keys into Supabase's internal user table. Bounded, known scope; the honest complexity is the identity-continuity decision in §3, not the code itself. No action taken against any of this yet — scoping only.
