"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Browsers can only render PDFs natively inside an iframe. Anything else
// (docx, doc, ...) gets silently downloaded by the browser instead of
// displayed the moment the iframe's src is set — that's the "black screen +
// it downloads on its own" bug Vlad reported, 2026-07-15. LinkedIn PDFs are
// always stored as application/pdf (the credibility-check upload only
// accepts PDF), so they never hit this path — only the resume can be a
// non-PDF type.
const PREVIEWABLE_MIME_TYPES = new Set(["application/pdf"]);

// 2026-07-16: Word resumes no longer fall straight through to "download to
// view" — /api/history/[id]/resume/preview renders an inline HTML preview
// (mammoth for .docx, word-extractor's plain text for legacy .doc). Detected
// by mime type OR filename extension, since File.type from the browser
// isn't always populated reliably for older/renamed files.
const OFFICE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
]);

// Next.js requires useSearchParams() to sit inside a Suspense boundary or
// the build errors ("should be wrapped in a suspense boundary") — this
// wrapper is that boundary; the fallback is effectively invisible since
// search params are available synchronously on the client in practice.
export default function InterviewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="flex h-screen bg-zinc-950" />}>
      <InterviewDocumentPageInner params={params} />
    </Suspense>
  );
}

function InterviewDocumentPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [activeDoc, setActiveDoc] = useState<"resume" | "linkedin">("resume");
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  // The cross-reference doc stored under this candidate can be a real
  // LinkedIn PDF OR a second resume version (see CredibilityChecker.tsx's
  // uploader copy: "LinkedIn PDF or second resume") — the tab used to always
  // say "LinkedIn" regardless of which it actually was. The HEAD check now
  // reports this via a response header (X-Cross-Ref-Is-Linkedin), backed by
  // the already-computed detectLinkedIn() classification from the
  // credibility check itself. null = unknown (pre-migration row, or the
  // header wasn't present) — treated as "don't assume LinkedIn."
  const [crossRefIsLinkedIn, setCrossRefIsLinkedIn] = useState<boolean | null>(null);
  // File extension of the stored cross-reference doc, 2026-08-02 — needed to
  // route docx/doc through the HTML preview endpoint instead of the raw file
  // endpoint, same fix already applied to the resume tab on 2026-07-16. A
  // real LinkedIn PDF is always "pdf" (the credibility-check upload only
  // ever produces one for that case), so this only actually matters for the
  // "second resume" cross-reference case, but it's read unconditionally so
  // an unknown/pre-migration row still degrades safely to "assume pdf."
  const [crossRefExt, setCrossRefExt] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/history/${id}/linkedin`, { method: "HEAD" })
      .then((r) => {
        setHasLinkedIn(r.ok);
        const header = r.headers.get("X-Cross-Ref-Is-Linkedin");
        setCrossRefIsLinkedIn(header === "true" ? true : header === "false" ? false : null);
        const extHeader = r.headers.get("X-Cross-Ref-Ext");
        setCrossRefExt(extHeader && extHeader !== "unknown" ? extHeader : null);
      })
      .catch(() => setHasLinkedIn(false))
      .finally(() => setChecking(false));
  }, [id]);

  // Display label/icon for the second tab — only call it "LinkedIn" when
  // we actually know that's what was uploaded. Anything else (a second
  // resume, or an unknown/pre-migration row) gets a neutral, generic label
  // instead of a guess.
  const crossRefLabel = crossRefIsLinkedIn === true ? "LinkedIn" : "Cross-Reference";

  // The caller already has the resume's mime type in memory (it's on
  // ScreeningRecord) and passes it straight through as a URL param — see
  // the `window.open(...?mime=...)` call sites in candidates/page.tsx and
  // projects/[id]/page.tsx. Reading it here is synchronous, so there's no
  // fetch/race/auth dependency in a popup window's own session. First
  // attempt at this fix used a client-side fetch to look up the mime type
  // and defaulted to "not previewable" while that fetch was in flight or if
  // it failed — that fail-closed default broke the common PDF case whenever
  // the fetch was slow or didn't carry auth cleanly in the popup context
  // (Vlad's report, 2026-07-15: "it still wants me to download it... it
  // worked before"). Now: no param, or a param we don't recognize, means
  // "assume previewable" — matches the original always-iframe behavior, and
  // only genuinely-known non-PDF types fall back to the download panel.
  const resumeMimeParam = searchParams.get("mime");
  const resumeFileName = searchParams.get("name") ?? "resume";

  // Checked by mime type OR filename extension — browsers don't always
  // populate File.type reliably (older files, some OS/browser combos), and
  // the extension is a much more reliable signal for something we already
  // trust the filename for elsewhere in the app.
  const resumeExt = resumeFileName.toLowerCase().split(".").pop();
  const isOfficeDoc = activeDoc === "resume" && (
    (resumeMimeParam !== null && OFFICE_MIME_TYPES.has(resumeMimeParam))
    || resumeExt === "doc"
    || resumeExt === "docx"
  );

  // Same idea as isOfficeDoc above, for the cross-reference tab — fixes the
  // "black screen" bug Vlad reported: a docx cross-reference upload was
  // always pointed at the raw file endpoint, which browsers can't render
  // inline regardless of Content-Type (only PDF renders natively in an
  // iframe). See linkedin/preview/route.ts for the actual HTML conversion.
  const isOfficeCrossRef = activeDoc === "linkedin" && (crossRefExt === "doc" || crossRefExt === "docx");

  const rawResumeUrl = `/api/history/${id}/resume`;
  const docUrl = activeDoc === "resume"
    ? (isOfficeDoc ? `/api/history/${id}/resume/preview` : rawResumeUrl)
    : (isOfficeCrossRef ? `/api/history/${id}/linkedin/preview` : `/api/history/${id}/linkedin`);

  const canPreview = activeDoc === "linkedin"
    || isOfficeDoc
    || resumeMimeParam === null
    || PREVIEWABLE_MIME_TYPES.has(resumeMimeParam);

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-3">

        {/* Toggle — prominent pill buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveDoc("resume")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              activeDoc === "resume"
                ? "bg-white text-zinc-900 shadow"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {/* Document icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Resume
          </button>

          <button
            type="button"
            onClick={() => hasLinkedIn && setActiveDoc("linkedin")}
            disabled={checking || !hasLinkedIn}
            title={!hasLinkedIn && !checking ? "Run a credibility check first to store this document" : undefined}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              activeDoc === "linkedin"
                ? crossRefIsLinkedIn === true
                  ? "bg-[#0077B5] text-white shadow"
                  : "bg-white text-zinc-900 shadow"
                : hasLinkedIn
                ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                : "cursor-not-allowed bg-zinc-900 text-zinc-700"
            }`}
          >
            {crossRefIsLinkedIn === true ? (
              /* LinkedIn icon — only shown when we actually know this is a LinkedIn PDF */
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            ) : (
              /* Generic document icon — used whenever the cross-reference
                 doc isn't confirmed to be a LinkedIn PDF (a second resume,
                 or an unknown/pre-migration row). */
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {crossRefLabel}
            {!hasLinkedIn && !checking && (
              <span className="ml-1 text-[10px] font-normal text-zinc-600">(not stored)</span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Back button — added 2026-07-27 (Vlad: "in case I follow some
              link"). A previewed doc (docx preview HTML, or a resume with an
              embedded LinkedIn/portfolio/email link) can navigate the iframe
              away from the document view with no way back short of closing
              the whole popup. window.history.back() targets the popup
              window's own joint session history, which includes same-origin
              iframe navigations in this app (both the raw file endpoints and
              /resume/preview are same-origin), so this reliably returns to
              the last document view instead of just closing the window. */}
          <button
            type="button"
            onClick={() => window.history.back()}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5m0 0 6 6m-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>

          {/* Download original — always available for the resume, even
              when a preview is showing (Vlad, 2026-07-16: "keep both").
              Always points at the raw file endpoint, never the HTML
              preview, so the recruiter gets the exact original either way. */}
          {activeDoc === "resume" && (
            <a
              href={rawResumeUrl}
              download={resumeFileName}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download original
            </a>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={() => window.close()}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
            Close
          </button>
        </div>
      </div>

      {/* Document area — iframe for previewable PDFs, a fallback panel for
          anything the browser can't render inline (docx/doc — would
          otherwise silently trigger a download the moment the iframe's src
          is set, see PREVIEWABLE_MIME_TYPES comment above). No loading state
          needed now — the mime type comes from a URL param, known instantly. */}
      {canPreview ? (
        <iframe
          key={docUrl}
          src={docUrl}
          className="flex-1 w-full border-0"
          title={activeDoc === "resume" ? "Resume" : crossRefLabel}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-200">Can&#x2019;t preview {resumeFileName} in the browser</p>
          <p className="max-w-xs text-xs text-zinc-500">
            This file type isn&#x2019;t previewable inline (PDF and Word documents are). Download it to view.
          </p>
          <a href={rawResumeUrl} download={resumeFileName}
            className="mt-1 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-zinc-900 transition-colors hover:bg-zinc-200">
            Download to view
          </a>
        </div>
      )}
    </div>
  );
}
