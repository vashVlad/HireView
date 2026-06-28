"use client";

import { useRef, useState } from "react";
import type { CredibilityAssessment } from "@/lib/types";

interface CredibilityCheckerProps {
  screeningId: number;
  roleContext?: string;
  onComplete: (assessment: CredibilityAssessment) => void;
}

type CheckState = "idle" | "checking" | "error";

function FileSlot({
  label,
  badge,
  accept,
  file,
  onPick,
  onClear,
}: {
  label: string;
  badge?: string;
  accept: string;
  file: File | null;
  onPick: (files: FileList) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (file) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2">
          {badge && (
            <span className="shrink-0 rounded bg-blue-100 px-1.5 py-px text-[10px] font-bold text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              {badge}
            </span>
          )}
          <span className="truncate text-xs text-zinc-600 dark:text-zinc-400">{file.name}</span>
        </div>
        <button type="button" onClick={onClear} className="shrink-0 text-zinc-400 hover:text-rose-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files) onPick(e.dataTransfer.files); }}
      className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs transition-colors ${
        dragging
          ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
          : "border-zinc-200 hover:border-violet-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-violet-600 dark:hover:bg-zinc-800/50"
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files && onPick(e.target.files)} />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
        <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
    </label>
  );
}

export function CredibilityChecker({ screeningId, roleContext, onComplete }: CredibilityCheckerProps) {
  const [linkedInFile, setLinkedInFile] = useState<File | null>(null);
  const [secondResumeFile, setSecondResumeFile] = useState<File | null>(null);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [error, setError] = useState<string | null>(null);

  function pickLinkedIn(files: FileList) {
    const f = Array.from(files).find((f) => /\.pdf$/i.test(f.name));
    if (f) setLinkedInFile(f);
  }

  function pickSecondResume(files: FileList) {
    const f = Array.from(files).find((f) => /\.(pdf|docx)$/i.test(f.name));
    if (f) setSecondResumeFile(f);
  }

  const canRun = linkedInFile !== null || secondResumeFile !== null;

  async function runCheck() {
    if (!canRun || checkState === "checking") return;
    setCheckState("checking");
    setError(null);

    const formData = new FormData();
    formData.set("screeningId", String(screeningId));
    if (linkedInFile) formData.set("linkedInPdf", linkedInFile);
    if (secondResumeFile) formData.set("secondResume", secondResumeFile);
    if (roleContext) formData.set("roleContext", roleContext);

    try {
      const res = await fetch("/api/assess-credibility", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Credibility check failed");
      }
      const data = await res.json();
      onComplete(data.assessment as CredibilityAssessment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setCheckState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <FileSlot
        label="LinkedIn PDF (optional)"
        badge="LI"
        accept=".pdf"
        file={linkedInFile}
        onPick={pickLinkedIn}
        onClear={() => setLinkedInFile(null)}
      />
      <FileSlot
        label="Second resume — PDF or Word (optional)"
        accept=".pdf,.docx"
        file={secondResumeFile}
        onPick={pickSecondResume}
        onClear={() => setSecondResumeFile(null)}
      />

      {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={runCheck}
        disabled={!canRun || checkState === "checking"}
        className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {checkState === "checking" ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white dark:border-zinc-900/40 dark:border-t-zinc-900" />
            Checking…
          </>
        ) : (
          "Run credibility check"
        )}
      </button>
    </div>
  );
}
