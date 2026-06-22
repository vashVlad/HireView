import { NextRequest, NextResponse } from "next/server";
import { listScreenings } from "@/lib/screenings";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const screenings = await listScreenings(query);
    return NextResponse.json({ screenings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
