import { NextRequest, NextResponse } from "next/server";
import { getActionTimeline } from "@/lib/screeningActions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const actions = await getActionTimeline(numId);
    return NextResponse.json({ actions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
