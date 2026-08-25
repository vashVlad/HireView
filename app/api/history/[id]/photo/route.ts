import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { updateScreening } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

/** GET /api/history/[id]/photo — proxy the photo from private Supabase Storage */
export async function GET(
  _request: NextRequest,
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

  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from("screenings")
    .select("photo_url")
    .eq("id", numId)
    .single();

  const storagePath = row?.photo_url;
  if (!storagePath) return NextResponse.json({ error: "No photo" }, { status: 404 });

  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(storagePath);

  if (error || !data) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = storagePath.split(".").pop() ?? "jpg";
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function POST(
  request: NextRequest,
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

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo file provided" }, { status: 400 });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Photo must be JPEG, PNG, WebP, or GIF" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `photos/${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Store the storage path (not a public URL) — served via GET /api/history/[id]/photo
  const photoUrl = path;

  // Real error handling, 2026-08-25 — updateScreening() throws raw on a
  // Supabase error; unguarded, that meant a DB hiccup here (AFTER the photo
  // already uploaded successfully above) fell through to a bodyless default
  // 500 instead of a clear "uploaded but not linked" message worth its own
  // log line, since the two failure points are otherwise indistinguishable.
  try {
    await updateScreening(numId, { photoUrl });
  } catch (err) {
    console.error("Photo uploaded but updateScreening failed to link it:", err);
    return NextResponse.json({ error: "Photo uploaded but could not be saved to the candidate — try again" }, { status: 500 });
  }

  return NextResponse.json({ photoUrl: `/api/history/${numId}/photo` });
}
