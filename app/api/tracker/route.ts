import { NextRequest, NextResponse } from "next/server";
import { getFullTrackerEntries } from "@/lib/screenings";

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({ entries: {} });

  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n));
  try {
    const entries = await getFullTrackerEntries(ids);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
