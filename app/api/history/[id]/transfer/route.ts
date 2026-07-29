import { NextRequest, NextResponse } from "next/server";
import { transferScreeningToProject } from "@/lib/screenings";
import { canAccessScreening, canAccessProject, getAuthUser } from "@/lib/auth";
import { errorMessage } from "@/lib/errorMessage";
import type { CandidateResult } from "@/lib/types";

/**
 * Transfer status action — Vlad's ask, 2026-07-29, redesigned same day into
 * a dedicated "Transfer" button (see components/TransferControl.tsx)
 * instead of a status-dropdown option, after live-testing surfaced two
 * things: a real partial-failure bug (fixed in transferScreeningToProject's
 * two-step status update, see its own comment) and a request to optionally
 * re-score against the destination project instead of always copying the
 * old score. This route is now step 3 (the actual commit) after
 * /transfer/precheck and, optionally, /transfer/preview.
 *
 * `mode` picks which of the three transferScreeningToProject paths runs:
 *   - "existing": candidate already has a screening in the destination
 *     (found by precheck) — requires `existingScreeningId`.
 *   - "copy": no existing screening, recruiter left the re-score toggle
 *     off — carries the source's own result over as-is.
 *   - "rescore": recruiter re-screened via /transfer/preview first —
 *     requires `previewResult` (that exact response, round-tripped back
 *     here so this never re-runs scoring a second time).
 *
 * Deliberately a dedicated route, not folded into the generic PATCH
 * /api/history/[id] (which only ever flips a plain field) — a transfer
 * does real work beyond a field update. See transferScreeningToProject() in
 * lib/screenings.ts for the full design rationale.
 *
 * Two access checks, matching Vlad's confirmed scoping: canAccessScreening
 * for the SOURCE (same as every other by-id history route) and
 * canAccessProject for the DESTINATION — a recruiter can only transfer into
 * a project their own team owns; an admin can transfer into any project
 * (canAccessProject already resolves that way, see lib/auth.ts). The
 * destination project list a recruiter/admin sees client-side (GET
 * /api/projects, same teamIdsFilter scoping) should already only offer
 * valid choices, but this never trusts that alone — same "never trust a
 * client-supplied id" precedent as every other cross-project route this
 * session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = parseInt(id, 10);
  if (isNaN(screeningId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const destinationProjectId = typeof body?.projectId === "number" ? body.projectId : NaN;
  if (isNaN(destinationProjectId)) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const mode: "copy" | "rescore" | "existing" =
    body?.mode === "rescore" || body?.mode === "existing" ? body.mode : "copy";
  const existingScreeningId = typeof body?.existingScreeningId === "number" ? body.existingScreeningId : undefined;
  const previewResult: CandidateResult | undefined =
    mode === "rescore" && body?.previewResult ? body.previewResult : undefined;
  if (mode === "existing" && existingScreeningId == null) {
    return NextResponse.json({ error: "existingScreeningId is required for mode \"existing\"" }, { status: 400 });
  }
  if (mode === "rescore" && !previewResult) {
    return NextResponse.json({ error: "previewResult is required for mode \"rescore\"" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessProject(user, destinationProjectId))) {
    return NextResponse.json({ error: "Forbidden — you don't have access to that project" }, { status: 403 });
  }
  // "existing" mode points at an already-saved screening the recruiter
  // never explicitly chose to reveal — make sure it's actually one this
  // user can see, not just any id the client happened to send.
  if (mode === "existing" && existingScreeningId != null && !(await canAccessScreening(user, existingScreeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { newScreeningId, destinationProjectName } = await transferScreeningToProject({
      screeningId,
      destinationProjectId,
      actingUserId: user.id,
      mode,
      existingScreeningId,
      rescoredResult: previewResult,
    });
    return NextResponse.json({
      newScreeningId,
      transferredToProjectId: destinationProjectId,
      transferredToProjectName: destinationProjectName,
    });
  } catch (err) {
    console.error("Transfer failed:", err);
    // errorMessage() instead of `err instanceof Error ? err.message : ...` —
    // real bug found 2026-07-29: Supabase's client throws plain
    // PostgrestError-shaped objects, not real Error instances, so that
    // check silently swallowed the actual failure (e.g. a storage upload
    // or insert error) and always showed the generic fallback with zero
    // detail. See lib/errorMessage.ts for the full story.
    return NextResponse.json({ error: errorMessage(err, "Transfer failed") }, { status: 500 });
  }
}
