"use client";

import { useState } from "react";
import type { FilterConfig } from "@/lib/types";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={copy}
      className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
        copied
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
          : "bg-zinc-100 text-zinc-500 hover:bg-violet-50 hover:text-violet-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-violet-500/10 dark:hover:text-violet-400"
      }`}>
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function FilterBlock({ label, hint, children, copyValue }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  copyValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{label}</span>
          {hint && <span className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>}
        </div>
        {copyValue && <CopyButton value={copyValue} />}
      </div>
      {children}
    </div>
  );
}

export function FilterSetView({ config }: { config: FilterConfig }) {
  const workTypeDisplay = config.workplaceType.join(", ") || "—";
  const industriesDisplay = config.industries.join(", ") || "—";

  return (
    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {/* Keywords */}
      <div className="py-4 first:pt-0">
        <FilterBlock label="Keywords" copyValue={config.keywords}>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {config.keywords}
          </pre>
        </FilterBlock>
      </div>

      {/* Job Titles */}
      <div className="py-4">
        <FilterBlock
          label="Job Titles"
          hint={config.jobTitleToggle}
          copyValue={config.jobTitlesBoolean}
        >
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {config.jobTitlesBoolean}
          </pre>
        </FilterBlock>
      </div>

      {/* Location */}
      <div className="py-4">
        <FilterBlock
          label="Location"
          copyValue={config.location || undefined}
        >
          {config.location ? (
            <span className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {config.location}
            </span>
          ) : (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">Set your target metro area manually</span>
          )}
        </FilterBlock>
      </div>

      {/* Work Type */}
      <div className="py-4">
        <FilterBlock
          label="Work Type"
          copyValue={config.workplaceType.length > 0 ? workTypeDisplay : undefined}
        >
          {config.workplaceType.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {config.workplaceType.map((t) => (
                <span key={t} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">Not specified</span>
          )}
        </FilterBlock>
      </div>

      {/* Industry */}
      <div className="py-4 last:pb-0">
        <FilterBlock
          label="Industry"
          copyValue={config.industries.length > 0 ? industriesDisplay : undefined}
        >
          {config.industries.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {config.industries.map((i) => (
                <span key={i} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {i}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">Not specified</span>
          )}
        </FilterBlock>
      </div>
    </div>
  );
}
