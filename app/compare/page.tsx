"use client";

export const dynamic = "force-dynamic";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { ResumeComparisonResult, ComparisonVerdict } from "@/lib/types";

interface ResumeInfo {
  id: number | null;
  candidateName: string;
  fileName: string;
  score: number | null;
  jobTitle: string;
  createdAt: string;
  source: "history" | "upload";
}

interface CompareResponse {
  resumes: ResumeInfo[];
  comparison: ResumeComparisonResult;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VerdictBadge({ verdict }: { verdict: ComparisonVerdict }) {
  const config: Record<ComparisonVerdict, { label: string; className: string }> = {
    consistent: {
      label: "Consistent",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
    },
    minor_tweaks: {
      label: "Minor tweaks",
      className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30",
    },
    significant_reframe: {
      label: "Significant reframe",
      className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30",
    },
    suspicious: {
      label: "Suspicious",
      className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30",
    },
  };
  const { label, className } = config[verdict];
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${className}`}>
      {label}
    </span>
  );
}

function SeverityDot({ severity }: { severity: "minor" | "notable" | "red_flag" }) {
  const colors = {
    minor: "bg-zinc-300 dark:bg-zinc-600",
    notable: "bg-amber-400 dark:bg-amber-500",
    red_flag: "bg-rose-500 dark:bg-rose-400",
  };
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colors[severity]}`} />;
}

export default function ComparePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const existingId = Number(searchParams.get("id"));
  const existingName = searchParams.get("name") ?? "Candidate";
  const existingFile = searchParams.get("file") ?? "";
  const existingScore = Number(searchParams.get("score") ?? "0");

  const [newFile, setNewFile] = useState<File | null>(null);
  const [role, setRole] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CompareResponse | null>(null);

  function handleFile(incoming: FileList | File[]) {
    const file = Array.from(incoming).find((f) => /\.(pdf|docx|doc)$/i.test(f.name));
    if (file) setNewFile(file);
  }

  async function handleCompare() {
    if (!newFile || !existingId) return;
    setError(null);
    setLoading(true);

    const formData = new FormData();
    formData.set("id", String(existingId));
    formData.set("file", newFile);
    if (role.trim()) formData.set("role", role.trim());

    try {
      const res = await fetch("/api/compare-resumes", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Comparison failed.");
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (!existingId || isNaN(existingId)) {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
        <SiteHeader active="/history" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-20">
          <p className="text-sm text-zinc-500">Open this page from a candidate&apos;s history card.</p>
          <button type="button" onClick={() => router.push("/history")} className="mt-4 text-sm text-violet-600 hover:underline dark:text-violet-400">
            Go to history
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/history" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-6 flex w-fit items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5m0 0 7 7m-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to history
        </button>

        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Compare resumes
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Upload {existingName}&apos;s new resume to compare it against the one on file.
            </p>
          </div>

          {/* Existing resume */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Resume on file</span>
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <ScoreBadge score={existingScore} />
              <div className="flex flex-col overflow-hidden">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">{existingName}</span>
                <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">{existingFile}</span>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                Resume A
              </span>
            </div>
          </div>

          {/* New resume upload */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">New resume to compare</span>
            {newFile ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-semibold uppercase text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                    {newFile.name.split(".").pop()}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{newFile.name}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatFileSize(newFile.size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    Resume B
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewFile(null)}
                    className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                    aria-label="Remove file"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files); }}
                className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                  isDragging
                    ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
                    : "border-zinc-200 hover:border-violet-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-violet-600 dark:hover:bg-zinc-900"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFile(e.target.files)}
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 transition-transform group-hover:scale-105 dark:bg-violet-500/10 dark:text-violet-400">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Drop the new resume here, or click to browse</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">PDF or Word</p>
              </label>
            )}
          </div>

          {/* Optional: what role is the new resume for */}
          {newFile && !data && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                What role is this resume for? <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. Senior Account Executive at Salesforce"
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </div>
          )}

          {!data && (
            <button
              type="button"
              onClick={handleCompare}
              disabled={!newFile || loading}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Comparing resumes…
                </>
              ) : (
                "Compare resumes"
              )}
            </button>
          )}

          {/* ── Results ─────────────────────────────────────────────────── */}
          {data && (
            <div className="flex flex-col gap-8 border-t border-zinc-100 pt-8 dark:border-zinc-800">
              {/* Verdict + summary */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Result</h3>
                  <VerdictBadge verdict={data.comparison.verdict} />
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {data.comparison.summary}
                </p>
              </div>

              {/* Red flags */}
              {data.comparison.redFlags.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Red flags</h3>
                  <ul className="flex flex-col gap-2">
                    {data.comparison.redFlags.map((flag, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                      >
                        <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {flag}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Changes table */}
              {data.comparison.changes.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Changes found</h3>
                  <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                    <div className="grid grid-cols-[16px_1fr_1fr_1fr] gap-x-4 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/80">
                      <span />
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Field</span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Resume A (on file)</span>
                      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Resume B (new)</span>
                    </div>
                    {data.comparison.changes.map((change, i) => (
                      <div
                        key={i}
                        className={`grid grid-cols-[16px_1fr_1fr_1fr] gap-x-4 px-4 py-3 text-sm ${
                          i < data.comparison.changes.length - 1 ? "border-b border-zinc-100 dark:border-zinc-800" : ""
                        } ${change.severity === "red_flag" ? "bg-rose-50/50 dark:bg-rose-500/5" : "bg-white dark:bg-zinc-900"}`}
                      >
                        <SeverityDot severity={change.severity} />
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">{change.field}</span>
                        <span className="text-zinc-600 dark:text-zinc-300">{change.inResumeA}</span>
                        <span className="text-zinc-600 dark:text-zinc-300">{change.inResumeB}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-400 dark:text-zinc-500">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />Minor</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Notable</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Red flag</span>
                  </div>
                </section>
              )}

              {/* Interview questions */}
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Interview questions</h3>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                    Designed to surface discrepancies without revealing you&apos;ve seen both resumes.
                  </p>
                </div>
                <ol className="flex flex-col gap-3">
                  {data.comparison.questions.map((q, i) => (
                    <li
                      key={i}
                      className="flex flex-col gap-1.5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                          {i + 1}
                        </span>
                        <p className="text-sm font-medium leading-relaxed text-zinc-800 dark:text-zinc-100">{q.question}</p>
                      </div>
                      <p className="ml-8 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                        Probes: {q.probes}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>

              <button
                type="button"
                onClick={() => { setData(null); setNewFile(null); setRole(""); }}
                className="w-fit rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Compare again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
