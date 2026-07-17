import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { getAuthUsers } from "@/lib/recruiters";

// Live-count rewrite, 2026-07-17 (mirrors lib/funnelview/data.ts's fix,
// session-log follow-on #37/#38) — deliberately no `screening_batches`
// query here. That table is an immutable per-upload-batch log written once
// and never updated on later deletion, so sourcing stats from it means
// deleting a screening can never move any number on this page. Switched to
// live queries off `screenings` itself, joined against `projects` for each
// candidate's own score_threshold (defaults to 45, matching lib/projects.ts)
// so "Passed to Pipeline" reflects the real per-project bar, not a single
// global cutoff — every screened resume gets a row now regardless of score
// (2026-07-15 auto-archive/save-all decision), so this can't just be
// `screenings.length` filtered by status.

type ScreeningRow = {
  id: number;
  project_id: number | null;
  user_id: string | null;
  score: number;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabaseClient();
  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const recruiterIdFilter = params.get("recruiterId") ?? null;

  // ── Build live screenings query ─────────────────────────────────────────

  let screeningsQuery = supabase
    .from("screenings")
    .select("id, project_id, user_id, score, created_at");

  if (from) screeningsQuery = screeningsQuery.gte("created_at", from);
  if (to) screeningsQuery = screeningsQuery.lte("created_at", to + "T23:59:59Z");
  if (recruiterIdFilter) screeningsQuery = screeningsQuery.eq("user_id", recruiterIdFilter);

  // ── Run queries in parallel ────────────────────────────────────────────────

  const [screeningsRes, projectsRes, authUsers] = await Promise.all([
    screeningsQuery.returns<ScreeningRow[]>(),
    supabase.from("projects").select("id, name, score_threshold").returns<{ id: number; name: string; score_threshold: number | null }[]>(),
    getAuthUsers(),
  ]);

  if (screeningsRes.error) {
    return NextResponse.json({ error: screeningsRes.error.message }, { status: 500 });
  }

  const screenings = screeningsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const thresholdMap = new Map(projects.map((p) => [p.id, p.score_threshold ?? 45]));

  // ── Flatten all scores (includes below-threshold candidates — every
  //    screened resume is saved regardless of score) ────────────────────────

  const allScores = screenings.map((s) => s.score);

  // ── Top-line stats ─────────────────────────────────────────────────────────

  const totalScreened = screenings.length;
  const passedToPipeline = screenings.filter((s) => {
    const threshold = s.project_id != null ? (thresholdMap.get(s.project_id) ?? 45) : 45;
    return s.score >= threshold;
  }).length;
  const passRate = totalScreened > 0 ? Math.round((passedToPipeline / totalScreened) * 100) : 0;
  const avgScore =
    allScores.length > 0
      ? Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length)
      : 0;
  const timeSavedMinutes = totalScreened * 15;

  // ── Score distribution ─────────────────────────────────────────────────────

  const buckets = [
    { label: "0–19", min: 0, max: 19 },
    { label: "20–39", min: 20, max: 39 },
    { label: "40–59", min: 40, max: 59 },
    { label: "60–79", min: 60, max: 79 },
    { label: "80–100", min: 80, max: 100 },
  ];
  const scoreDistribution = buckets.map(({ label, min, max }) => ({
    label,
    count: allScores.filter((s) => s >= min && s <= max).length,
  }));

  // ── By project ────────────────────────────────────────────────────────────

  const byProjectMap = new Map<number, { totalCount: number; totalScore: number; name: string }>();
  for (const s of screenings) {
    if (s.project_id == null) continue;
    const existing = byProjectMap.get(s.project_id);
    if (existing) {
      existing.totalCount += 1;
      existing.totalScore += s.score;
    } else {
      byProjectMap.set(s.project_id, {
        totalCount: 1,
        totalScore: s.score,
        name: projectMap.get(s.project_id) ?? `Project ${s.project_id}`,
      });
    }
  }
  const byProject = Array.from(byProjectMap.entries())
    .map(([projectId, { totalCount, totalScore, name }]) => ({
      projectId,
      name,
      count: totalCount,
      avgScore: totalCount > 0 ? Math.round(totalScore / totalCount) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── By recruiter ───────────────────────────────────────────────────────────

  const userEmailMap = new Map(authUsers.map((u) => [u.id, u.email ?? u.id]));
  const byRecruiterMap = new Map<string, number>();
  for (const s of screenings) {
    if (!s.user_id) continue;
    byRecruiterMap.set(s.user_id, (byRecruiterMap.get(s.user_id) ?? 0) + 1);
  }
  const byRecruiter = Array.from(byRecruiterMap.entries())
    .map(([userId, count]) => ({ userId, email: userEmailMap.get(userId) ?? userId, count }))
    .sort((a, b) => b.count - a.count);

  // ── Daily activity ─────────────────────────────────────────────────────────

  const dailyMap = new Map<string, { count: number; totalScore: number }>();
  for (const s of screenings) {
    const day = s.created_at.slice(0, 10);
    const existing = dailyMap.get(day);
    if (existing) {
      existing.count += 1;
      existing.totalScore += s.score;
    } else {
      dailyMap.set(day, { count: 1, totalScore: s.score });
    }
  }
  const recentActivity = Array.from(dailyMap.entries())
    .map(([date, { count, totalScore }]) => ({
      date,
      count,
      avgScore: count > 0 ? Math.round(totalScore / count) : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // ── Recruiter list for filter dropdown ────────────────────────────────────

  const recruiterList = authUsers.map((u) => ({
    id: u.id,
    email: u.email ?? u.id,
    role: (u.app_metadata?.role as string) ?? "recruiter",
  }));

  return NextResponse.json({
    totalScreened,
    passedToPipeline,
    passRate,
    avgScore,
    timeSavedMinutes,
    scoreDistribution,
    byProject,
    byRecruiter,
    recentActivity,
    recruiterList,
  });
}
