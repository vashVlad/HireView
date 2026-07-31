import { getSupabaseClient } from "./supabase";

/**
 * Archive Fits, 2026-07-30 (Vlad's ask) — reusing archived candidates for
 * newly created roles instead of losing track of them. Dedicated file, same
 * reasoning as lib/generateRoleFit.ts: archive_fit_candidates is a brand new
 * table (supabase-migration-archive-fits.sql) and suggested_role_fits is a
 * deliberately-deferred column on screenings — keeping every query for this
 * feature in one isolated file makes it obvious none of it touches the
 * shared SCREENING_COLUMNS select in lib/screenings.ts. See that migration's
 * header comment for the full sequencing rationale.
 */

export interface ArchivedRoleFitCandidate {
  screeningId: number;
  candidateName: string;
  projectId: number;
  score: number;
  archiveReason: string | null;
  suggestedRoleFits: string[];
}

/**
 * Every archived screening, across the given projects, that actually has at
 * least one suggested role fit — the pool a "check for fits" pass classifies
 * against a new project's JD. Isolated select (not SCREENING_COLUMNS) since
 * suggested_role_fits isn't wired into that shared constant yet.
 */
export async function listArchivedCandidatesWithRoleFits(
  projectIds: number[]
): Promise<ArchivedRoleFitCandidate[]> {
  if (projectIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, project_id, score, archive_reason, suggested_role_fits")
    .in("project_id", projectIds)
    .eq("status", "archived")
    .returns<
      { id: number; candidate_name: string; project_id: number; score: number; archive_reason: string | null; suggested_role_fits: string[] | null }[]
    >();
  if (error || !data) return [];
  return data
    .filter((row) => row.suggested_role_fits && row.suggested_role_fits.length > 0)
    .map((row) => ({
      screeningId: row.id,
      candidateName: row.candidate_name,
      projectId: row.project_id,
      score: row.score,
      archiveReason: row.archive_reason,
      suggestedRoleFits: row.suggested_role_fits!,
    }));
}

/** Screening ids already in this project's queue (any status) — lets "check" skip re-classifying a candidate that was already matched (and possibly already decided) before. */
export async function getKnownArchiveFitScreeningIds(projectId: number): Promise<Set<number>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("archive_fit_candidates")
    .select("screening_id")
    .eq("project_id", projectId)
    .returns<{ screening_id: number }[]>();
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.screening_id));
}

/**
 * Inserts new 'pending' rows. Upsert with ignoreDuplicates so a re-run of
 * "check" can never resurrect or overwrite a row that's already been
 * decided ('skipped'/'screened').
 *
 * checkedBy, 2026-07-30 (Vlad's ask — attribute who ran the check, same as
 * every other recruiter-driven write in this app). Optional/best-effort:
 * a missing caller identity should never block the match itself from being
 * recorded, it just means that one row won't show who found it.
 */
export async function insertPendingArchiveFits(
  projectId: number,
  matches: { screeningId: number; suggestedRoleFit: string }[],
  checkedBy?: string
): Promise<void> {
  if (matches.length === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("archive_fit_candidates")
    .upsert(
      matches.map((m) => ({
        project_id: projectId,
        screening_id: m.screeningId,
        suggested_role_fit: m.suggestedRoleFit,
        status: "pending",
        ...(checkedBy != null ? { checked_by: checkedBy } : {}),
      })),
      { onConflict: "project_id,screening_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export interface ArchiveFitQueueRow {
  id: number; // archive_fit_candidates row id
  screeningId: number;
  candidateName: string;
  score: number;
  suggestedRoleFit: string | null;
}

/**
 * Pending queue for a project's "Archive Fits" tab, joined with the
 * underlying screening for card display.
 *
 * Bug found during 2026-07-30 audit, fixed before this ever ran against a
 * real migration: this table has TWO foreign keys into `screenings`
 * (`screening_id` and `screened_screening_id`), so a bare `screenings!inner`
 * embed is ambiguous — PostgREST can't tell which FK to join on and would
 * reject the query at runtime (not something `tsc` or this sandbox's lack
 * of DB access could have caught). Disambiguated with the `!screening_id`
 * column hint, same fix PostgREST's own docs recommend whenever a table has
 * more than one relationship to the same target table.
 */
export async function listPendingArchiveFits(projectId: number): Promise<ArchiveFitQueueRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("archive_fit_candidates")
    .select("id, screening_id, suggested_role_fit, screenings!screening_id(id, candidate_name, score)")
    .eq("project_id", projectId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .returns<
      { id: number; screening_id: number; suggested_role_fit: string | null; screenings: { id: number; candidate_name: string; score: number } }[]
    >();
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    screeningId: row.screening_id,
    candidateName: row.screenings.candidate_name,
    score: row.screenings.score,
    suggestedRoleFit: row.suggested_role_fit,
  }));
}

/** Looked up by (project_id, screening_id) — the decide route's URL already carries both, and UNIQUE(project_id, screening_id) guarantees at most one row. */
export async function getArchiveFitRow(
  projectId: number,
  screeningId: number
): Promise<{ id: number; status: string } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("archive_fit_candidates")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("screening_id", screeningId)
    .maybeSingle<{ id: number; status: string }>();
  if (error || !data) return null;
  return data;
}

/**
 * Resolves a pending row — 'skip' just marks it decided (screening stays
 * archived, untouched); 'screen' additionally records which new screening
 * it became. decidedBy, 2026-07-30 (Vlad's ask) — same attribution as
 * checkedBy above; optional/best-effort for the same reason.
 */
export async function decideArchiveFit(
  rowId: number,
  decision: "skipped" | "screened",
  screenedScreeningId?: number,
  decidedBy?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("archive_fit_candidates")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      ...(screenedScreeningId != null ? { screened_screening_id: screenedScreeningId } : {}),
      ...(decidedBy != null ? { decided_by: decidedBy } : {}),
    })
    .eq("id", rowId);
  if (error) throw error;
}
