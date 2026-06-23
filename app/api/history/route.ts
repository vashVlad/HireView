import { NextRequest, NextResponse } from "next/server";
import { listScreenings } from "@/lib/screenings";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const statusParam = request.nextUrl.searchParams.get("status");
  const statuses = statusParam
    ?.split(",")
    .filter((s): s is CandidateStatus => CANDIDATE_STATUSES.includes(s as CandidateStatus));

  try {
    const screenings = await listScreenings(query, statuses);
    return NextResponse.json({ screenings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
