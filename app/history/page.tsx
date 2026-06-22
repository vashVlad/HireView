"use client";

import { useEffect, useState } from "react";
import { Chip } from "@/components/Chip";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import type { ScreeningRecord } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function HistoryPage() {
  const [query, setQuery] = useState("");
  const [screenings, setScreenings] = useState<ScreeningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
        const response = await fetch(`/api/history${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Failed to load history");
        const data = await response.json();
        setScreenings(data.screenings ?? []);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/history" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Candidate history
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Look up anyone you&apos;ve screened before — their score, summary, and resume.
            </p>
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by candidate name..."
            className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-violet-500/20"
          />

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              {error}
            </div>
          )}

          {!loading && screenings.length === 0 && !error && (
            <p className="rounded-2xl border border-dashed border-zinc-200 px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800">
              {query.trim() ? "No candidates match that name." : "No screenings yet — run the resume screener to build history."}
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {screenings.map((screening) => {
              const expanded = expandedId === screening.id;
              return (
                <li
                  key={screening.id}
                  className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : screening.id)}
                    className="flex w-full items-center gap-4 p-5 text-left"
                  >
                    <ScoreBadge score={screening.score} />
                    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {screening.candidateName}
                      </span>
                      <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                        {screening.fileName} · {formatDate(screening.createdAt)}
                      </span>
                    </div>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {expanded && (
                    <div className="flex flex-col gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
                      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {screening.summary}
                      </p>

                      {(screening.strengths.length > 0 || screening.concerns.length > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                          {screening.strengths.map((strength) => (
                            <Chip key={strength} variant="positive">
                              {strength}
                            </Chip>
                          ))}
                          {screening.concerns.map((concern) => (
                            <Chip key={concern} variant="warning">
                              {concern}
                            </Chip>
                          ))}
                        </div>
                      )}

                      <details className="text-sm text-zinc-600 dark:text-zinc-300">
                        <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-200">
                          Job description used
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                          {screening.jobDescription}
                        </p>
                      </details>

                      <a
                        href={`/api/history/${screening.id}/resume`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-violet-50 px-3.5 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 4v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        View resume
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}
