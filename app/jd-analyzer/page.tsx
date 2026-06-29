"use client";

import { useRef, useState } from "react";
import { Chip } from "@/components/Chip";
import { CopyField } from "@/components/CopyField";
import { SiteHeader } from "@/components/SiteHeader";
import type { FilterConfig, JDAnalysis } from "@/lib/types";

type ViewState = "form" | "loading" | "results";
type SearchMode = "wide" | "narrow";
type JDMode = "paste" | "upload";

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function OperatorBadge({ isMustHave }: { isMustHave: boolean }) {
  if (isMustHave) {
    return (
      <span className="shrink-0 rounded-full bg-violet-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
        Must have
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      Can have
    </span>
  );
}

function FilterRow({
  label,
  isMustHave,
  children,
}: {
  label: string;
  isMustHave: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{label}</span>
        <OperatorBadge isMustHave={isMustHave} />
      </div>
      {children}
    </div>
  );
}

function FilterSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Chip key={item}>{item}</Chip>
        ))}
      </div>
    </div>
  );
}

function FilterSetView({ config }: { config: FilterConfig }) {
  const must = new Set(config.mustHaveFilters);

  return (
    <div className="flex flex-col gap-5">
      {/* Job Titles */}
      <FilterRow label="Job Titles" isMustHave={must.has("Job Titles")}>
        <CopyField label="" value={config.jobTitlesBoolean} />
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Toggle: <span className="font-medium text-zinc-600 dark:text-zinc-300">{config.jobTitleToggle}</span>
        </p>
      </FilterRow>

      {/* Location */}
      {config.location ? (
        <FilterRow label="Location" isMustHave={must.has("Location")}>
          <Chip>{config.location}</Chip>
        </FilterRow>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Location</span>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
              Set manually
            </span>
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Not determinable from JD — set your target metro area in LinkedIn Recruiter</p>
        </div>
      )}

      {/* Workplace Type */}
      {config.workplaceType.length > 0 && (
        <FilterRow label="Workplace Type" isMustHave={must.has("Workplace Type")}>
          <div className="flex flex-wrap gap-1.5">
            {config.workplaceType.map((t) => <Chip key={t}>{t}</Chip>)}
          </div>
        </FilterRow>
      )}

      {/* Keywords */}
      <FilterRow label="Keywords (Boolean)" isMustHave={must.has("Keywords")}>
        <CopyField label="" value={config.keywords} />
      </FilterRow>

      {/* Seniority + Experience row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Seniority</span>
            <OperatorBadge isMustHave={must.has("Seniority")} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {config.seniority.map((s) => <Chip key={s}>{s}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Yrs experience</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{config.yearsExperience}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Yrs in position</span>
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{config.yearsInCurrentPosition}</span>
        </div>
      </div>

      {/* Yrs in company */}
      {config.yearsInCurrentCompany && config.yearsInCurrentCompany !== "any" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Yrs at current company <span className="text-xs font-normal text-zinc-400">(Corporate)</span></span>
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{config.yearsInCurrentCompany}</span>
        </div>
      )}

      {/* Target Companies */}
      {config.targetCompanies.length > 0 && (
        <FilterRow label="Target / competitor companies" isMustHave={must.has("Companies")}>
          <div className="flex flex-wrap gap-1.5">
            {config.targetCompanies.map((c) => <Chip key={c}>{c}</Chip>)}
          </div>
        </FilterRow>
      )}

      {/* Company Size + Industries row */}
      <div className="grid grid-cols-2 gap-4">
        {config.companySize.length > 0 && (
          <FilterSection title="Company Size" items={config.companySize} />
        )}
        {config.industries.length > 0 && (
          <FilterSection title="Industries" items={config.industries} />
        )}
      </div>

      {/* Spotlights */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Spotlights</span>
        {config.spotlights.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {config.spotlights.map((s) => (
              <Chip key={s} variant="positive">✓ {s}</Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">None — don&apos;t restrict by engagement signal</p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [jdMode, setJDMode] = useState<JDMode>("paste");
  const [jdFile, setJDFile] = useState<File | null>(null);
  const [jdDragging, setJDDragging] = useState(false);
  const jdFileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ViewState>("form");
  const [mode, setMode] = useState<SearchMode>("wide");
  const [analysis, setAnalysis] = useState<JDAnalysis | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function handleJDFile(incoming: FileList | File[]) {
    const file = Array.from(incoming).find((f) => /\.(pdf|docx|doc|txt)$/i.test(f.name));
    if (file) setJDFile(file);
  }

  const jdReady = jdMode === "paste" ? jobDescription.trim().length > 0 : jdFile !== null;
  const canSubmit = jdReady;

  async function handleSubmit() {
    if (!canSubmit) return;
    setFormError(null);
    setView("loading");

    let jdText = jobDescription;

    if (jdMode === "upload" && jdFile) {
      try {
        const formData = new FormData();
        formData.append("file", jdFile);
        const res = await fetch("/api/parse-jd", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to parse file");
        jdText = data.text;
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to read file");
        setView("form");
        return;
      }
    }

    try {
      const response = await fetch("/api/analyze-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: jdText }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Something went wrong while analyzing the job description.");
      }

      const data = await response.json();
      setAnalysis(data.analysis);
      setMode("wide");
      setView("results");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unknown error");
      setView("form");
    }
  }

  function handleReset() {
    setView("form");
    setAnalysis(null);
    setJDFile(null);
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/jd-analyzer" />

      <main className={`mx-auto flex w-full flex-1 flex-col px-6 py-10 ${view === "results" ? "max-w-6xl" : "max-w-3xl"}`}>
        {view !== "results" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Decode the role
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Paste a job description and get LinkedIn Recruiter filters and boolean strings ready to go.
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
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description here..."
                  rows={12}
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
                  Analyzing…
                </>
              ) : (
                "Analyze job description"
              )}
            </button>
          </div>
        )}

        {view === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Analyzing job description…</p>
          </div>
        )}

        {view === "results" && analysis && (
          <div className="flex flex-col gap-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  LinkedIn Recruiter filters
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{analysis.rationale}</p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="shrink-0 flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Analyze again
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Key skills extracted</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Must-have</span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.mustHaveSkills.map((s) => (
                      <Chip key={s} variant="positive">{s}</Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Nice-to-have</span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.niceToHaveSkills.map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FilterSection title="Equivalent titles" items={analysis.jobTitles} />
              <FilterSection title="Job functions" items={analysis.jobFunctions} />
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-1 self-start rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
                {(["wide", "narrow"] as SearchMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                      mode === m
                        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <FilterSetView config={mode === "wide" ? analysis.wide : analysis.narrow} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}