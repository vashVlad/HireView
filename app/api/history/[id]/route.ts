import { NextRequest, NextResponse } from "next/server";
import { deleteScreening, getScreeningRoleFitContext, getScreeningsByIds, updateScreening, updateScreeningCredibility, updateScreeningFlag, updateScreeningFraudRisk, updateScreeningNotes, updateScreeningStatus } from "@/lib/screenings";
import { generateRoleFit } from "@/lib/generateRoleFit";
import { canAccessScreening, getAuthUser } from "@/lib/auth";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

// Archive Fits, 2026-07-30 — only these archive reasons imply the candidate
// just wasn't right for THIS role (as opposed to declining, or a fraud/
// cross-reference failure), so only these auto-trigger a role-fit suggestion.
const ROLE_MISMATCH_ARCHIVE_REASONS = ["Tech skills", "Domain knowledge", "Role alignment"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const records = await getScreeningsByIds([numId]);
    if (!records.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ screening: records[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actorUserId = user.id;

  try {
    if (body.status !== undefined) {
      if (!CANDIDATE_STATUSES.includes(body.status as CandidateStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      await updateScreeningStatus(numId, body.status as CandidateStatus, actorUserId);
    }
    if (body.flagged !== undefined) {
      await updateScreeningFlag(numId, body.flagged, body.flagNote, actorUserId);
    }
    if (body.notes !== undefined) {
      await updateScreeningNotes(numId, body.notes, actorUserId);
    }
    if (body.leverUrl !== undefined) {
      await updateScreening(numId, { leverUrl: body.leverUrl });
    }
    if (body.archiveReason !== undefined) {
      await updateScreening(numId, { archiveReason: body.archiveReason });
      // Best-effort — a role-fit suggestion is a nice-to-have, never worth
      // failing the archive-reason save itself over (e.g. Claude call error).
      if (ROLE_MISMATCH_ARCHIVE_REASONS.includes(body.archiveReason)) {
        try {
          const context = await getScreeningRoleFitContext(numId);
          if (context) {
            const roleFit = await generateRoleFit(context);
            if (!context.suggestedRoleFits.includes(roleFit)) {
              await updateScreening(numId, { suggestedRoleFits: [...context.suggestedRoleFits, roleFit] });
            }
          }
        } catch (err) {
          console.error("Auto role-fit generation failed (non-fatal):", err);
        }
      }
    }
    // Manual add, 2026-07-30 (Vlad's ask: recruiter can add their own
    // suggestion, or another one alongside the auto-generated one) — plain
    // text, deduped against whatever's already in the array.
    if (typeof body.suggestedRoleFit === "string" && body.suggestedRoleFit.trim()) {
      const manual = body.suggestedRoleFit.trim();
      const context = await getScreeningRoleFitContext(numId);
      if (context && !context.suggestedRoleFits.includes(manual)) {
        await updateScreening(numId, { suggestedRoleFits: [...context.suggestedRoleFits, manual] });
      }
    }
    if (body.credibility !== undefined) {
      await updateScreeningCredibility(numId, body.credibility, actorUserId);
    }
    // fraud_risk requires supabase-migration-fraud-calibration.sql — NOT YET
    // CONFIRMED RUN on every environment. updateScreeningFraudRisk's own
    // write is conditional on that column existing (see updateScreening's
    // fraudRisk field comment) but is NOT wrapped in .catch() here, same as
    // credibility above — a genuine persistence failure should surface as a
    // non-200 response so FraudRiskChecker's onComplete can show "not saved
    // yet" instead of silently pretending it worked (this is the same bug
    // class Vlad reported for credibility on 2026-07-15, fixed the same way).
    if (body.fraudRisk !== undefined) {
      await updateScreeningFraudRisk(numId, body.fraudRisk, actorUserId);
    }
    // Source edit, 2026-07-20 (Vlad's ask) — lets a recruiter correct/set
    // source (Applicant/LinkedIn/Agency) after the fact from the Pipeline
    // card, not just at initial screening time. Pure metadata patch, see
    // lib/screenings.ts's updateScreening() comment — never re-triggers scoring.
    if (body.linkedInMode !== undefined || body.agencyName !== undefined) {
      await updateScreening(numId, {
        ...(body.linkedInMode !== undefined ? { linkedInMode: Boolean(body.linkedInMode) } : {}),
        ...(body.agencyName !== undefined ? { agencyName: String(body.agencyName) } : {}),
      });
    }
    // Blacklist, 2026-07-31 (Vlad's ask) — set from the archive-reason
    // picker's checkbox (StatusStageControl.tsx). Wrapped in .catch() since
    // supabase-migration-blacklist.sql is not yet confirmed run everywhere —
    // a missing column here should never fail the surrounding status/reason
    // save this usually rides alongside.
    if (body.blacklisted !== undefined || body.blacklistReason !== undefined) {
      await updateScreening(numId, {
        ...(body.blacklisted !== undefined ? { blacklisted: Boolean(body.blacklisted) } : {}),
        ...(body.blacklistReason !== undefined ? { blacklistReason: body.blacklistReason } : {}),
      }, actorUserId).catch((err) => {
        console.error("blacklist write failed (non-fatal):", err);
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteScreening(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
