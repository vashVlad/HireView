"use client";

import { use, useEffect, useState } from "react";

export default function InterviewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeDoc, setActiveDoc] = useState<"resume" | "linkedin">("resume");
  const [hasLinkedIn, setHasLinkedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch(`/api/history/${id}/linkedin`, { method: "HEAD" })
      .then((r) => setHasLinkedIn(r.ok))
      .catch(() => setHasLinkedIn(false))
      .finally(() => setChecking(false));
  }, [id]);

  const docUrl = activeDoc === "resume"
    ? `/api/history/${id}/resume`
    : `/api/history/${id}/linkedin`;

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
            title={!hasLinkedIn && !checking ? "Run a credibility check first to store the LinkedIn PDF" : undefined}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              activeDoc === "linkedin"
                ? "bg-[#0077B5] text-white shadow"
                : hasLinkedIn
                ? "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                : "cursor-not-allowed bg-zinc-900 text-zinc-700"
            }`}
          >
            {/* LinkedIn icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
            LinkedIn
            {!hasLinkedIn && !checking && (
              <span className="ml-1 text-[10px] font-normal text-zinc-600">(not stored)</span>
            )}
          </button>
        </div>

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

      {/* PDF frame */}
      <iframe
        key={docUrl}
        src={docUrl}
        className="flex-1 w-full border-0"
        title={activeDoc === "resume" ? "Resume" : "LinkedIn PDF"}
      />
    </div>
  );
}
