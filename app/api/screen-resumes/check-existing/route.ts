import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { hashResumeText, normalizeCandidateName } from "@/lib/resumeContentHash";
import { extractNameHeuristic } from "@/lib/extractCandidateNameFallback";
import { getSupabaseClient } from "@/lib/supabase";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { listBlacklist, listRejectionHistory } from "@/lib/screenings";
import type { BlacklistEntry, CandidateStatus, CheckExistingResult, ExistingCandidateRef, Recommendation, RejectionHistoryEntry } from "@/lib/types";

export const maxDuration = 30;

/**
 * Pre-screen duplicate check — runs BEFORE any file reaches the scoring
 * route, so an exact re-upload never burns a Claude call. Does NOT touch
 * app/api/screen-resumes/route.ts or scoreCandidate.ts (both do-not-touch):
 * the frontend calls this first, removes anything flagged "duplicate" from
 * the batch, and sends the rest to the existing scoring route unchanged.
 *
 * Two signals, both free (local parsing/hashing/heuristics only, zero Claude
 * calls):
 *   - "duplicate": exact match on resume_content_hash — same content,
 *     byte-for-byte-of-text. Nothing to gain from re-scoring; the frontend
 *     shows the existing saved result as-is.
 *   - "blacklisted": the free extractNameHeuristic() (lib/
 *     extractCandidateNameFallback.ts) finds a name in the resume text that
 *     matches the system-wide blacklist. Added 2026-08-20 — this used to be
 *     a scored-then-warned signal only (findBlacklistMatches in
 *     app/projects/[id]/page.tsx, matched against the AI-extracted
 *     candidateName after a real scoreCandidate() call already ran and cost
 *     a Claude call), which was flagged as a real correctness/cost bug by
 *     Claude Code's 2026-08-20 full-system audit: a blacklisted candidate
 *     got re-scored, in full, every single time they were re-uploaded. The
 *     heuristic is deliberately conservative (see its own tests,
 *     test_extract_name_heuristic.mjs) and won't confidently find a name on
 *     every resume — when it can't, this pre-check simply declines to flag
 *     anything and the file proceeds to scoring as normal; the existing
 *     post-score check (matched against the more reliable AI-extracted
 *     name) still runs afterward as a safety net for whatever this misses.
 *
 * Filename-based matching ("possible_update") was removed 2026-07-15 — a
 * filename alone (e.g. "Resume (16).pdf", the default browser auto-rename
 * for any resume literally named "Resume.pdf") normalizes down to a bare
 * generic term with zero identity signal, so it flagged unrelated candidates
 * as often as real ones. The post-score candidate-name check
 * (findNameMatches in app/projects/[id]/page.tsx, using existingCandidates
 * below) already covers the real case this was trying to catch — two
 * different resume files that turn out to name the same actual person — more
 * reliably, since it compares real extracted identity instead of an
 * incidental filename string. See decisions-log.md, 2026-07-15.
 *
 * Scoped to the project only (like Phase 1.1's same-project duplicate
 * detection), not team-wide — "already exists in the project" is literally
 * what was asked for. Phase 1.4's cross-project/cross-team fraud signal is a
 * separate, already-shipped concern and untouched by this.
 */

interface ExistingScreeningRow {
  id: number;
  candidate_name: string;
  file_name: string;
  score: number;
  must_have_score: number | null;
  nice_to_have_score: number | null;
  summary: string;
  strengths: string[];
  concerns: string[];
  career_trajectory: string | null;
  recommendation: Recommendation | null;
  resume_content_hash: string | null;
  status: CandidateStatus;
  archive_reason: string | null;
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const files = formData.getAll("resumes");
  const projectIdField = formData.get("projectId");
  const projectId = typeof projectIdField === "string" && projectIdField.trim()
    ? parseInt(projectIdField.trim(), 10) || undefined
    : undefined;

  if (files.length === 0) {
    return NextResponse.json({ error: "At least one resume file is required" }, { status: 400 });
  }

