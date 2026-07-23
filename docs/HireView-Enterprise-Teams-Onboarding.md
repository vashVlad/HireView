# HireView — Teams Architecture for the Brillio Geography Pilot

*Written 2026-07-23. Covers how HireView's existing Teams model maps to the 5-geography pilot structure, and the onboarding flow for the initial 56 recruiters.*

## 1. The existing architecture already fits this need — nothing new to build

HireView's Teams model (Admin → Team → Projects → Users), shipped 2026-07-09 as Phase 1.3 and in daily use since, is a direct fit for "each region operates as its own team":

- **`teams`** — one row per team. A geography (India, USA, UK, Romania, Mexico) is just a team with that name; there is nothing India-specific or geography-specific to build.
- **`team_members`** — many-to-many between `teams` and `auth.users`. A recruiter belongs to one or more teams.
- **`projects.team_id`** — every open role belongs to exactly one team (source of truth).
- **`screenings.team_id`** — denormalized from the project at save time, so list queries filter with a plain `.in("team_id", ...)` instead of a join.

## 2. Confirmed: admin sees everything, recruiters see only their own team

This isn't new behavior to build or a claim to take on faith — it's the existing, already-shipped, already-load-bearing access model, verified directly against the code:

- **`lib/auth.ts`'s `isAdmin(user)`** — checks `user.app_metadata.role === "admin"`.
- **`teamIdsFilter(user)`** — returns `undefined` for an admin (meaning: no team filter applied, sees every team's data) or the real array of team ids a recruiter belongs to. `GET /api/projects` and `GET /api/history` both scope through this.
- **`canAccessProject(user, projectId)` / `canAccessScreening(user, screeningId)`** — by-id access checks (added in a 2026-07-16 audit, closing a real cross-team data leak that existed before it — see `memory/decisions-log.md`) — always `true` for an admin, otherwise checks the specific record's `team_id` against the caller's own team memberships.
- **A recruiter belonging to 2+ teams sees the union of all of them** — nothing today assumes exactly one team per user, so a recruiter who needs visibility into more than one geography (e.g. a lead covering both UK and Romania) is just a matter of adding them to both teams via `team_members`, no code change.

This was independently re-verified as part of a full multi-team-readiness audit earlier this same week (2026-07-21) — see `memory/decisions-log.md`'s matching entry — which found and closed the one real gap that existed (two screening-submission routes that hadn't been included in the by-id audit). As of that fix, the by-id access-control layer is consistent everywhere it's been checked.

## 3. Creating the 5 geography teams

New `scripts/provision-enterprise-teams.ts` (this pass) creates the 5 teams — India, USA, UK, Romania, Mexico — and bulk-creates/assigns recruiter accounts from a roster CSV in one run, rather than an admin using the `/admin/users` UI to invite 56 people one at a time. See the script's own header comment for the exact CSV format and usage. It reuses the same underlying functions the admin UI itself calls (`lib/teams.ts`'s `createTeam`/`addTeamMember`, the same `supabase.auth.admin.createUser` call `POST /api/admin/users` makes) — this is a bulk driver over the real code path, not a separate implementation.

If Brillio prefers doing this through the UI instead (e.g. to keep a human confirming each account), the exact same result is achievable manually:

1. Admin → Team page (`/admin/users`) → "New team name" → create each of the 5 teams once.
2. For each recruiter: "Invite a team member" form (email + role + temp password) → Send invite.
3. On each newly created team's card, use "Add member" to assign that recruiter to their geography's team.

## 4. Onboarding flow and time estimate for 56 recruiters

**Order matters — do this before recruiters start using the app, not incrementally:**

1. **Create the 5 teams first** (either via the script or the UI, §3). Takes seconds via the script; a few minutes via the UI.
2. **Create all 56 recruiter accounts and team assignments.** Via the script: one run, a few minutes total (network-bound, not human-bound) — see the script's own output for a per-row created/skipped/failed report and a distributable list of temporary passwords. Via the UI: realistically 2–3 minutes per recruiter (invite form + add-member popover) × 56 ≈ **2–3 hours of admin time**, plus whatever time it takes to distribute temp passwords individually.
3. **Distribute temporary passwords** through whatever secure channel Brillio's rollout plan calls for (this project has no automated invite-email flow today — `createUser` deliberately skips it, see `lib/screenings.ts`'s onboarding history for why — accounts are created pre-activated with a temp password, not an email invite link).
4. **Have each recruiter sign in once and change their password** (`/auth/set-password`, reachable from the account dropdown) before real use begins.
5. **Assign each geography's projects to its team** — a project is created by whoever posts the role and auto-assigned to their own primary team at creation time; if Brillio wants specific roles pre-loaded per region before recruiters arrive, an admin creates those projects while impersonating (or being) a member of the right team, or reassigns a project's team afterward via the drag-and-drop Team/Projects panel on `/admin/users`.
6. **Demo session per region, as planned** — walk each geography's recruiters through Projects → New Role → Screen → Pipeline → Tracker once their own team/account is live, so the first real usage isn't also the first time they've seen the tool.

**Total estimate:** script-driven provisioning (steps 1–2) is minutes, not hours — the actual time sink is password distribution and the demo sessions themselves, both of which are process/scheduling work, not technical work.

## 5. One open design point, not yet decided

Today, a new project auto-assigns to its creator's own primary team with no selector UI (documented as deliberate — "everyone's on exactly one team today" was true until now). With 56 recruiters across 5 real teams, **an admin creating a project on someone else's behalf, or a recruiter who ends up on 2+ teams, will hit this gap** — there's no way to pick which team a new project belongs to at creation time, only to reassign it afterward via the admin panel. Worth deciding before go-live whether that's acceptable (reassign-after-create is a real, working workaround) or whether a team selector should be added to the New Role flow. Flagging rather than silently building it, since it's a real scope decision, not obviously part of "document the existing architecture."
