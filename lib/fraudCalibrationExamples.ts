import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import type { FraudCalibrationExample, FraudCalibrationClaim, FraudPatternType } from "./types";

interface FraudCalibrationExampleRow {
  id: number;
  pattern_type: FraudPatternType;
  claims: FraudCalibrationClaim[];
  resume_path: string;
  resume_mime_type: string;
  extracted_text: string;
  source_screening_id: number | null;
  created_at: string;
}

function rowToExample(row: FraudCalibrationExampleRow, fileName: string): FraudCalibrationExample {
  return {
    id: row.id,
    patternType: row.pattern_type,
    claims: row.claims ?? [],
    fileName,
    resumeMimeType: row.resume_mime_type,
    extractedText: row.extracted_text,
    sourceScreeningId: row.source_screening_id ?? undefined,
    createdAt: row.created_at,
  };
}

// resume_path already encodes a unique folder per example (see save below),
// so the original file name is recovered from its last path segment instead
// of a dedicated column — one less thing to keep in sync with resume_path.
function fileNameFromPath(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Best-effort save, mirroring lib/screeningActions.ts's logAction() —
 * flagging a rejection as fraud must never fail the rejection itself just
 * because fraud_calibration_examples hasn't been migrated yet on this
 * environment (see supabase-migration-fraud-calibration.sql's header).
 * Returns the saved example, or null if the save failed for any reason.
 */
export async function saveFraudCalibrationExample(params: {
  patternType: FraudPatternType;
  claims: FraudCalibrationClaim[];
  fileName: string;
  extractedText: string;
  resumeFile: Buffer;
  resumeMimeType: string;
  sourceScreeningId?: number;
  userId?: string;
}): Promise<FraudCalibrationExample | null> {
  try {
    const { patternType, claims, fileName, extractedText, resumeFile, resumeMimeType, sourceScreeningId, userId } = params;
    const supabase = getSupabaseClient();

    const resumePath = `fraud-calibration/${randomUUID()}/${fileName}`;
    const upload = await supabase.storage
      .from(RESUME_BUCKET)
      .upload(resumePath, resumeFile, { contentType: resumeMimeType });
    if (upload.error) throw upload.error;

    const insert = await supabase
      .from("fraud_calibration_examples")
      .insert({
        pattern_type: patternType,
        claims,
        resume_path: resumePath,
        resume_mime_type: resumeMimeType,
        extracted_text: extractedText,
        source_screening_id: sourceScreeningId ?? null,
        user_id: userId ?? null,
      })
      .select()
      .single<FraudCalibrationExampleRow>();
    if (insert.error) throw insert.error;

    return rowToExample(insert.data, fileName);
  } catch (err) {
    console.error("saveFraudCalibrationExample failed (non-fatal — rejection still proceeds):", err);
    return null;
  }
}

/**
 * System-wide, not project-scoped (unlike listCalibrationExamples) — fraud
 * patterns aren't role-specific the way "good fit" is. Fails closed to []
 * rather than throwing, same reasoning as the save path above: a fraud risk
 * check running before the migration exists should find no examples and
 * report low risk, not 500.
 */
export async function listFraudCalibrationExamples(patternType?: FraudPatternType): Promise<FraudCalibrationExample[]> {
  try {
    const supabase = getSupabaseClient();

    let query = supabase
      .from("fraud_calibration_examples")
      .select("id, pattern_type, claims, resume_path, resume_mime_type, extracted_text, source_screening_id, created_at")
      .order("created_at", { ascending: false });

    if (patternType) query = query.eq("pattern_type", patternType);

    const { data, error } = await query.returns<FraudCalibrationExampleRow[]>();
    if (error) throw error;

    return (data ?? []).map((row) => rowToExample(row, fileNameFromPath(row.resume_path)));
  } catch (err) {
    console.error("listFraudCalibrationExamples failed (non-fatal — treated as no examples yet):", err);
    return [];
  }
}

/**
 * Looks up the confirmed-fraud calibration example (if any) recorded from a
 * SPECIFIC screening's rejection — added 2026-08-04 (Vlad's ask: "make sure
 * that I can see fraud reason when I try to edit a rejected candidate from
 * the tracker drawer"). Root cause of the gap: saveFraudCalibrationExample()
 * always wrote `source_screening_id`, so the data was already there — but
 * nothing ever read it back per-screening; RejectionCard.tsx's "fraud
 * flagged" confirmation only ever reflected its OWN component-local
 * checkbox state for the current mount, which resets to false every time the
 * drawer is reopened for an already-rejected candidate. Same fail-closed
 * reasoning as listFraudCalibrationExamples above — a missing table/column
 * (pre-migration) should read as "nothing on file," not throw.
 */
export async function getFraudCalibrationExampleByScreeningId(screeningId: number): Promise<FraudCalibrationExample | null> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("fraud_calibration_examples")
      .select("id, pattern_type, claims, resume_path, resume_mime_type, extracted_text, source_screening_id, created_at")
      .eq("source_screening_id", screeningId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<FraudCalibrationExampleRow>();
    if (error) throw error;
    if (!data) return null;

    return rowToExample(data, fileNameFromPath(data.resume_path));
  } catch (err) {
    console.error("getFraudCalibrationExampleByScreeningId failed (non-fatal — treated as none on file):", err);
    return null;
  }
}

export async function deleteFraudCalibrationExample(id: number): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: row } = await supabase
    .from("fraud_calibration_examples")
    .select("resume_path")
    .eq("id", id)
    .maybeSingle<Pick<FraudCalibrationExampleRow, "resume_path">>();

  if (row) {
    // Best-effort: a missing/already-gone file shouldn't block deleting the record.
    await supabase.storage.from(RESUME_BUCKET).remove([row.resume_path]);
  }

  const { error } = await supabase.from("fraud_calibration_examples").delete().eq("id", id);
  if (error) throw error;
}