  // Same by-id ownership check as screen-resumes/route.ts and save-one/
  // route.ts — without this, any authenticated user on any team could pass
  // another team's numeric projectId and read back that project's full
  // candidate list (names, scores, summaries, strengths, concerns).
  if (projectId != null && !(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // System-wide (any project, any team) — independent of projectId, so it's
  // fetched even in the no-project-context branch below. Fails closed to []
  // if reject_reason's migration hasn't run yet; never throws.
  const rejectionHistory: RejectionHistoryEntry[] = await listRejectionHistory().catch(() => []);
  // Blacklist, 2026-07-31 (Vlad's ask) — same system-wide, fail-closed
  // treatment as rejectionHistory above. See lib/screenings.ts's listBlacklist().
  const blacklist: BlacklistEntry[] = await listBlacklist().catch(() => []);
  // Keyed for the free pre-score heuristic check below (classifyFile) —
  // built once, outside the per-file loop.
  const blacklistByName = new Map(blacklist.map((b) => [normalizeCandidateName(b.candidateName), b]));

  /**
   * Shared by both branches below (with/without a projectId) — 2026-08-20.
   * Previously the no-project branch skipped resume parsing entirely (just
   * echoed filenames back as "new"), which meant an ad-hoc screening with no
   * project context bypassed the blacklist pre-check altogether. Parsing
   * text is free (local, no Claude call) either way, so there's no real cost
   * to doing it uniformly — this also collapses what used to be two
   * near-duplicate try/catch blocks into one.
   */
  async function classifyFile(file: File, byHash: Map<string, ExistingScreeningRow>): Promise<CheckExistingResult> {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractResumeText(file.name, buffer);
      const hash = hashResumeText(text);

      const exactMatch = byHash.get(hash);
      if (exactMatch) {
        return { fileName: file.name, status: "duplicate", existing: toExisting(exactMatch), resumeContentHash: hash };
      }

      // Free pre-score blacklist gate, 2026-08-20 — see this route's own
      // doc comment above and CheckExistingResult.blacklistMatch's doc
      // comment (lib/types.ts) for the full story. Declines to guess (falls
      // through to "new") when the heuristic can't confidently find a name;
      // the post-score check (app/projects/[id]/page.tsx's
      // findBlacklistMatches, matched against the real AI-extracted name)
      // remains as a safety net for whatever this misses.
      const heuristicName = extractNameHeuristic(text);
      if (heuristicName) {
        const hit = blacklistByName.get(normalizeCandidateName(heuristicName));
        if (hit) {
          const confidence: BlacklistEntry["confidence"] =
            hit.contentHash != null && hit.contentHash === hash ? "name_and_resume" : "name_only";
          return { fileName: file.name, status: "blacklisted", blacklistMatch: { ...hit, confidence }, resumeContentHash: hash };
        }
      }

      return { fileName: file.name, status: "new", resumeContentHash: hash };
    } catch {
      // Can't parse it here — let the real scoring route surface the error properly.
      return { fileName: file.name, status: "new" };
    }
  }

  function toExisting(row: ExistingScreeningRow): CheckExistingResult["existing"] {
    return {
      id: row.id,
      candidateName: row.candidate_name,
      fileName: row.file_name,
      score: row.score,
      ...(row.must_have_score != null ? { mustHaveScore: row.must_have_score } : {}),
      ...(row.nice_to_have_score != null ? { niceToHaveScore: row.nice_to_have_score } : {}),
      summary: row.summary,
      strengths: row.strengths ?? [],
      concerns: row.concerns ?? [],
      ...(row.career_trajectory ? { careerTrajectory: row.career_trajectory } : {}),
      recommendation: row.recommendation,
      status: row.status,
      ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
    };
  }

  const validFiles = files.filter((f): f is File => f instanceof File);

  if (projectId == null) {
    // No project context (e.g. ad-hoc screening) — nothing project-scoped to
    // check against, but the system-wide blacklist gate above still applies.
    const results = await Promise.all(validFiles.map((f) => classifyFile(f, new Map())));
    return NextResponse.json({ results, existingCandidates: [], rejectionHistory, blacklist });
  }

  const supabase = getSupabaseClient();
  const { data: existingRows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, resume_content_hash, status, archive_reason")
    .eq("project_id", projectId)
    .returns<ExistingScreeningRow[]>();

  if (error) {
    return NextResponse.json({ error: "Failed to check existing screenings" }, { status: 500 });
  }

  const byHash = new Map<string, ExistingScreeningRow>();
  for (const row of existingRows ?? []) {
    if (row.resume_content_hash) byHash.set(row.resume_content_hash, row);
  }

  // Neither hash nor filename catches "two genuinely different resume files
  // that turn out to be the same candidate" — candidate name only exists
  // after scoring. Handing the frontend this list (cheap, already fetched
  // above) lets it cross-check post-score as a soft, informational signal,
  // even though by then the Claude call has already happened.
  const existingCandidates: ExistingCandidateRef[] = [
    ...new Map(
      (existingRows ?? []).map((row) => [normalizeCandidateName(row.candidate_name), { id: row.id, candidateName: row.candidate_name }])
    ).values(),
  ];

  const results: CheckExistingResult[] = await Promise.all(
    validFiles.map((file) => classifyFile(file, byHash))
  );

  return NextResponse.json({ results, existingCandidates, rejectionHistory, blacklist });
}
