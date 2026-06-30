// This route is no longer used — reordering was removed in the swimlane redesign.
import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
