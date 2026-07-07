import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { updateScreening } from "@/lib/screenings";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

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

  const { data: urlData } = supabase.storage.from(RESUME_BUCKET).getPublicUrl(path);
  const photoUrl = urlData.publicUrl;

  await updateScreening(numId, { photoUrl });

  return NextResponse.json({ photoUrl });
}
