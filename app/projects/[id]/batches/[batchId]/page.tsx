"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ResultCard } from "@/components/ResultCard";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import type { CandidateStatus, JDAnalysis, ScreeningRecord } from "@/lib/types";
import { toCandidateResult } from "@/lib/toCandidateResult";

/**
 * Durable "come back to this batch" page — Vlad's ask, 2026-07-28. A first
 * attempt at this used sessionStorage to restore the Screen tab's in-memory
 * results view; Vlad correctly flagged that as a dead end for a recruiter
 * who explicitly works across two machines (sessionStorage is one-browser-
 * tab-local, see CLAUDE.md's "why Cirot is web-hosted, not local"). This
 * page is the real fix: every screening saved in one screening run carries
 * the same batchId (see supabase-migration-batch-id.sql and
 * app/api/screen-resumes/route.ts's do-not-touch exception), so this is a
 * real, database-backed, bookmarkable, cross-device, shareable-with-a-
 * teammate URL — same team-scoped access control as every other page here,
 * not tied to whoever happened to screen the batch.
 *
 * Deliberately read/manage-only (view, status, archive reason) — no
 * rescore/fit-suggestion/transfer actions, matching the same scope
 * app/candidates/[id]/page.tsx already established for viewing a single
 * already-saved candidate. Those actions need the original resume File
 * object in memory, which no page reached via a fresh URL load has; the
 * live Screen tab (during the actual screening run) is still where that
 * full action set lives.
 */
export default function BatchResultsPage({ params }: { params: Promise<{ id: string; batchId: string }> }) {
  const { id, batchId } = use(params);
  const projectId = parseInt(id, 10);

  const [screenings, setScreenings] = useState<ScreeningRecord[] | null>(null);
  const [projectName, setProjectName] = useState<string | undefined>(undefined);
  const [jdAnalysis, setJdAnalysis] = useState<JDAnalysis | null | undefined>(undefined);
  // Feeds ResultCard's scoreThreshold prop — see that component's own doc
  // comment (2026-08-03 fix). This page already fetches the full project for
  // jdAnalysis/name; scoreThreshold was just never pulled off the response.
  const [scoreThreshold, setScoreThreshold] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/projects/${projectId}/batches/${batchId}`).then((r) => r.json()),
      fetch(`/api/projects/${projectId}`).then((r) => r.json()),
    ])
      .then(([batchData, projectData]) => {
        if (cancelled) return;
        if (batchData.error) {
          setError(batchData.error);
          return;
        }
        const records: ScreeningRecord[] = batchData.screenings ?? [];
        // Same order the live Screen tab results view uses.
        records.sort((a, b) => b.score - a.score);
        setScreenings(records);
        if (!projectData.error) {
          setProjectName(projectData.project?.name);
          setJdAnalysis(projectData.project?.jdAnalysis ?? null);
          setScoreThreshold(projectData.project?.scoreThreshold);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this batch.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, batchId]);

  function handleStatusChange(id: number, status: CandidateStatus) {
    setScreenings((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, status } : s)) : prev));
    fetch(`/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  function handleArchiveReasonChange(id: number, archiveReason: string) {
    setScreenings((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, archiveReason } : s)) : prev));
    fetch(`/api/history/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveReason }),
    }).catch(() => {});
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/projects" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        <PageHeader
          icon={<>
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" strokeLinecap="round" strokeLinejoin="round" />
          </>}
          title="Screening batch"
          subtitle={
            screenings
              ? `${screenings.length} candidate${screenings.length !== 1 ? "s" : ""}${projectName ? ` — screened in "${projectName}"` : ""}`
              : undefined
          }
          action={
            <Link
              href={`/projects/${projectId}?tab=pipeline`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5m0 0 6 6m-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Pipeline
            </Link>
          }
        />

        {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </p>
        )}
        {!loading && !error && screenings && screenings.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This batch link doesn&#x2019;t match any saved candidates — it may have already been screened somewhere no longer
            available, or the link is stale.
          </p>
        )}

        {screenings && screenings.length > 0 && (
          <ul className="flex flex-col gap-4">
            {screenings.map((s, i) => (
              <ResultCard
                key={s.id}
                result={toCandidateResult(s)}
                rank={i + 1}
                roleContext={projectName}
                jdAnalysis={jdAnalysis}
                scoreThreshold={scoreThreshold}
                onStatusChange={handleStatusChange}
                onArchiveReasonChange={handleArchiveReasonChange}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
