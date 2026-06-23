"use client";

import { useEffect, useRef, useState } from "react";
import type { CalibrationExample, CalibrationLabel } from "@/lib/types";

export function CalibrationPanel() {
  const [examples, setExamples] = useState<CalibrationExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState<CalibrationLabel>("good");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/calibration-examples");
      if (!response.ok) throw new Error("Failed to load calibration examples");
      const data = await response.json();
      setExamples(data.examples ?? []);
    } catch {
      setError("Couldn't load calibration examples.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(refresh, 0);
    return () => clearTimeout(timeout);
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.set("label", label);
    formData.set("note", note);
    formData.set("resume", file);

    try {
      const response = await fetch("/api/calibration-examples", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add example");
      }
      setFile(null);
      setNote("");
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
      const response = await fetch(`/api/calibration-examples/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
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
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="shrink-0 text-zinc-400 transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <div className="flex flex-col gap-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Upload resumes you&apos;ve marked acceptable or not acceptable for roles like this. Claude uses
          them to calibrate your bar — not as templates candidates must match.
        </p>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-zinc-400">Loading…</p>
        ) : examples.length === 0 ? (
          <p className="text-xs text-zinc-400">No calibration examples yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {examples.map((example) => (
              <li
                key={example.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-col gap-1 overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        example.label === "good"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"
                      }`}
                    >
                      {example.label === "good" ? "Acceptable" : "Not acceptable"}
                    </span>
                    <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                      {example.fileName}
                    </span>
                  </div>
                  {example.note && (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{example.note}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(example.id)}
                  disabled={deletingId === example.id}
                  aria-label={`Remove ${example.fileName}`}
                  className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-200 p-3 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value as CalibrationLabel)}
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              <option value="good">Acceptable</option>
              <option value="bad">Not acceptable</option>
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex-1 text-xs text-zinc-500 dark:text-zinc-400"
            />
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='Optional note (e.g. "too junior for this level")'
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || uploading}
            className="self-end rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {uploading ? "Adding…" : "Add example"}
          </button>
        </div>
      </div>
    </details>
  );
}
