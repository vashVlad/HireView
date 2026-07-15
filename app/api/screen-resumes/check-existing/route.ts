import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { hashResumeText, normalizeCandidateName } from "@/lib/resumeContentHash";
import { getSupabaseClient } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";
import { listRejectionHistory } from "@/lib/screenings";
import type { CheckExistingResult, ExistingCandidateRef, Recommendation, RejectionHistoryEntry } from "@/lib/types";

export const maxDuration = 30;

/**
 * Pre-screen duplicate check — runs BEFORE any file reaches the scoring
 * route, so an exact re-upload never burns a Claude call. Does NOT touch
 * app/api/screen-resumes/route.ts or scoreCandidate.ts (both do-not-touch):
 * the frontend calls this first, removes anything flagged "duplicate" from
 * the batch, and sends the rest to the existing scoring route unchanged.
 *
 * One signal, free (local parsing + hashing only, zero Claude calls):
 *   - "duplicate": exact match on resume_content_hash — same content,
 *     byte-for-byte-of-text. Nothing to gain from re-scoring; the frontend
 *     shows the existing saved result as-is.
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

  // System-wide (any project, any team) — independent of projectId, so it's
  // fetched even in the no-project-context branch below. Fails closed to []
  // if reject_reason's migration hasn't run yet; never throws.
  const rejectionHistory: RejectionHistoryEntry[] = await listRejectionHistory().catch(() => []);

  if (projectId == null) {
    // No project context (e.g. ad-hoc screening) — nothing project-scoped to check against.
    return NextResponse.json({
      results: files
        .filter((f): f is File => f instanceof File)
        .map((f) => ({ fileName: f.name, status: "new" as const })),
      existingCandidates: [],
      rejectionHistory,
    });
  }

  const supabase = getSupabaseClient();
  const { data: existingRows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, resume_content_hash")
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
    };
  }

  const results: CheckExistingResult[] = await Promise.all(
    files.map(async (file): Promise<CheckExistingResult> => {
      if (!(file instanceof File)) return { fileName: "unknown", status: "new" };

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const text = await extractResumeText(file.name, buffer);
        const hash = hashResumeText(text);

        const exactMatch = byHash.get(hash);
        if (exactMatch) {
          return { fileName: file.name, status: "duplicate", existing: toExisting(exactMatch) };
        }

        return { fileName: file.name, status: "new" };
      } catch {
        // Can't parse it here — let the real scoring route surface the error properly.
        return { fileName: file.name, status: "new" };
      }
    })
  );

  return NextResponse.json({ results, existingCandidates, rejectionHistory });
}
