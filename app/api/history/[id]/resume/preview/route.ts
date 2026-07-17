import { NextResponse } from "next/server";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { getScreeningResume } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

// Browsers can only render PDFs natively inline — everything else (docx,
// legacy doc) previously just downloaded, which Vlad flagged as inconvenient
// during real screening ("word documents aren't allowed to be previewed").
// This route renders an inline HTML preview instead of forcing a download:
// mammoth converts .docx to real (if basic) formatted HTML, and word-extractor
// (already used for .doc text extraction in lib/parseResume.ts) gives us
// plain text for legacy .doc, which we wrap as preformatted text. Neither
// path produces an actual PDF file — that would need either a paid
// conversion API or a headless-Chrome-in-serverless setup, which is real
// infra complexity this app doesn't otherwise need. The raw file is always
// still one click away via the "Download original" link next to this
// preview (app/interview/[id]/document/page.tsx), so nothing is lost, only
// download-to-preview is no longer required for the common case.

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
  /* Explicit light background + color-scheme, both belt-and-suspenders:
     without a declared background, Chrome's auto-dark-mode heuristic (and
     some ad-block/dark-mode extensions) will re-theme this page to a dark
     background while leaving our #18181b near-black text color untouched —
     the "text is barely visible, dark-on-dark" bug Vlad hit 2026-07-16. */
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

  const resume = await getScreeningResume(screeningId).catch(() => null);
  if (!resume) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const extension = resume.fileName.toLowerCase().split(".").pop();

  try {
    if (extension === "docx") {
      const { value: html } = await mammoth.convertToHtml({ buffer: resume.data });
      return new NextResponse(wrapHtml(html, false), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (extension === "doc") {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(resume.data);
      const text = escapeHtml(doc.getBody());
      return new NextResponse(wrapHtml(`<pre>${text}</pre>`, true), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  } catch (err) {
    console.error("Resume preview conversion failed:", err);
    return NextResponse.json({ error: "Could not render a preview for this file" }, { status: 500 });
  }

  return NextResponse.json({ error: "Preview not supported for this file type" }, { status: 415 });
}
