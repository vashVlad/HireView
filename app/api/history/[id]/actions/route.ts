import { NextRequest, NextResponse } from "next/server";
import { getActionTimeline } from "@/lib/screeningActions";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const actions = await getActionTimeline(numId);
    return NextResponse.json({ actions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
