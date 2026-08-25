import { NextResponse } from "next/server";
import { getScreeningResume } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = Number(id);

  if (!Number.isInteger(screeningId)) {
    return NextResponse.json({ error: "Invalid screening id" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Real error handling, 2026-08-25 — getScreeningResume() throws raw on a
  // Supabase error; the sibling resume/preview/route.ts already guards this
  // identical call with .catch(() => null), this route just hadn't been
  // brought in line with it yet. A storage hiccup previously fell through
  // to Next.js's bodyless default 500 instead of a clean 404/diagnosable
  // message.
  const resume = await getScreeningResume(screeningId).catch((err) => {
    console.error("Resume fetch failed:", err);
    return null;
  });
  if (!resume) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Blob([new Uint8Array(resume.data)]), {
    headers: {
      "Content-Type": resume.mimeType,
      "Content-Disposition": `inline; filename="${resume.fileName}"`,
    },
  });
}
