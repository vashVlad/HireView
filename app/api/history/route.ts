import { NextRequest, NextResponse } from "next/server";
import { getStatusCounts, listScreenings } from "@/lib/screenings";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const statuses = statusParam
    ?.split(",")
    .filter((s): s is CandidateStatus => CANDIDATE_STATUSES.includes(s as CandidateStatus));

  try {
    const [screenings, statusCounts] = await Promise.all([
      listScreenings(query, statuses),
      getStatusCounts(),
    ]);
    return NextResponse.json({ screenings, statusCounts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
