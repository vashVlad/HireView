import { NextRequest, NextResponse } from "next/server";
import { generateChecklist } from "@/lib/generateChecklist";
import { getProject, getProjectChecklist, updateProjectChecklist } from "@/lib/projects";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import type { ChecklistItem } from "@/lib/types";

/**
 * JD checklist ("Trust badge"), 2026-08-17 (Vlad's ask). A dedicated route,
 * separate from app/api/projects/[id]/route.ts's general PATCH — same
 * reasoning as excludeFromFitSuggestions being its own isolated read
 * (getProjectFitExclusion), but this one also needs a real generation
 * action (an Anthropic call), which the general project PATCH has no
 * equivalent of. Requires supabase-migration-checklist.sql — see
 * lib/projects.ts's getProjectChecklist/updateProjectChecklist for why
 * errors here are NOT swallowed (a checklist read/write is always a
 * deliberate, foreground recruiter action, unlike the best-effort deferred
 * columns saveScreening() writes in the background).
 */

async function requireAccess(request: NextRequest, numId: number) {
  const user = await getAuthUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await canAccessProject(user, numId))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireAccess(request, numId);
  if (access.error) return access.error;

  try {
    const checklist = await getProjectChecklist(numId);
    return NextResponse.json({ checklist });
  } catch (err) {
    console.error("Checklist GET error (migration likely not run yet):", err);
    return NextResponse.json({ error: "Failed to fetch checklist" }, { status: 500 });
  }
}

/**
 * Generates a fresh checklist from the project's current JD/must-have/
 * nice-to-have lists and overwrites whatever checklist (if any) already
 * existed — same "regenerate replaces" convention as JD re-analysis
 * elsewhere in this app. A recruiter who has hand-edited items should
 * expect regenerating to reset those edits; the UI should warn before
 * calling this on a project with existing items (see the Filters tab).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireAccess(request, numId);
  if (access.error) return access.error;

  try {
    const project = await getProject(numId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const checklist = await generateChecklist({
      jobDescription: project.jobDescription,
      mustHaveSkills: project.jdAnalysis?.mustHaveSkills ?? [],
      niceToHaveSkills: project.jdAnalysis?.niceToHaveSkills ?? [],
    });
    await updateProjectChecklist(numId, checklist);
    return NextResponse.json({ checklist });
  } catch (err) {
    console.error("Checklist generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate checklist" },
      { status: 500 }
    );
  }
}

/**
 * Manual edit — Vlad's explicit preference (individually editable fields,
 * not one freeform text block). Accepts the full items array (the Filters
 * tab UI holds the working copy client-side and PATCHes the whole thing on
 * save, same pattern as suggestedRoleFits' "full replacement array, not an
 * append" convention in lib/screenings.ts's updateScreening). No AI call —
 * pure metadata patch, same as every other manual-edit route in this app.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireAccess(request, numId);
  if (access.error) return access.error;

  const body = await request.json().catch(() => null);
  const items = body?.items;
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  // Light shape validation — this route is the only write path for
  // hand-edited items, so a malformed item here would otherwise silently
  // corrupt every future evaluateChecklist() call for this project.
  const valid = items.every(
    (item): item is ChecklistItem =>
      item &&
      typeof item.id === "string" &&
      (item.category === "decrease" || item.category === "add") &&
      typeof item.label === "string" &&
      item.label.trim().length > 0 &&
      typeof item.points === "number" &&
      item.points > 0
  );
  if (!valid) {
    return NextResponse.json({ error: "Each item needs a valid id, category, label, and positive points" }, { status: 400 });
  }

  try {
    // Preserve the original generatedAt (when this checklist was last
    // AI-generated) on a manual edit — only POST (regeneration) should ever
    // bump it. Falls back to "now" only for the edge case of a checklist
    // built entirely by hand with no prior generation.
    const existing = await getProjectChecklist(numId);
    const checklist = { items: items as ChecklistItem[], generatedAt: existing?.generatedAt ?? new Date().toISOString() };
    await updateProjectChecklist(numId, checklist);
    return NextResponse.json({ checklist });
  } catch (err) {
    console.error("Checklist PATCH error:", err);
    return NextResponse.json({ error: "Failed to save checklist" }, { status: 500 });
  }
}
