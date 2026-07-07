import { NextResponse } from "next/server";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";

// HEAD — lightweight check: does a LinkedIn PDF exist for this candidate?
export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return new NextResponse(null, { status: 400 });

  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from("screenings")
    .select("linkedin_pdf_path")
    .eq("id", numId)
    .single<{ linkedin_pdf_path: string | null }>();

  return new NextResponse(null, { status: row?.linkedin_pdf_path ? 200 : 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const supabase = getSupabaseClient();

  const { data: row, error: rowErr } = await supabase
    .from("screenings")
    .select("linkedin_pdf_path, candidate_name")
    .eq("id", numId)
    .single<{ linkedin_pdf_path: string | null; candidate_name: string }>();

  if (rowErr || !row?.linkedin_pdf_path) {
    return NextResponse.json({ error: "LinkedIn PDF not available" }, { status: 404 });
  }

  const download = await supabase.storage.from(RESUME_BUCKET).download(row.linkedin_pdf_path);
  if (download.error) return NextResponse.json({ error: "Download failed" }, { status: 500 });

  const data = Buffer.from(await download.data.arrayBuffer());
  return new NextResponse(new Blob([new Uint8Array(data)]), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.candidate_name} — LinkedIn.pdf"`,
    },
  });
}
