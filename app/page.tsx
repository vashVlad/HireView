"use client";

import { useRef, useState } from "react";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ResultCard } from "@/components/ResultCard";
import { SiteHeader } from "@/components/SiteHeader";
import type { CandidateResult, CandidateStatus, ScreenResumesError } from "@/lib/types";

type ViewState = "form" | "loading" | "results";
type JDMode = "paste" | "upload";

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ScreenerPage() {
  const [jobDescription, setJobDescription] = useState("");
  const [jdMode, setJDMode] = useState<JDMode>("paste");
  const [jdFile, setJDFile] = useState<File | null>(null);
  const [jdDragging, setJDDragging] = useState(false);
  const jdFileRef = useRef<HTMLInputElement>(null);
  const [roleContext, setRoleContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [view, setView] = useState<ViewState>("form");
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [fileErrors, setFileErrors] = useState<ScreenResumesError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  function handleJDFile(incoming: FileList | File[]) {
    const file = Array.from(incoming).find((f) => /\.(pdf|docx|doc|txt)$/i.test(f.name));
    if (file) setJDFile(file);
  }

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
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status: r.status } : r)));
    }
  }

  const jdReady = jdMode === "paste" ? jobDescription.trim().length > 0 : jdFile !== null;
  const canSubmit = jdReady && files.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setFormError(null);
    setView("loading");

    const formData = new FormData();
    if (jdMode === "upload" && jdFile) {
      formData.set("jdFile", jdFile);
    } else {
      formData.set("jobDescription", jobDescription);
    }
    if (roleContext.trim()) formData.set("roleContext", roleContext.trim());
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
    setJDFile(null);
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/" />

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
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Job description</span>
                <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <button
                    type="button"
                    onClick={() => setJDMode("paste")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      jdMode === "paste"
                        ? "bg-white text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    Paste
                  </button>
                  <button
                    type="button"
                    onClick={() => setJDMode("upload")}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      jdMode === "upload"
                        ? "bg-white text-zinc-800 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    Upload file
                  </button>
                </div>
              </div>

              {jdMode === "paste" ? (
                <textarea
                  id="jd"
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description here..."
                  rows={8}
                  disabled={view === "loading"}
                  className="w-full resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
                />
              ) : jdFile ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-semibold uppercase text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                      {jdFile.name.split(".").pop()}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        {jdFile.name}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {formatFileSize(jdFile.size)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setJDFile(null)}
                    className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                    aria-label="Remove file"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => { e.preventDefault(); setJDDragging(true); }}
                  onDragLeave={() => setJDDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setJDDragging(false); handleJDFile(e.dataTransfer.files); }}
                  className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    jdDragging
                      ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
                      : "border-zinc-200 hover:border-violet-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-violet-600 dark:hover:bg-zinc-900"
                  }`}
                >
                  <input
                    ref={jdFileRef}
                    type="file"
                    accept=".pdf,.docx,.doc,.txt"
                    className="hidden"
                    onChange={(e) => e.target.files && handleJDFile(e.target.files)}
                  />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 transition-transform group-hover:scale-105 dark:bg-violet-500/10 dark:text-violet-400">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Drop the JD here, or click to browse
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">PDF, Word, or plain text</p>
                </label>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <label htmlFor="role-context" className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Role context <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
              </label>
              <input
                id="role-context"
                type="text"
                value={roleContext}
                onChange={(e) => setRoleContext(e.target.value)}
                placeholder="e.g. Forward Deployed Engineer — must have enterprise SaaS deployment experience"
                disabled={view === "loading"}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Extra context that helps Claude calibrate scoring and credibility checks for this specific role.
              </p>
            </section>

            <CalibrationPanel />

            <ResumeUploader files={files} onFilesChange={setFiles} />

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
                  Screening resumes…
                </>
              ) : (
                "Screen resumes"
              )}
            </button>
          </div>
        )}

        {view === "results" && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Screening results
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {results.length} candidate{results.length !== 1 ? "s" : ""} ranked by fit
                  {fileErrors.length > 0 && ` · ${fileErrors.length} file${fileErrors.length !== 1 ? "s" : ""} failed`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Screen again
              </button>
            </div>

            {fileErrors.length > 0 && (
              <ul className="flex flex-col gap-2">
                {fileErrors.map((err) => (
                  <li
                    key={err.fileName}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                  >
                    <span className="font-medium">{err.fileName}</span> — {err.error}
                  </li>
                ))}
              </ul>
            )}

            <ul className="list-none flex flex-col gap-4">
              {results.map((result, i) => (
                <ResultCard
                  key={result.fileName}
                  result={result}
                  rank={i + 1}
                  roleContext={roleContext || undefined}
                  onStatusChange={handleStatusChange}
                  solo
                />
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
