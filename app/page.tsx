"use client";

import { useState } from "react";
import { Chip } from "@/components/Chip";
import { CopyField } from "@/components/CopyField";
import { SiteHeader } from "@/components/SiteHeader";
import type { FilterConfig, JDAnalysis } from "@/lib/types";

type ViewState = "form" | "loading" | "results";
type SearchMode = "wide" | "narrow";

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
  const [view, setView] = useState<ViewState>("form");
  const [mode, setMode] = useState<SearchMode>("wide");
  const [analysis, setAnalysis] = useState<JDAnalysis | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = jobDescription.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setFormError(null);
    setView("loading");

    try {
      const response = await fetch("/api/analyze-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription }),
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
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/" />

      <main className={`mx-auto flex w-full flex-1 flex-col px-6 py-10 ${view === "results" ? "max-w-6xl" : "max-w-3xl"}`}>
        {view !== "results" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Decode the role
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Paste a job description and get LinkedIn Recruiter filters and Boolean search strings, ready to paste.
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
                rows={10}
                disabled={view === "loading"}
                className="w-full resize-none rounded-2xl border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
              />
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
                  Analyzing job description...
                </>
              ) : (
                "Analyze job description"
              )}
            </button>
          </div>
        )}

        {view === "results" && analysis && (
          <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Sourcing brief
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Copy these straight into LinkedIn Recruiter&apos;s filters
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="shrink-0 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                New analysis
              </button>
            </div>

            {/* Side-by-side on wide screens */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">

              {/* Left: Wide/Narrow toggle + Filters */}
              <div className="flex flex-col gap-5">
                {/* Wide / Narrow tab toggle */}
                <div className="flex items-center gap-1 rounded-2xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => setMode("wide")}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 transition-colors ${
                      mode === "wide"
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className={`text-sm font-semibold ${mode === "wide" ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"}`}>
                      Wide search
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">Discover the talent pool · 5k–15k+ results</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("narrow")}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 transition-colors ${
                      mode === "narrow"
                        ? "bg-violet-50 dark:bg-violet-500/10"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className={`text-sm font-semibold ${mode === "narrow" ? "text-violet-700 dark:text-violet-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                      Narrow search
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">Active outreach · 500–1k results</span>
                  </button>
                </div>

                {/* Filter set */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <FilterSetView config={mode === "wide" ? analysis.wide : analysis.narrow} />
                </div>

                {/* Why these terms */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Why these terms</span>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{analysis.rationale}</p>
                </div>
              </div>

              {/* Right: Skills summary */}
              <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 xl:self-start xl:sticky xl:top-6">
                <FilterSection title="Must-have skills" items={analysis.mustHaveSkills} />
                <FilterSection title="Nice-to-have skills" items={analysis.niceToHaveSkills} />
                <FilterSection title="All equivalent titles" items={analysis.jobTitles} />
                <FilterSection title="Job functions" items={analysis.jobFunctions} />
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  );
}
