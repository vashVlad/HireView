import { getSupabaseClient } from "./supabase";
import type { ComparisonRecord, ComparisonVerdict, ResumeChange } from "./types";

interface ComparisonRow {
  id: number;
  screening_id: number;
  new_resume_filename: string;
  new_resume_role: string | null;
  verdict: string;
  summary: string;
  changes: ResumeChange[];
  red_flags: string[];
  created_at: string;
}

function rowToRecord(row: ComparisonRow): ComparisonRecord {
  return {
    id: row.id,
    screeningId: row.screening_id,
    newResumeFilename: row.new_resume_filename,
    newResumeRole: row.new_resume_role,
    verdict: row.verdict as ComparisonVerdict,
    summary: row.summary,
    changes: row.changes,
    redFlags: row.red_flags,
    createdAt: row.created_at,
  };
}

export async function saveComparison(params: {
  screeningId: number;
  newResumeFilename: string;
  newResumeRole: string | null;
  verdict: ComparisonVerdict;
  summary: string;
  changes: ResumeChange[];
  redFlags: string[];
}): Promise<{ id: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("comparisons")
    .insert({
      screening_id: params.screeningId,
      new_resume_filename: params.newResumeFilename,
      new_resume_role: params.newResumeRole,
      verdict: params.verdict,
      summary: params.summary,
      changes: params.changes,
      red_flags: params.redFlags,
    })
    .select("id")
    .single<{ id: number }>();
  if (error) throw error;
  return { id: data.id };
}

export async function getComparisonsByScreeningId(screeningId: number): Promise<ComparisonRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("comparisons")
    .select("id, screening_id, new_resume_filename, new_resume_role, verdict, summary, changes, red_flags, created_at")
    .eq("screening_id", screeningId)
    .order("created_at", { ascending: false })
    .returns<ComparisonRow[]>();
  if (error) throw error;
  return (data ?? []).map(rowToRecord);
}

export async function getComparisonById(id: number): Promise<ComparisonRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("comparisons")
    .select("id, screening_id, new_resume_filename, new_resume_role, verdict, summary, changes, red_flags, created_at")
    .eq("id", id)
    .maybeSingle<ComparisonRow>();
  if (error) throw error;
  return data ? rowToRecord(data) : null;
}

export async function getComparisonCountsByScreeningIds(
  screeningIds: number[]
): Promise<Record<number, number>> {
  if (screeningIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("comparisons")
    .select("screening_id")
    .in("screening_id", screeningIds)
    .returns<{ screening_id: number }[]>();
  if (error) throw error;

  const counts: Record<number, number> = {};
  for (const row of data ?? []) {
    counts[row.screening_id] = (counts[row.screening_id] ?? 0) + 1;
  }
  return counts;
}
