import { NextRequest, NextResponse } from "next/server";
import { getStatusCounts, listScreenings } from "@/lib/screenings";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const flaggedOnly = request.nextUrl.searchParams.get("flagged") === "1";
  const projectIdParam = request.nextUrl.searchParams.get("projectId");
  const projectId = projectIdParam ? parseInt(projectIdParam, 10) : undefined;

  const statuses = statusParam
    ?.split(",")
    .filter((s): s is CandidateStatus => CANDIDATE_STATUSES.includes(s as CandidateStatus));

  try {
    const [screenings, statusCounts] = await Promise.all([
      listScreenings(query, statuses, flaggedOnly, projectId),
      getStatusCounts(projectId),
    ]);
    return NextResponse.json({ screenings, statusCounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch screenings" },
      { status: 500 }
    );
  }
}
