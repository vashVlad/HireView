"use client";

import { useState } from "react";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ResultCard } from "@/components/ResultCard";
import { SiteHeader } from "@/components/SiteHeader";
import type { CandidateResult, CandidateStatus, ScreenResumesError } from "@/lib/types";

type ViewState = "form" | "loading" | "results";

export default function ScreenerPage() {
  const [jobDescription, setJobDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [view, setView] = useState<ViewState>("form");
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [fileErrors, setFileErrors] = useState<ScreenResumesError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleStatusChange(id: number, status: CandidateStatus) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const response = await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update status");
    } catch {
      // Revert optimistic update on failure
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status: r.status } : r)));
    }
  }

  const canSubmit = jobDescription.trim().length > 0 && files.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setFormError(null);
    setView("loading");

    const formData = new FormData();
    formData.set("jobDescription", jobDescription);
    files.forEach((file) => formData.append("resumes", file));

    try {
      const response = await fetch("/api/screen-resumes", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Something went wrong while screening resumes.");
      }

      const data = await response.json();
      const newResults: CandidateResult[] = Array.isArray(data.results) ? data.results : [];
      const newErrors: ScreenResumesError[] = Array.isArray(data.errors) ? data.errors : [];
      setResults(newResults);
      setFileErrors(newErrors);
      setView("results");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unknown error");
      setView("form");
    }
  }

  function handleReset() {
    setView("form");
    setResults([]);
    setFileErrors([]);
    setFiles([]);
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/screener" />

      <main className={`mx-auto flex w-full flex-1 flex-col px-6 py-10 ${view === "results" ? "max-w-6xl" : "max-w-3xl"}`}>
        {view !== "results" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Screen your candidates
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Paste the job description, upload resumes, and let Claude rank your candidates.
              </p>
            </div>

            <section className="flex flex-col gap-2">
              <label htmlFor="jd" className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Job description
              </label>
              <textarea
                id="jd"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the full job description here..."
                rows={8}
                disabled={view === "loading"}
                className="w-full resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
              />
            </section>

            <section className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Resumes</span>
              <ResumeUploader files={files} onFilesChange={setFiles} />
            </section>

            <CalibrationPanel />

            {formError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                {formError}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || view === "loading"}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {view === "loading" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Screening {files.length} resume{files.length === 1 ? "" : "s"}...
                </>
              ) : (
                <>Screen {files.length > 0 ? `${files.length} ` : ""}resume{files.length === 1 ? "" : "s"}</>
              )}
            </button>
          </div>
        )}

        {view === "results" && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Ranked candidates
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {results.length} candidate{results.length === 1 ? "" : "s"} scored against your job description
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="shrink-0 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                New screening
              </button>
            </div>

            {fileErrors.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                <span className="font-medium">
                  Couldn&apos;t process {fileErrors.length} file{fileErrors.length === 1 ? "" : "s"}:
                </span>
                {fileErrors.map((e) => (
                  <span key={e.fileName}>
                    <span className="font-medium">{e.fileName}</span> — {e.error}
                  </span>
                ))}
              </div>
            )}

            {results.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-200 px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800">
                No candidates could be scored. Try uploading different files.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {results.map((result, index) => (
                  <ResultCard
                    key={result.fileName}
                    result={result}
                    rank={index + 1}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
