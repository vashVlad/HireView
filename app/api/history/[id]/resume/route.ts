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

  const resume = await getScreeningResume(screeningId);
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
