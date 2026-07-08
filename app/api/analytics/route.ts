import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

type BatchRow = {
  created_at: string;
  user_id: string | null;
  project_id: number | null;
  total_count: number;
  passed_count: number;
  scores: number[];
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

  // ── Build batch query ──────────────────────────────────────────────────────

  let batchQuery = supabase
    .from("screening_batches")
    .select("created_at, user_id, project_id, total_count, passed_count, scores");

  if (from) batchQuery = batchQuery.gte("created_at", from);
  if (to) batchQuery = batchQuery.lte("created_at", to + "T23:59:59Z");
  if (recruiterIdFilter) batchQuery = batchQuery.eq("user_id", recruiterIdFilter);

  // ── Run queries in parallel ────────────────────────────────────────────────

  const [batchesRes, projectsRes, usersRes] = await Promise.all([
    batchQuery.returns<BatchRow[]>(),
    supabase.from("projects").select("id, name").returns<{ id: number; name: string }[]>(),
    supabase.auth.admin.listUsers(),
  ]);

  if (batchesRes.error) {
    return NextResponse.json({ error: batchesRes.error.message }, { status: 500 });
  }

  const batches = batchesRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const authUsers = usersRes.data?.users ?? [];

  // ── Flatten all scores (includes rejected candidates) ─────────────────────

  const allScores = batches.flatMap((b) => b.scores ?? []);

  // ── Top-line stats ─────────────────────────────────────────────────────────

  const totalScreened = batches.reduce((sum, b) => sum + b.total_count, 0);
  const passedToPipeline = batches.reduce((sum, b) => sum + b.passed_count, 0);
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

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const byProjectMap = new Map<number, { totalCount: number; totalScore: number; name: string }>();
  for (const b of batches) {
    if (b.project_id == null) continue;
    const scores = b.scores ?? [];
    const existing = byProjectMap.get(b.project_id);
    if (existing) {
      existing.totalCount += b.total_count;
      existing.totalScore += scores.reduce((s, v) => s + v, 0);
    } else {
      byProjectMap.set(b.project_id, {
        totalCount: b.total_count,
        totalScore: scores.reduce((s, v) => s + v, 0),
        name: projectMap.get(b.project_id) ?? `Project ${b.project_id}`,
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
  const byRecruiterMap = new Map<string, { count: number; email: string }>();
  for (const b of batches) {
    if (!b.user_id) continue;
    const existing = byRecruiterMap.get(b.user_id);
    if (existing) {
      existing.count += b.total_count;
    } else {
      byRecruiterMap.set(b.user_id, {
        count: b.total_count,
        email: userEmailMap.get(b.user_id) ?? b.user_id,
      });
    }
  }
  const byRecruiter = Array.from(byRecruiterMap.entries())
    .map(([userId, { count, email }]) => ({ userId, email, count }))
    .sort((a, b) => b.count - a.count);

  // ── Daily activity ─────────────────────────────────────────────────────────

  const dailyMap = new Map<string, { count: number; totalScore: number; scoreCount: number }>();
  for (const b of batches) {
    const day = b.created_at.slice(0, 10);
    const scores = b.scores ?? [];
    const existing = dailyMap.get(day);
    if (existing) {
      existing.count += b.total_count;
      existing.totalScore += scores.reduce((s, v) => s + v, 0);
      existing.scoreCount += scores.length;
    } else {
      dailyMap.set(day, {
        count: b.total_count,
        totalScore: scores.reduce((s, v) => s + v, 0),
        scoreCount: scores.length,
      });
    }
  }
  const recentActivity = Array.from(dailyMap.entries())
    .map(([date, { count, totalScore, scoreCount }]) => ({
      date,
      count,
      avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
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
