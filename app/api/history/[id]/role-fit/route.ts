import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, canAccessScreening } from "@/lib/auth";
import { getScreeningRoleFitContext, getScreeningResume, updateScreening } from "@/lib/screenings";
import { extractResumeText } from "@/lib/parseResume";
import { generateRoleFit } from "@/lib/generateRoleFit";

export const maxDuration = 30;

/**
 * Lazy role-fit generation for Gate-1-only archived candidates — Phase 2.6
 * "connect Archive Fits" (2026-08-20, Vlad's ask). The existing
 * `suggested_role_fits` mechanism (lib/generateRoleFit.ts,
 * PATCH /api/history/[id]) only ever fires when a recruiter manually picks
 * a role-mismatch archive reason, and needs a summary/strengths/trajectory
 * that a Gate-1-only candidate never has (Gate 1 skips the full
 * scoreCandidate() write-up entirely — see lib/buildGate1ArchivedResult.ts).
 * This route is the automatic trigger for that specific gap: called when a
 * recruiter opens a Gate-1-archived candidate's card (same "on first open,
 * not automatic at archive time" trigger as Tier 2's lazy fit-suggestion —
 * generating one for every single Gate-1 failure would burn the exact cost
 * Gate 1 exists to avoid), falls back to the raw resume text since there's
 * no AI summary to work from.
 *
 * Same "once, never recompute" contract as
 * app/api/cross-project-fit/route.ts's screeningId path — reuses the
 * EXISTING suggested_role_fits column (no new migration needed) as the
 * persistence target, since a candidate with an already-populated array
 * (from either this route or the pre-existing manual trigger) should never
 * be regenerated.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (!(await canAccessScreening(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const context = await getScreeningRoleFitContext(numId);
  if (!context) return NextResponse.json({ suggestedRoleFits: [] });

  // Never recompute — already has a suggestion, whether from this route on
  // a prior open or the pre-existing manual archive-reason trigger.
  if (context.suggestedRoleFits.length > 0) {
    return NextResponse.json({ suggestedRoleFits: context.suggestedRoleFits });
  }

  // A candidate with a real summary already has everything the ORIGINAL
  // manual trigger needs — this lazy route deliberately does not also
  // auto-generate for every Gate-2 archived candidate opened with no
  // suggestion yet, only the Gate-1-only case (empty summary) it exists
  // for. Otherwise opening any archived card would silently spend a Claude
  // call every time.
  if (context.summary) {
    return NextResponse.json({ suggestedRoleFits: [] });
  }

  try {
    const resumeData = await getScreeningResume(numId);
    const resumeText = await extractResumeText(resumeData.fileName, resumeData.data);
    const roleFit = await generateRoleFit({ summary: "", strengths: [], resumeText });
    // Best-effort persistence, matching Tier 2's own pattern — a write
    // failure degrades to "recompute next open," never fails this response.
    await updateScreening(numId, { suggestedRoleFits: [roleFit] }).catch(() => {});
    return NextResponse.json({ suggestedRoleFits: [roleFit] });
  } catch (err) {
    console.error("Lazy role-fit generation failed (non-fatal, will retry on next open):", err);
    return NextResponse.json({ suggestedRoleFits: [] });
  }
}
