import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Compare feature has been removed. Use the credibility checker instead." }, { status: 410 });
}
