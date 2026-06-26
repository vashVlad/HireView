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
      // Revert optimistic update on failure
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
              {/* Label + mode toggle */}
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
                /* File picked — show it with a remove button */
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-semibold uppercase text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                      {jdFile.name.split(".").pop()}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className