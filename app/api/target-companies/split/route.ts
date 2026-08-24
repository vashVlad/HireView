import { NextRequest, NextResponse } from "next/server";
import { splitCompanyNames } from "@/lib/splitCompanyNames";

/**
 * Target-company input splitting, 2026-08-24 (Vlad's ask, refined same day
 * — see lib/splitCompanyNames.ts's own doc comment for the full design).
 * A thin route wrapper — the actual comma/single-token/AI-assisted logic
 * lives in the lib function. Auth is handled by middleware.ts (every
 * non-public /api/ path already requires a signed-in user), no separate
 * check needed here.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = typeof body?.input === "string" ? body.input : "";
  if (!input.trim()) {
    return NextResponse.json({ companies: [] });
  }

  try {
    const companies = await splitCompanyNames(input);
    return NextResponse.json({ companies });
  } catch (err) {
    console.error("Company-name split route error:", err);
    return NextResponse.json({ error: "Failed to split company names" }, { status: 500 });
  }
}
