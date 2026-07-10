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

  // Content-Type was previously hardcoded to "application/pdf" regardless of
  // what was actually stored — the cross-reference upload accepts .pdf OR
  // .docx (see assess-credibility/route.ts), and a .docx served with a PDF
  // Content-Type renders blank/broken in the iframe viewer. Unlike the
  // resume route (which reads resume_mime_type from a dedicated DB column),
  // there's no equivalent column here, so use the Blob's real type — Supabase
  // Storage preserves the contentType set at upload time and returns it as
  // the response Content-Type, which the Blob picks up as .type.
  const contentType = download.data.type || "application/pdf";
  const ext = row.linkedin_pdf_path.split(".").pop()?.toLowerCase() ?? "pdf";
  const suffix = ext === "docx" ? "docx" : "pdf";

  // Real bug: raw HTTP header values must be ASCII/Latin-1. This filename
  // baked in a literal em-dash ("—", U+2014) plus the candidate's actual
  // name (often containing accented characters, e.g. "José García") — both
  // land in Content-Disposition unescaped. Depending on the runtime, an
  // invalid byte in a header value can make the whole response fail to
  // parse, which shows up as an empty iframe over the page's dark
  // background — i.e. a black screen. The resume route never hit this
  // because it uses the plain uploaded filename, not a name + special
  // character. Fixed with an ASCII-only fallback (`filename=`) plus a
  // properly RFC 5987-encoded Unicode version (`filename*=`) so modern
  // browsers still show the nice name.
  const rawFilename = `${row.candidate_name} — LinkedIn.${suffix}`;
  const asciiFilename = (row.candidate_name.replace(/[^\x20-\x7E]/g, "").trim() || "Candidate") + ` - LinkedIn.${suffix}`;

  const data = Buffer.from(await download.data.arrayBuffer());
  return new NextResponse(new Blob([new Uint8Array(data)]), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(rawFilename)}`,
    },
  });
}
