"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { ComparisonRecord, ComparisonVerdict, ScreeningRecord } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VerdictBadge({ verdict }: { verdict: ComparisonVerdict }) {
  const config: Record<ComparisonVerdict, { label: string; className: string }> = {
    consistent: {
      label: "Consistent",
      className:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
    },
    minor_tweaks: {
      label: "Minor tweaks",
      className:
        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30",
    },
    significant_reframe: {
      label: "Significant reframe",
      className:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30",
    },
    suspicious: {
      label: "Suspicious",
      className:
        "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30",
    },
  };
  const { label, className } = config[verdict];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${className}`}
    >
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

function ComparisonCard({ record }: { record: ComparisonRecord }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {record.newResumeFilename}
            </span>
          </div>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {record.newResumeRole && `${record.newResumeRole} · `}
            {formatDate(record.createdAt)}
          </span>
        </div>
        <VerdictBadge verdict={record.verdict} />
      </div>

      {/* Summary */}
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{record.summary}</p>

      {/* Red flags */}
      {record.redFlags.length > 0 && (
        <ul className="flex flex-col gap-2">
          {record.redFlags.map((flag, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
            >
              <svg
                className="mt-0.5 h-4 w-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {flag}
            </li>
          ))}
        </ul>
      )}

      {/* Changes table */}
      {record.changes.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-[14px_1fr_1fr_1fr] gap-x-3 border-b border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/80">
              <span />
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Field
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Resume A
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Resume B
              </span>
            </div>
            {record.changes.map((change, i) => (
              <div
                key={i}
                className={`grid grid-cols-[14px_1fr_1fr_1fr] gap-x-3 px-3 py-2.5 text-sm ${
                  i < record.changes.length - 1
                    ? "border-b border-zinc-100 dark:border-zinc-800"
                    : ""
                } ${
                  change.severity === "red_flag"
                    ? "bg-rose-50/50 dark:bg-rose-500/5"
                    : "bg-white dark:bg-zinc-900"
                }`}
              >
                <SeverityDot severity={change.severity} />
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{change.field}</span>
                <span className="text-zinc-600 dark:text-zinc-300">{change.inResumeA}</span>
                <span className="text-zinc-600 dark:text-zinc-300">{change.inResumeB}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-400 dark:text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              Minor
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Notable
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Red flag
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function HubPageInner() {
  const params = useParams();
  const router = useRouter();
  const screeningId = Number(params.screeningId);

  const [screening, setScreening] = useState<ScreeningRecord | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonRecord[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Upload form state
  const [showForm, setShowForm] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [role, setRole] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [comparing, setComparing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isNaN(screeningId)) {
      setPageError("Invalid screening ID.");
      setPageLoading(false);
      return;
    }
    Promise.all([
      fetch(`/api/history/${screeningId}`).then((r) =>
        r.ok ? r.json() : Promise.reject("Screening not found.")
      ),
      fetch(`/api/compare-resumes?screeningId=${screeningId}`).then((r) =>
        r.ok ? r.json() : Promise.reject("Could not load comparisons.")
      ),
    ])
      .then(([screeningJson, comparisonsJson]) => {
        setScreening(screeningJson.screening);
        setComparisons(comparisonsJson.comparisons ?? []);
      })
      .catch((err) => setPageError(typeof err === "string" ? err : "Failed to load."))
      .finally(() => setPageLoading(false));
  }, [screeningId]);

  function handleFile(incoming: FileList | File[]) {
    const file = Array.from(incoming).find((f) => /\.(pdf|docx|doc)$/i.test(f.name));
    if (file) setNewFile(file);
  }

  function openForm(prefillRole?: string) {
    setShowForm(true);
    if (prefillRole) setRole(prefillRole);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function handleCompare() {
    if (!newFile) return;
    setFormError(null);
    setComparing(true);

    const formData = new FormData();
    formData.set("id", String(screeningId));
    formData.set("file", newFile);
    if (role.trim()) formData.set("role", role.trim());

    try {
      const res = await fetch("/api/compare-resumes", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Comparison failed.");
      }
      const json = await res.json();
      // Prepend the new comparison to the top of the list
      setComparisons((prev) => [json.comparison ?? json, ...prev]);
      // Try to add the structured record from DB instead
      const newRecord: ComparisonRecord = {
        id: json.comparisonId,
        screeningId,
        newResumeFilename: newFile.name,
        newResumeRole: role.trim() || null,
        verdict: json.comparison.verdict,
        summary: json.comparison.summary,
        changes: json.comparison.changes,
        redFlags: json.comparison.redFlags,
        createdAt: new Date().toISOString(),
      };
      setComparisons((prev) => [newRecord, ...prev.slice(1)]);
      setShowForm(false);
      setNewFile(null);
      setRole("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setComparing(false);
    }
  }

  if (pageLoading) {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
        <SiteHeader active="/history" />
        <main className="flex flex-1 items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
        </main>
      </div>
    );
  }

  if (pageError || !screening) {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
        <SiteHeader active="/history" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-20">
          <p className="text-sm text-zinc-500">{pageError ?? "Screening not found."}</p>
          <button
            type="button"
            onClick={() => router.push("/history")}
            className="text-sm text-violet-600 hover:underline dark:text-violet-400"
          >
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
          onClick={() => router.push("/history")}
          className="mb-6 flex w-fit items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5m0 0 7 7m-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to history
        </button>

        <div className="flex flex-col gap-8">
          {/* Candidate header */}
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {screening.candidateName}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Resume comparisons · {comparisons.length}{" "}
                  {comparisons.length === 1 ? "comparison" : "comparisons"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openForm()}
                className="shrink-0 flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                New comparison
              </button>
            </div>

            {/* Screening card */}
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <ScoreBadge score={screening.score} />
              <div className="flex flex-col overflow-hidden">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">
                  {screening.fileName}
                </span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  Screened {formatDate(screening.createdAt)} · Resume A (baseline)
                </span>
              </div>
            </div>
          </div>

          {/* Upload form */}
          {showForm && (
            <div
              ref={formRef}
              className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-5 dark:border-violet-500/20 dark:bg-violet-500/5"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  New resume to compare
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setNewFile(null);
                    setRole("");
                    setFormError(null);
                  }}
                  className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {newFile ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-semibold uppercase text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                      {newFile.name.split(".").pop()}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        {newFile.name}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {formatFileSize(newFile.size)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewFile(null)}
                    className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    handleFile(e.dataTransfer.files);
                  }}
                  className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                    isDragging
                      ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
                      : "border-zinc-200 bg-white hover:border-violet-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-violet-600"
                  }`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.doc"
                    className="hidden"
                    onChange={(e) => e.target.files && handleFile(e.target.files)}
                  />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Drop resume here, or click to browse
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">PDF or Word</p>
                </label>
              )}

              {newFile && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    What role is this resume for?{" "}
                    <span className="font-normal text-zinc-400">(optional)</span>
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

              {formError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                  {formError}
                </div>
              )}

              <button
                type="button"
                onClick={handleCompare}
                disabled={!newFile || comparing}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {comparing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Comparing…
                  </>
                ) : (
                  "Compare resumes"
                )}
              </button>
            </div>
          )}

          {/* Comparisons list */}
          {comparisons.length === 0 && !showForm ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-200 py-16 dark:border-zinc-800">
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No comparisons yet.</p>
              <button
                type="button"
                onClick={() => openForm()}
                className="text-sm font-medium text-violet-600 hover:underline dark:text-violet-400"
              >
                Run first comparison
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {comparisons.length > 0 && (
                <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  Past comparisons
                </h3>
              )}
              {comparisons.map((record) => (
                <div key={record.id} className="flex flex-col gap-2">
                  <ComparisonCard record={record} />
                  <button
                    type="button"
                    onClick={() => openForm(record.newResumeRole ?? undefined)}
                    className="w-fit self-end text-xs text-zinc-400 transition-colors hover:text-violet-600 dark:text-zinc-500 dark:hover:text-violet-400"
                  >
                    Compare again with this role
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function CompareHubPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-20">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
        </div>
      }
    >
      <HubPageInner />
    </Suspense>
  );
}
