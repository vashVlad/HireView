"use client";

import { useEffect, useState } from "react";
import { InsightList } from "@/components/InsightList";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusSelect } from "@/components/StatusSelect";
import { CANDIDATE_STATUSES, CANDIDATE_STATUS_LABELS, type CandidateStatus, type ScreeningRecord } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStatusDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function HistoryPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | null>(null);
  const [screenings, setScreenings] = useState<ScreeningRecord[]>([]);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<CandidateStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function toggleStatusFilter(status: CandidateStatus) {
    setStatusFilter((prev) => (prev === status ? null : status));
  }

  async function handleStatusChange(id: number, status: CandidateStatus) {
    const previous = screenings;
    const now = new Date().toISOString();
    setScreenings((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, status, statusUpdatedAt: now } : s))
        .filter((s) => statusFilter === null || s.status === statusFilter)
    );
    try {
      const response = await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update status");
    } catch {
      setScreenings(previous);
      setError("Couldn't update that candidate's status — try again.");
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      setScreenings((prev) => prev.filter((s) => s.id !== id));
      setExpandedId((current) => (current === id ? null : current));
    } catch {
      setError("Couldn't delete that record — try again.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (statusFilter) params.set("status", statusFilter);
        const search = params.toString();
        const response = await fetch(`/api/history${search ? `?${search}` : ""}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Failed to load history");
        const data = await response.json();
        setScreenings(data.screenings ?? []);
        setStatusCounts(data.statusCounts ?? {});
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
  }, [query, statusFilter]);

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

          <div className="flex flex-wrap items-center gap-2">
            {CANDIDATE_STATUSES.map((status) => {
              const active = statusFilter === status;
              const count = statusCounts[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatusFilter(status)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-500/10 dark:text-violet-400"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  {CANDIDATE_STATUS_LABELS[status]}
                  {count !== undefined && count > 0 && (
                    <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${
                      active
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

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
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedId(expanded ? null : screening.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setExpandedId(expanded ? null : screening.id);
                      }
                    }}
                    className="flex w-full cursor-pointer items-center gap-4 p-5 text-left"
                  >
                    <ScoreBadge score={screening.score} />
                    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {screening.candidateName}
                      </span>
                      <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                        {screening.fileName} · {formatDate(screening.createdAt)}
                        {screening.statusUpdatedAt && (
                          <> · <span className="text-zinc-400 dark:text-zinc-500">status {formatStatusDate(screening.statusUpdatedAt)}</span></>
                        )}
                      </span>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <StatusSelect
                        status={screening.status}
                        onChange={(status) => handleStatusChange(screening.id, status)}
                      />
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
                  </div>

                  {expanded && (
                    <div className="flex flex-col gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
                      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {screening.summary}
                      </p>

                      {(screening.mustHaveScore !== undefined || screening.niceToHaveScore !== undefined) && (
                        <div className="flex items-center gap-1.5">
                          {screening.mustHaveScore !== undefined && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                              Must-have {screening.mustHaveScore}
                            </span>
                          )}
                          {screening.niceToHaveScore !== undefined && (
                            <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
                              Nice-to-have {screening.niceToHaveScore}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex flex-col gap-3">
                        <InsightList label="Strengths" items={screening.strengths} variant="positive" />
                        <InsightList label="Concerns" items={screening.concerns} variant="warning" />
                      </div>

                      <details className="text-sm text-zinc-600 dark:text-zinc-300">
                        <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-200">
                          Job description used
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                          {screening.jobDescription}
                        </p>
                      </details>

                      <div className="flex items-center justify-between">
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

                        {confirmDeleteId === screening.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-500 dark:text-zinc-400">Delete this record?</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(screening.id)}
                              disabled={deletingId === screening.id}
                              className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60 dark:bg-rose-500 dark:hover:bg-rose-600"
                            >
                              {deletingId === screening.id ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deletingId === screening.id}
                              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(screening.id)}
                            aria-label="Delete this screening record"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path
                                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12ZM10 11v6M14 11v6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
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
