import { NextResponse } from "next/server";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

// Mirrors app/api/history/[id]/resume/preview/route.ts almost exactly, for
// the cross-reference doc instead of the resume — added 2026-08-02 to fix a
// real bug Vlad reported: "Doublecheck cross-reference check for Word docx.
// I only see a black screen." Root cause: the cross-reference tab in
// app/interview/[id]/document/page.tsx always pointed straight at the raw
// /api/history/[id]/linkedin endpoint, assuming (wrongly) that anything
// uploaded there was previewable inline — true for a real LinkedIn PDF, but
// browsers can't render a raw .docx/.doc inline in an iframe regardless of
// Content-Type, same structural issue the resume tab already hit and fixed
// on 2026-07-16, just never ported over to this tab. This route renders an
// inline HTML preview instead (mammoth for .docx, word-extractor's plain
// text for legacy .doc) so the docx path has somewhere previewable to point
// at, same as the resume side.
//
// See wrapHtml() in the resume preview route for why the light-background/
// color-scheme styling is deliberate (dark-mode re-theming bug, 2026-07-16).

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapHtml(bodyHtml: string, monospace: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<style>
  html {
    color-scheme: light;
    background: #ffffff;
  }
  body {
    background: #ffffff;
    font-family: ${monospace ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : "Georgia, 'Times New Roman', serif"};
    max-width: 820px;
    margin: 40px auto;
    padding: 0 28px 60px;
    color: #18181b;
    line-height: 1.6;
    font-size: ${monospace ? "13px" : "15px"};
  }
  pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
  h1, h2, h3, strong { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; }
  table { border-collapse: collapse; margin: 12px 0; }
  td, th { border: 1px solid #d4d4d8; padding: 4px 10px; text-align: left; }
  ul, ol { padding-left: 22px; }
  p { margin: 0 0 10px; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

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

  const supabase = getSupabaseClient();
  const { data: row, error: rowErr } = await supabase
    .from("screenings")
    .select("linkedin_pdf_path")
    .eq("id", screeningId)
    .single<{ linkedin_pdf_path: string | null }>();

  if (rowErr || !row?.linkedin_pdf_path) {
    return NextResponse.json({ error: "Cross-reference document not available" }, { status: 404 });
  }

  const download = await supabase.storage.from(RESUME_BUCKET).download(row.linkedin_pdf_path);
  if (download.error) {
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
  const buffer = Buffer.from(await download.data.arrayBuffer());
  const extension = row.linkedin_pdf_path.toLowerCase().split(".").pop();

  try {
    if (extension === "docx") {
      const { value: html } = await mammoth.convertToHtml({ buffer });
      return new NextResponse(wrapHtml(html, false), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (extension === "doc") {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      const text = escapeHtml(doc.getBody());
      return new NextResponse(wrapHtml(`<pre>${text}</pre>`, true), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  } catch (err) {
    console.error("Cross-reference preview conversion failed:", err);
    return NextResponse.json({ error: "Could not render a preview for this file" }, { status: 500 });
  }

  return NextResponse.json({ error: "Preview not supported for this file type" }, { status: 415 });
}
