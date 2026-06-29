import { NextResponse } from "next/server";
import { getTrackerEntries } from "@/lib/screenings";

export async function GET() {
  try {
    const entries = await getTrackerEntries();
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Tracker GET error:", err);
    return NextResponse.json({ error: "Failed to load tracker" }, { status: 500 });
  }
}
