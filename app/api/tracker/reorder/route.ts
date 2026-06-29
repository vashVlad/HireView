import { NextRequest, NextResponse } from "next/server";
import { reorderTrackerEntries } from "@/lib/screenings";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const order = body?.order;

  if (!Array.isArray(order) || order.some((o) => typeof o.screeningId !== "number" || typeof o.orderIndex !== "number")) {
    return NextResponse.json({ error: "Invalid order payload" }, { status: 400 });
  }

  try {
    await reorderTrackerEntries(order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Reorder error:", err);
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}
