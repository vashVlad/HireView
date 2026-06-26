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
      <SiteHeader active="/jd-analyzer" />

      <main className={`mx-auto flex w-full flex-1 flex-col px-6 py-10 ${view === "results" ? "max-w-6xl" : "max-w-3xl"}`}>
        {view !== "results" && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Decode the role
              </h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Paste a job description and get LinkedIn Recruiter filte