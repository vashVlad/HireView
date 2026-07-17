import { NextRequest, NextResponse } from "next/server";
import { getFullTrackerEntries } from "@/lib/screenings";
import { getAuthUser, isAdmin, teamIdsFilter } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({ entries: {} });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n));
  if (ids.length === 0) return NextResponse.json({ entries: {} });

  // Multi-id variant of the same team check as tracker/[screeningId] — rather
  // than one query per id, filter the requested ids down to the ones whose
  // team_id the caller actually belongs to (admin: no filter, sees all).
  // Found + fixed in the 2026-07-16 audit alongside every other by-id route
  // that skipped this.
  let allowedIds = ids;
  if (!isAdmin(user)) {
    const teamIds = await teamIdsFilter(user);
    if (!teamIds || teamIds.length === 0) return NextResponse.json({ entries: {} });
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("screenings")
      .select("id")
      .in("id", ids)
      .in("team_id", teamIds)
      .returns<{ id: number }[]>();
    allowedIds = (data ?? []).map((r) => r.id);
  }

  try {
    const entries = await getFullTrackerEntries(allowedIds);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
