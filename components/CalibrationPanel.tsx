"use client";

import { useEffect, useRef, useState } from "react";
import type { CalibrationExample } from "@/lib/types";

export function CalibrationPanel({ projectId }: { projectId?: number }) {
  const [examples, setExamples] = useState<CalibrationExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const url = projectId != null
        ? `/api/calibration-examples?projectId=${projectId}`
        : "/api/calibration-examples";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setExamples(Array.isArray(data.examples) ? data.examples : []);
    } catch {
      setError("Couldn't load calibration examples.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleFileChange(file: File) {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("label", "good");
    formData.set("resume", file);
    if (projectId != null) formData.set("projectId", String(projectId));
    try {
      const res = await fetch("/api/calibration-examples", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add example");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add example");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/calibration-examples/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setExamples((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError("Couldn't delete that example.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white open:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:open:bg-zinc-900/60">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        <span>
          Calibration examples
          {examples.length > 0 && (
            <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {examples.length}
            </span>
          )}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <div className="flex flex-col gap-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Upload resumes you&apos;d consider acceptable for this type of role. Claude uses them to calibrate
          your bar &mdash; not as templates candidates must match.
        </p>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </div>
        )}

        {!loading && examples.length > 0 && (
          <ul className="flex flex-col gap-2">
            {examples.map((example) => (
              <li key={example.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="truncate text-sm text-zinc-700 dark:text-zinc-200">{example.fileName}</span>
                <button type="button" onClick={() => handleDelete(example.id)}
                  disabled={deletingId === example.id}
                  aria-label={`Remove ${example.fileName}`}
                  className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3.5 text-sm font-medium transition-colors
          ${uploading
            ? "border-violet-200 bg-violet-50/40 text-violet-400 dark:border-violet-700/40 dark:bg-violet-500/5 dark:text-violet-500"
            : "border-violet-300 bg-violet-50/60 text-violet-600 hover:border-violet-400 hover:bg-violet-50 dark:border-violet-600/50 dark:bg-violet-500/5 dark:text-violet-400 dark:hover:bg-violet-500/10"
          }`}>
          {uploading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
              Uploading&hellip;
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
              </svg>
              Choose file
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
          />
        </label>
      </div>
    </details>
  );
}
