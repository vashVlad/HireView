"use client";

import { useRef, useState } from "react";
import { CredibilitySection } from "@/components/CredibilitySection";
import type { CredibilityAssessment } from "@/lib/types";

interface CrossReferenceCheckerProps {
  screeningId: number;
  roleContext?: string;
  currentAssessment?: CredibilityAssessment;
  onComplete: (assessment: CredibilityAssessment) => void;
  /**
   * Pre-fills the cross-reference slot instead of requiring a manual pick —
   * used when the "document" to compare against is a file already in hand
   * (e.g. a fresh upload that matched an existing candidate by filename).
   * Still requires the recruiter to click "Run credibility check" themselves.
   */
  initialFile?: File | null;
  /**
   * Compare against another already-saved screening's stored resume instead
   * of an uploaded file — for candidate-vs-candidate comparisons where both
   * sides already exist in the DB (e.g. two screenings that share a filename).
   * Takes priority over initialFile/file: no upload needed, and nothing new
   * gets persisted to either screening's linkedInPdfPath (see
   * app/api/assess-credibility/route.ts) since there's no new external doc,
   * just an internal comparison.
   */
  crossRefScreeningId?: number;
  /** Display name for crossRefScreeningId, shown in place of the file slot. */
  crossRefLabel?: string;
}

type CheckState = "idle" | "checking" | "error";

/** Static equivalent of FileSlot's "has file" state, for a fixed crossRefScreeningId target — nothing to pick, so no drop zone or clear button. */
function CrossRefTargetChip({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <span className="shrink-0 rounded bg-violet-100 px-1.5 py-px text-[10px] font-bold text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
        XREF
      </span>
      <span className="truncate text-xs text-zinc-600 dark:text-zinc-400">
        Comparing against {label ?? "existing candidate"}&#x2019;s resume
      </span>
    </div>
  );
}

function FileSlot({
  file,
  onPick,
  onClear,
}: {
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
          <span className="shrink-0 rounded bg-violet-100 px-1.5 py-px text-[10px] font-bold text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
            XREF
          </span>
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
      <input ref={inputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files && onPick(e.target.files)} />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
        <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-zinc-500 dark:text-zinc-400">Cross-reference doc — LinkedIn PDF or second resume</span>
    </label>
  );
}

export function CrossReferenceChecker({ screeningId, roleContext, currentAssessment, onComplete, initialFile, crossRefScreeningId, crossRefLabel }: CrossReferenceCheckerProps) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [error, setError] = useState<string | null>(null);

  const hasCrossRefTarget = crossRefScreeningId !== undefined || file !== null;

  function pickFile(files: FileList) {
    // Was `/\.(pdf|docx)$/i` — silently dropped .doc files (drag-and-drop
    // bypasses the input's `accept` attribute entirely, so this regex was
    // the only real gate) even though the picker itself already allows
    // .doc. Matches the file-slot input's accept=".pdf,.doc,.docx" now.
    const f = Array.from(files).find((f) => /\.(pdf|docx?)$/i.test(f.name));
    if (f) {
      setFile(f);
      setError(null);
    } else if (files.length > 0) {
      setError("Only PDF and Word (.doc/.docx) files are supported.");
    }
  }

  async function runCheck() {
    if (!hasCrossRefTarget || checkState === "checking") return;
    setCheckState("checking");
    setError(null);

    const formData = new FormData();
    formData.set("screeningId", String(screeningId));
    // A manually-picked file (including via the "re-run with a different
    // document" area) always wins over the fixed crossRefScreeningId target —
    // once the recruiter has actively chosen something to compare against,
    // that choice should be respected on re-run, not silently ignored.
    if (file) {
      formData.set("crossRefDoc", file);
    } else if (crossRefScreeningId !== undefined) {
      formData.set("crossRefScreeningId", String(crossRefScreeningId));
    }
    if (roleContext) formData.set("roleContext", roleContext);

    try {
      const res = await fetch("/api/assess-credibility", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Credibility check failed");
      }
      const data = await res.json();
      setFile(null);
      setCheckState("idle");
      onComplete(data.assessment as CredibilityAssessment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setCheckState("error");
    }
  }

  // ── Existing result — show it with a re-run area below ────────────────────
  if (currentAssessment) {
    return (
      <div className="flex flex-col gap-3">
        <div className="relative">
          <CredibilitySection assessment={currentAssessment} showSummary={false} />
          {checkState === "checking" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70">
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
                Re-checking…
              </div>
            </div>
          )}
        </div>

        {/* Re-run area */}
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-800/30">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Re-run with a different document
          </p>
          {!file && crossRefScreeningId !== undefined ? (
            <CrossRefTargetChip label={crossRefLabel} />
          ) : (
            <FileSlot file={file} onPick={pickFile} onClear={() => setFile(null)} />
          )}
          {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={runCheck}
            disabled={!hasCrossRefTarget || checkState === "checking"}
            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {checkState === "checking" ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white dark:border-zinc-900/40 dark:border-t-zinc-900" />
                Checking…
              </>
            ) : (
              "Re-run check"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ── No result yet — just show the uploader ────────────────────────────────
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      {!file && crossRefScreeningId !== undefined ? (
        <CrossRefTargetChip label={crossRefLabel} />
      ) : (
        <FileSlot file={file} onPick={pickFile} onClear={() => setFile(null)} />
      )}
      {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
      <button
        type="button"
        onClick={runCheck}
        disabled={!hasCrossRefTarget || checkState === "checking"}
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

// Legacy export alias for any remaining references
export { CrossReferenceChecker as CredibilityChecker };