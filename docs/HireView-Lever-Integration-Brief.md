# HireView ↔ Lever Integration — Technical Brief

*For: Brillio Digital Office team. Written 2026-07-23, ahead of the HireView enterprise pilot. Sourced against Lever's current public developer documentation (see Sources).*

## What this would enable

Today, a recruiter manually uploads resumes into HireView to be screened. This integration would let HireView pull candidates directly from Lever automatically, and push screening results back — closing the loop without a manual export/import step in either direction:

- **Candidate pull:** new applicants on a Lever job posting flow into the matching HireView project automatically, ready to be screened, with no manual download/upload.
- **Status sync back to Lever:** once HireView scores and moves a candidate through its pipeline (Recruiter Screen → Contacted → Screening → Archived), that status reflects back onto the candidate's record in Lever, so a recruiter working primarily in Lever still sees HireView's assessment without opening a second tool.

## What Lever API access is needed

Lever's API (root: `https://api.lever.co/v1`) is JSON-over-HTTPS, authenticated in one of two ways:

- **API key (Basic Auth)** — the right fit here, since this is Brillio's own internal integration against Brillio's own Lever account, not a public third-party app. Simpler to set up and operate than the OAuth partner-app flow, which exists for external vendors integrating into many different customers' Lever accounts.
- Standard rate limit: 10 requests/second per key (burst to 20/sec).

Three resource areas cover this integration's full scope:

| Resource | Used for |
|---|---|
| **Postings** | List Brillio's open job postings — each maps 1:1 to a HireView project. |
| **Opportunities** | The candidate + their application to a specific posting — this is what gets pulled into HireView as a screenable resume, and what gets updated when HireView's status changes. |
| **Candidates** | The underlying person record (contact info, resume file) an opportunity points to. |

## How HireView would receive new candidates

Two options, not mutually exclusive:

- **Webhooks (recommended for the real-time experience):** Lever supports webhook events including `applicationCreated` (fires when someone applies to a posting) and `candidateStageChange`. HireView would need one new endpoint (e.g. `POST /api/integrations/lever/webhook`) that verifies Lever's HMAC-SHA256 signature, then pulls the referenced opportunity's resume and creates a screening in the matching project automatically.
- **Polling (simpler fallback, or a belt-and-suspenders backup to webhooks):** a scheduled job periodically lists opportunities updated since the last run and does the same pull. Less real-time, but no public-facing endpoint to secure, and self-heals if a webhook delivery is ever missed (Lever retries failed webhook deliveries up to 5 times, but polling as a periodic reconciliation pass is still good practice for anything this operationally important).

Pushing status back to Lever (the reverse direction) is a plain authenticated API call from HireView's own server whenever a candidate's status changes in the app — no webhook needed for that half, since HireView already knows the moment it happens.

## What's new on HireView's side

- One new mapping table: which Lever posting corresponds to which HireView project, and which Lever opportunity corresponds to which HireView screening (needed so status-sync-back knows what to update, and so a webhook-triggered pull doesn't create duplicates).
- `LEVER_API_KEY` as a new environment variable, following the exact same pattern already used for `ANTHROPIC_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` — server-side only, never exposed to the browser.
- No changes needed to HireView's core scoring logic (`lib/scoreCandidate.ts` and the rest of the do-not-touch list) — this integration only affects how a resume *enters* HireView and how a status *leaves* it, not how scoring itself works.

## Estimated build time

Assuming Lever API access (an API key with the right scopes) is granted promptly:

- **One-way candidate pull (MVP):** webhook receiver + posting/opportunity mapping + resume download + auto-create screening — roughly **1–2 weeks**.
- **Two-way status sync back to Lever:** roughly **3–5 additional days**.
- **Hardening + real testing with the Digital Office team** (webhook signature verification, retry/dedup handling, a real end-to-end trial against a live Lever posting): roughly **1 week**.

**Total: ~3–4 weeks for a complete, production-ready two-way integration**, once API access is in hand. The single biggest variable outside this estimate is how quickly Lever API credentials and posting/field mapping decisions (which Lever custom fields, if any, need to carry through to HireView) can be confirmed with Brillio's Lever administrator.

## Sources

- [Lever API Overview and Reference](https://hire.lever.co/developer/documentation)
- [Lever ATS API: Postings, Candidates & OAuth Guide (2026)](https://www.getknit.dev/blog/lever-api-directory)
- [How to Integrate with the Lever API (2026 Engineering Guide)](https://truto.one/blog/how-to-integrate-with-the-lever-api-2026-engineering-guide)
