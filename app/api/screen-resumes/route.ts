import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { generateFingerprint } from "@/lib/generateFingerprint";
import { extractGithubUsername, fetchGithubCorroboration } from "@/lib/githubCorroboration";
import { saveScreening, setScreeningEmbedding } from "@/lib/screenings";
import { generateEmbedding, buildCandidateEmbeddingText } from "@/lib/embeddings";
import { combineTargetCompanies, computeTargetCompanyBoost } from "@/lib/targetCompanyBoost";
import { evaluateGate1 } from "@/lib/evaluateGate1";
import { buildGate1ArchivedResult } from "@/lib/buildGate1ArchivedResult";
import { buildTargetCompanyGateArchivedResult } from "@/lib/buildTargetCompanyGateArchivedResult";
import { DEFAULT_SCORE_THRESHOLD } from "@/lib/scoreThreshold";
import { getProject, getProjectChecklist, getProjectTargetCompanyGate } from "@/lib/projects";
import { canAccessProject, getAuthUser, userIdFilter } from "@/lib/auth";
import type { CandidateResult, ScreenResumesError } from "@/lib/types";

// DO-NOT-TOUCH EXCEPTION (2026-07-29, Vlad's explicit ask — see
// decisions-log.md): raised from 60 to Vercel's Pro-plan ceiling (300s) —
// Vlad reported a screening error on exactly 3 resumes (one full
// CONCURRENCY batch) where the resumes had actually saved successfully
// server-side despite the client seeing an error, matching this project's
// own documented 2026-07-20 timeout pattern almost exactly (see
// components/ResumeUploader.tsx's MAX_FILES comment) — except that fix
// capped uploads at one batch specifically to stay under the 60s ceiling,
// and enough extra per-resume work (fingerprinting, cross-project
// matching, history alerts, batch_id) has been added since that even one
// batch can apparently brush up against it now. Raising the ceiling is one
// half of the fix, alongside the lib/screenings.ts efficiency pass below
// this file (parallelized independent lookups, one fewer DB round trip per
// resume).
//
// IMPORTANT — this is NOT a safe-by-default change on every plan: on
// Vercel's Hobby plan WITHOUT Fluid Compute enabled, setting maxDuration
// above 60 fails the DEPLOYMENT outright (a build-time error), it does not
// just get silently clamped. This only deploys cleanly on a Pro/Enterprise
// plan, or on Hobby with Fluid Compute turned on (which raises Hobby's own
// ceiling to 300s too). Confirm one of those is true before merging this —
// if neither is, drop this back to 60 and rely on the efficiency pass alone
// (still a real improvement, just not as much margin).
export const maxDuration = 300;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = userIdFilter(user);
  // Narrowed into its own const, 2026-07-29 perf pass: `user.id` inside the
  // `score()` closure below loses TS's null-check narrowing (closures over a
  // captured variable can't prove it wasn't reassigned by the time they
  // run), even though `user` is a plain const already checked non-null
  // above. Same real value either way.
  const actingUserId = user.id;

  // DO-NOT-TOUCH EXCEPTION (2026-07-28, Vlad's explicit ask — see
  // decisions-log.md): groups every screening saved by this one call under a
  // shared id, so the results can be reopened later via a real,
  // database-backed, cross-device URL (/projects/[id]/batches/[batchId])
  // instead of the client-side-only "results" view this route's response
  // has always fed. Purely additive — generated up front, threaded through
  // to saveScreening below, and echoed back in the response; no scoring or
  // save logic changed. REQUIRES supabase-migration-batch-id.sql to have
  // run first (see lib/screenings.ts's saveScreening — batch_id is written
  // unconditionally on every save once this line exists).
  const batchId = randomUUID();

  const formData = await request.formData();
  const jobDescriptionField = formData.get("jobDescription");
  const jdFileField = formData.get("jdFile");
  const files = formData.getAll("resumes");
  const projectIdField = formData.get("projectId");
  const projectId = typeof projectIdField === "string" && projectIdField.trim()
    ? parseInt(projectIdField.trim(), 10) || undefined
    : undefined;
  // DO-NOT-TOUCH EXCEPTION (2026-07-21 — see decisions-log.md): this route
  // took a client-supplied projectId and used it to pull that project's JD
  // analysis, score threshold, and full calibration-example text into the
  // scoring call — and to tag the saved screening's team_id — with no check
  // that the requesting user's team actually owns that project. Every other
  // by-id route got this check in the 2026-07-16 audit
  // (canAccessProject/canAccessScreening in lib/auth.ts); this route and
  // screenings/save-one/route.ts were missed since they're POST routes with
  // a projectId buried in form data, not the "/api/x/[id]" shape that audit
  // was framed around. Without it, any authenticated recruiter on any team
  // could screen against another team's project — leaking that team's JD
  // and calibration examples into their own scoring call, and writing a
  // screening record with the victim team's team_id. Fix is additive: skip
  // the check entirely when no projectId was supplied (ad hoc screening,
  // nothing to leak); otherwise 403 exactly like the existing
  // app/api/projects/[id]/route.ts pattern. No other logic in this route
  // was touched.
  if (projectId && !(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const linkedInModeOverride = formData.get("linkedInMode") === "true";
  // DO-NOT-TOUCH EXCEPTION (2026-07-20, Vlad's ask — see decisions-log.md):
  // Agency source, purely additive metadata plumbing, same shape as the
  // resumeText/fingerprint passthrough exceptions above it. Read here,
  // passed straight through to saveScreening below — does not reach
  // scoreCandidate() or affect scoring in any way, unlike linkedInMode.
  const agencyNameField = formData.get("agencyName");
  const agencyName = typeof agencyNameField === "string" && agencyNameField.trim() ? agencyNameField.trim() : undefined;

  let jobDescription: string;

  if (jdFileField instanceof File) {
    try {
      const buffer = Buffer.from(await jdFileField.arrayBuffer());
      jobDescription = await extractResumeText(jdFileField.name, buffer);
    } catch {
      return NextResponse.json(
        { error: `Could not read job description file: ${jdFileField.name}` },
        { status: 400 }
      );
    }
  } else if (typeof jobDescriptionField === "string" && jobDescriptionField.trim()) {
    jobDescription = jobDescriptionField;
  } else {
    return NextResponse.json(
      { error: "Provide a job description — either paste text or upload a file." },
      { status: 400 }
    );
  }

  // First non-empty line of the JD gives Claude a concise role label
  const roleContext = jobDescription
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  // Pull project config (LinkedIn context + per-role score threshold)
  let linkedInContext: string | undefined;
  // DO-NOT-TOUCH EXCEPTION (2026-08-20 — Claude Code's full-system audit
  // flagged this literal `45` as one of 9 hardcoded copies of the same
  // default scattered across the app; see lib/scoreThreshold.ts's own doc
  // comment). Same value, same fallback behavior, both places it appears in
  // this function — just sourced from one shared constant instead of two
  // separately-typed literals that could silently drift apart from each
  // other, let alone from the other 7 copies elsewhere in the app.
  let scoreThreshold = DEFAULT_SCORE_THRESHOLD;
  // DO-NOT-TOUCH EXCEPTION (2026-07-29 perf pass — see decisions-log.md):
  // this project fetch already happened here for linkedInContext/
  // scoreThreshold above — teamId just reads an already-fetched field off
  // the same object instead of every resume's saveScreening() call
  // re-fetching this same project row itself (see lib/screenings.ts's
  // params.teamId comment). Purely additive, no existing field changed.
  let teamId: number | null = null;
  // DO-NOT-TOUCH EXCEPTION (2026-08-07, Vlad's explicit ask — see
  // decisions-log.md): "score boost companies" (JD Analyzer, reuses
  // jdAnalysis.wide/narrow.targetCompanies) read off this SAME already-
  // fetched project object — zero extra DB round trips, same shape as
  // teamId just above. Passed straight through to saveScreening(), which
  // does the actual (deterministic, code-computed) score adjustment — see
  // lib/targetCompanyBoost.ts. Does not touch the scoreCandidate() call or
  // any of its inputs.
  let targetCompanies: string[] = [];
  // DO-NOT-TOUCH EXCEPTION (2026-08-17, Vlad's explicit ask — JD checklist):
  // read via getProjectChecklist(), NOT off the `project` object above —
  // deliberately isolated from listProjects()/getProject()'s shared select
  // (see lib/projects.ts's own comment on why: the exact same "one
  // not-yet-migrated column kills the whole query" incident already hit
  // current_company/current_title once, documented in
  // lib/funnelview/data.ts's fetchCurrentRoleColumn). Best-effort here
  // (.catch(() => null)) — a checklist read failure at screening time
  // degrades to "no checklist configured," it must never block scoring
  // itself, unlike the Filters-tab's own read/write of this same data.
  let checklist: Awaited<ReturnType<typeof getProjectChecklist>> = null;
  // DO-NOT-TOUCH EXCEPTION (2026-08-24, Vlad's explicit ask — target-company
  // pre-score gate, see decisions-log.md): read via getProjectTargetCompanyGate(),
  // same isolated/deferred-column pattern as getProjectChecklist() just below
  // (NOT part of the `project` object's shared select — a not-yet-run
  // migration must never break this route). Fails closed to `false` (gate
  // off) on any error, including the column not existing yet.
  let requireTargetCompanyMatch = false;
  if (projectId) {
    const project = await getProject(projectId).catch(() => null);
    linkedInContext = project?.jdAnalysis?.linkedInContext ?? undefined;
    scoreThreshold = project?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
    teamId = project?.teamId ?? null;
    targetCompanies = combineTargetCompanies(project?.jdAnalysis?.wide?.targetCompanies, project?.jdAnalysis?.narrow?.targetCompanies);
    checklist = await getProjectChecklist(projectId).catch(() => null);
    requireTargetCompanyMatch = await getProjectTargetCompanyGate(projectId).catch(() => false);
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one resume file is required" },
      { status: 400 }
    );
  }

  const results: CandidateResult[] = [];
  const errors: ScreenResumesError[] = [];

  // Best-effort: a calibration library issue shouldn't block screening.
  // Scoped to the current project so examples from other projects don't bleed
  // in — deliberately NOT scoped to userId (2026-07-20, Vlad's explicit ask,
  // do-not-touch exception, see memory/decisions-log.md): calibration
  // examples should accumulate project-wide as real screening experience and
  // benefit every recruiter working this role, not just whoever uploaded
  // them. Matching change on the display side in
  // app/api/calibration-examples/route.ts's GET handler.
  const calibrationExamples = await listCalibrationExamples(projectId).catch(() => []);

  // Extract text for every resume first — this is local parsing, no API
  // calls, so it's free to fully parallelize.
  const parsed: { fileName: string; text: string; buffer: Buffer; mimeType: string }[] = [];
  await Promise.all(
    files.map(async (file) => {
      if (!(file instanceof File)) return;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const resumeText = await extractResumeText(file.name, buffer);
        parsed.push({
          fileName: file.name,
          text: resumeText,
          buffer,
          mimeType: resolveMimeType(file),
        });
      } catch (error) {
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );

  async function score(resume: (typeof parsed)[number]) {
    try {
      // DO-NOT-TOUCH EXCEPTION (2026-08-24, Vlad's explicit ask — target-
      // company pre-score gate, see decisions-log.md's 2026-08-24 entry).
      // Runs BEFORE Gate 1's checklist evaluation, which is the cheapest-
      // first ordering: this check is a plain substring match
      // (computeTargetCompanyBoost, same function the score-boost feature
      // already uses) with zero AI calls, while Gate 1 below still needs one
      // real evaluateChecklist() call even to fail. Only takes effect when
      // the project has both the toggle on AND at least one target company
      // configured — an empty target-company list has nothing to gate on,
      // so every resume passes through unfiltered exactly as before. A
      // matched resume falls through to the unchanged Gate 1 branch below
      // with no other behavior difference.
      if (requireTargetCompanyMatch && targetCompanies.length > 0) {
        const gateBoost = computeTargetCompanyBoost(resume.text, targetCompanies);
        if (!gateBoost.matched) {
          const gateResult = await buildTargetCompanyGateArchivedResult({
            fileName: resume.fileName,
            resumeText: resume.text,
          });
          results.push(gateResult);
          try {
            const { id } = await saveScreening({
              result: gateResult,
              jobDescription,
              resumeFile: resume.buffer,
              resumeMimeType: resume.mimeType,
              resumeText: resume.text,
              fingerprint: null,
              linkedInMode: linkedInModeOverride,
              agencyName,
              projectId,
              userId,
              scoreThreshold,
              batchId,
              actingUserId,
              teamId,
              targetCompanies,
              checklistEvaluation: null,
              gate1Only: false,
              targetCompanyGateFailed: true,
            });
            gateResult.id = id;
          } catch (saveErr) {
            // Matches the identical catch block below (Gate 1 / full-score
            // path) — log only, same "the screening result already reached
            // the response, a persistence hiccup shouldn't turn it into a
            // reported error" reasoning.
            console.error("Failed to persist screening result:", saveErr);
          }
          return;
        }
      }

      // DO-NOT-TOUCH EXCEPTION (2026-08-19, Phase 2.6 — see decisions-log.md's
      // 2026-08-19 entries and memory/claude-code-handoff-2026-08-19-phase-2.6-
      // architecture.md). Gate 1 architecture: evaluateChecklist() no longer
      // runs as a third parallel branch alongside scoreCandidate() —
      // unconditionally paying for the full scoreCandidate()/
      // generateFingerprint() pair on every resume defeats the entire point
      // of a cheap first-pass gate for a high-volume applicant flow (Vlad's
      // explicit ask, 2026-08-19: "the checklist must be a main gate").
      // evaluateChecklist() now runs FIRST, alone — if this project has no
      // checklist configured, or the checklist score clears scoreThreshold,
      // behavior is unchanged from before (falls through to the same
      // scoreCandidate()/generateFingerprint() pair as always). Only when the
      // checklist score comes in below scoreThreshold does this branch: the
      // expensive pair never runs at all, and a lightweight stand-in result
      // (lib/buildGate1ArchivedResult.ts) is built instead.
      //
      // DO-NOT-TOUCH EXCEPTION (2026-08-20 — Claude Code's full-system audit
      // flagged this exact evaluate-checklist/compare-to-threshold shape as
      // duplicated in three places; see lib/evaluateGate1.ts's own doc
      // comment). The evaluate+compare logic below moved into that shared
      // helper — same evaluateChecklist call, same
      // computeChecklistPercentageScore call, same threshold comparison,
      // byte-for-byte, just no longer copy-pasted. Nothing about WHEN or
      // WHETHER the expensive scoreCandidate()/generateFingerprint() pair
      // runs changed — still exactly the same condition, still exactly the
      // same fallback build call for the gate1Only stand-in.
      const gate1 = await evaluateGate1({ checklist, resumeText: resume.text, scoreThreshold });
      const checklistEvaluation = gate1.checklistEvaluation;

      let gate1Only = false;
      let result: CandidateResult;
      let fingerprint = null;

      if (gate1.gate1Only) {
        gate1Only = true;
        result = await buildGate1ArchivedResult({
          fileName: resume.fileName,
          resumeText: resume.text,
          checklistScore: gate1.checklistScore!,
          checklistEvaluation: checklistEvaluation!,
        });
      } else {
        // DO-NOT-TOUCH EXCEPTION (flagged, 2026-07-20 perf pass — see
        // decisions-log.md): fingerprinting (fraud/duplicate detection) only
        // needs the raw resume text, not the score, so it never actually had
        // to wait for scoring to finish — it was just written sequentially
        // before. Running both Claude calls concurrently cuts the wait to
        // roughly whichever one is slower instead of the sum of both, with no
        // change to what either call does or what the response contains. A
        // fingerprint failure resolves to `null` (not a rejection) so it can
        // never fail the scoring half of this Promise.all — saveScreening
        // treats an explicit `null` as "don't retry, just skip
        // duplicate/history matching for this save," same as its
        // pre-existing best-effort behavior. Gate-1 failures skip this pair
        // entirely (2026-08-19, Phase 2.6) — least likely group to be a
        // sophisticated fraud attempt, not worth the token spend; they still
        // get the free resume_content_hash dedup check unconditionally
        // inside saveScreening() below, independent of this AI call.
        // DO-NOT-TOUCH EXCEPTION (2026-08-26, Vlad's ask: "pull [GitHub
        // links] and show them during the initial screening... up top nicely
        // before the trajectory"). GitHub extraction/lookup was previously
        // wired ONLY into the post-hoc cross-reference check
        // (app/api/assess-credibility/route.ts) — same free, code-side,
        // no-AI-cost helpers (lib/githubCorroboration.ts) now also run here,
        // as a third parallel branch alongside scoring/fingerprinting, same
        // fail-closed-to-null reasoning as generateFingerprint just below.
        // extractGithubUsername is a synchronous regex match (no cost either
        // way to run it unconditionally); the network fetch only fires when
        // a username was actually found, so a resume with no GitHub link
        // adds zero extra latency here.
        const githubUsername = extractGithubUsername(resume.text);
        const [scoreResult, fp, githubSignal] = await Promise.all([
          scoreCandidate(
            jobDescription,
            resume.fileName,
            resume.text,
            calibrationExamples,
            roleContext,
            linkedInContext,
            linkedInModeOverride
          ),
          generateFingerprint(resume.text).catch((err) => {
            console.error("Fingerprint generation failed (scoring unaffected):", err);
            return null;
          }),
          githubUsername
            ? fetchGithubCorroboration(githubUsername).catch((err) => {
                console.error("GitHub corroboration lookup failed (scoring unaffected):", err);
                return null;
              })
            : Promise.resolve(null),
        ]);
        result = scoreResult;
        fingerprint = fp;
        if (githubSignal) result.githubSignal = githubSignal;
      }
      results.push(result);

      // Persist every screened candidate, regardless of score (Teti's
      // request, 2026-07-10 — no candidate should be lost, including
      // below-threshold ones, so rejection history is visible later).
      // scoreThreshold now ALSO gates the initial status (see saveScreening's
      // auto-archive logic, lib/screenings.ts, 2026-07-15) in addition to the
      // cross-project fit suggestion — below-threshold candidates still get
      // saved, just straight into "archived" instead of "new_applicant".
      //
      // DO-NOT-TOUCH EXCEPTION (flagged per project convention): this file is
      // on the do-not-touch list. The only change here is adding the
      // already-locally-available `scoreThreshold` (computed above) to this
      // existing saveScreening call — no other logic in this route was touched.
      //
      // Awaited (not fire-and-forget): Vercel can freeze the function as
      // soon as the response is sent, which would silently drop an
      // un-awaited write.
      try {
        // DO-NOT-TOUCH EXCEPTION (flagged, 2026-07-20 perf pass — see
        // decisions-log.md): passes the resume text already extracted above
        // (in `parsed`, for scoring) through to saveScreening instead of
        // letting it silently re-extract the same PDF/DOCX a second time
        // internally. Same text, zero behavior change — pure perf.
        const { id } = await saveScreening({
          result,
          jobDescription,
          resumeFile: resume.buffer,
          resumeMimeType: resume.mimeType,
          resumeText: resume.text,
          fingerprint,
          linkedInMode: linkedInModeOverride,
          agencyName,
          projectId,
          userId,
          scoreThreshold,
          // DO-NOT-TOUCH EXCEPTION, same batchId — see the comment at the top of this route.
          batchId,
          // DO-NOT-TOUCH EXCEPTION (2026-07-29 perf pass — see
          // decisions-log.md): both already resolved once above (user at
          // the very top of this function, teamId alongside
          // linkedInContext/scoreThreshold) — passing them through lets
          // saveScreening skip its own internal getAuthUser()/getProject()
          // lookups, which used to run fresh for every resume in this
          // batch despite always resolving to the same values. See
          // lib/screenings.ts's params.actingUserId/params.teamId comments.
          actingUserId,
          teamId,
          // DO-NOT-TOUCH EXCEPTION (2026-08-07 — see decisions-log.md and
          // the comment where targetCompanies is resolved above).
          targetCompanies,
          // DO-NOT-TOUCH EXCEPTION (2026-08-17 — see the comment on the
          // Promise.all above where checklistEvaluation is computed).
          checklistEvaluation,
          // DO-NOT-TOUCH EXCEPTION (2026-08-19, Phase 2.6 — see the gate
          // branch above where this is set).
          gate1Only,
        });
        result.id = id;

        // DO-NOT-TOUCH EXCEPTION (2026-08-17, roadmap 2.5.9 — global talent
        // search): embedding text depends on `result`'s AI-generated
        // summary/strengths/concerns (see lib/embeddings.ts's
        // buildCandidateEmbeddingText), so unlike the fingerprint/checklist
        // branches above this genuinely can't join the earlier Promise.all —
        // it has to run after scoring produces `result`, not alongside it.
        // Requires a real screening id too (setScreeningEmbedding writes by
        // id), so it also can't run before saveScreening above. Awaited, not
        // fire-and-forget, same reasoning as the "Awaited (not fire-and-
        // forget)" comment on saveScreening itself just above — Vercel can
        // freeze the function once the response is sent. Best-effort
        // end-to-end: a missing VOYAGE_API_KEY, a Voyage API failure, or the
        // embedding migration not being run yet all degrade to "this
        // candidate isn't searchable yet," never to a failed/lost screening.
        // Skipped entirely for gate-1-only candidates (2026-08-19, Phase
        // 2.6) — summary/strengths/concerns/careerTrajectory are all empty
        // for these (scoreCandidate() never ran), so buildCandidateEmbeddingText
        // would have nothing meaningful to embed; generating one anyway would
        // burn a real API call to produce a near-empty vector that pollutes
        // talent search rather than helping it.
        if (!gate1Only) {
          try {
            const embeddingText = buildCandidateEmbeddingText({
              summary: result.summary,
              strengths: result.strengths,
              concerns: result.concerns,
              careerTrajectory: result.careerTrajectory,
            });
            const embedding = await generateEmbedding(embeddingText, "document");
            if (embedding) await setScreeningEmbedding(id, embedding);
          } catch (err) {
            console.error("Embedding generation/save failed (screening unaffected):", err);
          }
        }
      } catch (err) {
        console.error("Failed to persist screening result:", err);
      }
    } catch (error) {
      errors.push({
        fileName: resume.fileName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Score up to 3 resumes concurrently to stay within Anthropic rate limits
  // while still being meaningfully faster than sequential processing.
  const CONCURRENCY = 3;
  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    await Promise.all(parsed.slice(i, i + CONCURRENCY).map(score));
  }

  // DO-NOT-TOUCH EXCEPTION (2026-07-31, Vlad's explicit ask, after a full
  // database audit): removed the screening_batches write entirely. That
  // table was built 2026-07-07 so Analytics could report totals including
  // rejected candidates without permanently storing every rejected resume
  // (see decisions-log.md). It was fully obsoleted by the 2026-07-10
  // Save-All change (every candidate is saved regardless of score now, so
  // the individual records this table existed to avoid storing already
  // exist in `screenings`) — confirmed via a full-repo grep that Analytics
  // and FunnelView both switched to live `screenings`/`tracker` queries on
  // 2026-07-17 and neither has read this table since. Live-confirmed via
  // Claude Code: 284 historical rows, zero read paths anywhere in the app.
  // Every screening batch was still paying for an insert + 3 index updates
  // into a table nothing used — pure waste. See memory/database-audit-
  // 2026-07-31.md and supabase-migration-drop-screening-batches.sql (run
  // AFTER this deploys, not before).
  results.sort((a, b) => b.score - a.score);

  // DO-NOT-TOUCH EXCEPTION, same batchId — see the comment at the top of this route.
  return NextResponse.json({ results, errors, batchId });
}
