import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getFunnelData } from "@/lib/funnelview/data";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Real error handling, 2026-08-25 — getFunnelData() throws raw on either
  // of its two required Supabase queries failing; nothing here caught that
  // before, so a transient DB hiccup produced Next.js's bodyless default 500
  // instead of a diagnosable message.
  try {
    const data = await getFunnelData();
    return NextResponse.json(data);
  } catch (err) {
    console.error("FunnelView data load failed:", err);
    return NextResponse.json({ error: "Could not load FunnelView data — see server logs for the real cause" }, { status: 500 });
  }
}
