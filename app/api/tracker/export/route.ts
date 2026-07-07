// This route is no longer used — export is handled client-side in the Tracker tab.
// Keeping file to avoid breaking the route structure; returns 404.
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
