# HireView — Load Testing / Scale Assessment for the Brillio Pilot

*Written 2026-07-23. Assesses HireView's current architecture against 56 concurrent recruiters across 5 geographies, with current, sourced figures for Anthropic and Vercel limits rather than assumed ones (see Sources at the end).*

## 1. Current concurrency limits (as built today)

- **`app/api/screen-resumes/route.ts`'s `CONCURRENCY = 3`** — resumes within a single screening request are scored in waves of 3 at a time.
- **`components/ResumeUploader.tsx`'s `MAX_FILES = 3`** — a recruiter can only submit 3 resumes per screening request (added 2026-07-20 specifically to guarantee every request maps to exactly one `CONCURRENCY` wave — see `memory/decisions-log.md`).
- **Net effect: one screening submission from one recruiter = at most 3 resumes scored simultaneously**, never more, by design.
- Per resume, scoring fires **two concurrent Claude API calls** — `scoreCandidate()` (the score itself) and `generateFingerprint()` (fraud/duplicate detection) — run via `Promise.all`, not sequentially (a 2026-07-20 perf fix). So one recruiter's one max-size (3-resume) submission generates **up to 6 concurrent Claude API calls** for the few seconds it takes to score that batch.

## 2. Estimated API call volume at peak

Extrapolating directly from the above, with no new assumptions:

| Concurrent recruiters actively screening | Concurrent Claude API calls (worst case, everyone submitting a full 3-resume batch at the same instant) |
|---|---|
| 1 | 6 |
| 10 | 60 |
| 56 (every recruiter, simultaneously — a real upper bound, not a realistic steady state) | 336 |

In practice, 56 recruiters across 5 time zones (India, USA, UK, Romania, Mexico) will rarely all be actively screening in the same instant — but 10-20 concurrently active during any given region's overlap hours is a realistic planning number, putting sustained peak load in the **60–120 concurrent Claude call** range, not the 336 all-56 upper bound.

Separately, other Claude-calling features add to this baseline but at much lower, bursty volume, not sustained concurrency: JD analysis (once per new project, not per resume), credibility/cross-reference checks (one-off, recruiter-initiated), cross-project-fit's cheap gate call (one per below-threshold candidate).

## 3. Anthropic API rate limits — action item, not yet resolved

Anthropic's Claude API rate limits are tier-based (RPM/ITPM/OTPM), scaling from a low Tier 1 (~50 RPM, tens of thousands of tokens/minute) up through Tier 4 (hundreds of RPM, up to a 2,000,000 input-tokens-per-minute ceiling on Sonnet-class models), with a Custom/enterprise tier above that negotiated directly with Anthropic rather than fixed.

**This is the single most important unresolved item in this whole assessment: moving from Vlad's personal API key to Brillio's enterprise Anthropic account must include explicitly confirming what rate-limit tier that account is provisioned at.** At only 10 concurrently active recruiters, this app can burst to ~60 simultaneous Claude API calls — comfortably within a Tier 3/4 or Custom account's limits, but a real risk of 429 rate-limit errors on a lower tier. **Recommendation: request Tier 4 or a Custom/negotiated enterprise rate limit for Brillio's account before the pilot's demo sessions, and load-test against the real account once provisioned** — this can't be fully verified from the codebase alone; it depends on whatever tier Brillio's account actually gets set up at.

## 4. Vercel serverless function limits — less constrained than the current code assumes

`app/api/screen-resumes/route.ts` and `app/api/assess-credibility/route.ts` both set `maxDuration = 60` (60 seconds); `app/api/screenings/save-one/route.ts` sets `maxDuration = 30`. These were chosen conservatively during earlier development, not because the platform requires it.

**Current Vercel duration limits, with fluid compute (enabled by default today):**

| Plan | Default | Maximum (GA) | Extended maximum (beta) |
|---|---|---|---|
| Hobby | 300s | 300s | — |
| Pro | 300s | 800s | 1800s (30 min) |
| Enterprise | 300s | 800s | 1800s (30 min) |

Brillio's enterprise deployment will almost certainly run on a Pro or Enterprise Vercel plan, both of which support up to **800 seconds (over 13 minutes)** generally available, or up to 30 minutes on the extended-duration beta — dramatically more headroom than the current `60`/`30` second values in the code. **This is not a hard platform ceiling forcing the current `MAX_FILES = 3` upload cap** — that cap was a deliberate, working fix for a real timeout bug on the current conservative `maxDuration = 60`, but if Brillio wants recruiters to screen larger batches at once, raising `maxDuration` (e.g. to 300s) and `MAX_FILES` together is a real, available option, not blocked by the hosting platform. Recommending against removing the cap without also reconsidering the timeout math server-side, since `CONCURRENCY = 3` combined with more files just means more *sequential waves* inside a longer-but-still-finite duration — the math needs to stay consistent, not just relaxed on one side.

## 5. Supabase — no traditional connection-pooling risk

HireView's server code never opens a raw Postgres connection — `lib/supabase.ts`'s `getSupabaseClient()` uses `@supabase/supabase-js`, which talks to Supabase over its REST API (PostgREST), not a persistent `pg` connection (confirmed: no `pg`/`postgres` driver dependency exists anywhere in `package.json`). Each Vercel serverless invocation makes stateless HTTPS calls; Supabase's own infrastructure handles connection pooling on its side. This means the classic serverless failure mode — exhausting a fixed Postgres connection pool under concurrent cold starts — **does not apply to this architecture as built.** The real Supabase-side scaling question is the project's own compute tier (database size/CPU/RAM on Supabase's side) handling 56 concurrent users' query volume, which is a Supabase plan/tier question for Brillio's infra team, not a code-architecture risk.

## 6. Recommendation summary

1. **Confirm Brillio's Anthropic enterprise account's rate-limit tier before go-live** — this is the one item genuinely outside this codebase's control and the most likely real bottleneck at pilot scale. (See §3.)
2. **No urgent code change required for 56 recruiters at the current `MAX_FILES = 3` / `CONCURRENCY = 3` limits** — the architecture (stateless serverless functions, PostgREST-based Supabase access, per-request-bounded Claude concurrency) scales horizontally by design; there's no shared-state bottleneck in the code itself.
3. **Optional, not urgent: consider raising `maxDuration` and `MAX_FILES` together** now that real Vercel headroom (800s+) exists, if Brillio wants recruiters to screen more than 3 resumes per submission — a real option, not previously available at Vlad's personal usage scale, but a deliberate scope decision, not something to change unilaterally.
4. **Load-test against the real Brillio Anthropic account once provisioned**, not just this assessment's arithmetic — actual concurrent-call behavior depends on the account's real tier, which can't be verified from the codebase.

## Sources

- [LLM API Rate Limits (2026): OpenAI, Anthropic & DeepSeek RPM and TPM by Tier](https://www.requesty.ai/blog/rate-limits-for-llm-providers-openai-anthropic-and-deepseek)
- [Claude API Quota Tiers and Limits Explained: Complete Guide 2026](https://www.aifreeapi.com/en/posts/claude-api-quota-tiers-limits)
- [Vercel — Configuring Maximum Duration for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
