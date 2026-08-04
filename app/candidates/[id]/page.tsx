"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ResultCard } from "@/components/ResultCard";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import type { CandidateStatus, JDAnalysis, ScreeningRecord } from "@/lib/types";
import { toCandidateResult } from "@/lib/toCandidateResult";

/**
 * Full result card view for an already-saved candidate — added 2026-07-27
 * (Vlad: "for already existing candidates in the pipeline result card I
 * want an option to view a full result card... just like a drawer in
 * tracker page has it"). Unlike the Tracker drawer (a slide-over panel over
 * the same page), this is a real, linkable page — a recruiter can share the
 * URL, bookmark it, or open it in a new tab, none of which a drawer
 * supports. Reuses ResultCard itself in `solo` mode rather than building a
 * second detail view — same component the Screen tab uses, just fed an
 * already-saved ScreeningRecord instead of a fresh scoring result.
 */

export default function CandidateFullResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const numId = parseInt(id, 10);

  const [screening, setScreening] = useState<ScreeningRecord | null>(null);
  const [projectName, setProjectName] = useState<string | undefined>(undefined);
  const [jdAnalysis, setJdAnalysis] = useState<JDAnalysis | null | undefined>(undefined);
  // Feeds ResultCard's scoreThreshold prop — see that component's own doc
  // comment (2026-08-03 fix, Vlad: "why does the result card say 'Proceed'
  // if the candidate was below the threshold?"). This page fetched the
  // project already for jdAnalysis/name; scoreThreshold was just never
  // pulled off the same response.
  const [scoreThreshold, setScoreThreshold] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Read via window.location.search (not useSearchParams()) to avoid Next's
  // Suspense-boundary requirement for that hook — same pattern already used
  // in app/projects/[id]/page.tsx for its own one-time `?tab=`/`?candidate=`
  // read. Set by AlreadyScreenedCard's "View full result" link when a
  // durable batch page exists for the batch this candidate was skipped out
  // of (Vlad's ask, 2026-07-28) — lets Back return there deterministically
  // instead of guessing at a destination.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    setReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/history/${numId}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        const record: ScreeningRecord = data.screening;
        setScreening(record);

        // Best-effort — the JD analysis powers keyword highlighting in the
        // career trajectory, same as the Screen tab. A failure here still
        // leaves a fully usable card, just without highlighting.
        if (record.projectId != null) {
          try {
            const pRes = await fetch(`/api/projects/${record.projectId}`);
            if (!cancelled && pRes.ok) {
              const pData = await pRes.json();
              setProjectName(pData.project?.name);
              setJdAnalysis(pData.project?.jdAnalysis ?? null);
              setScoreThreshold(pData.project?.scoreThreshold);
            }
          } catch {
            // non-fatal
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this candidate.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [numId]);

  function handleStatusChange(_id: number, status: CandidateStatus) {
    setScreening((prev) => (prev ? { ...prev, status } : prev));
    fetch(`/api/history/${numId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  }

  function handleArchiveReasonChange(_id: number, reason: string) {
    setScreening((prev) => (prev ? { ...prev, archiveReason: reason } : prev));
    fetch(`/api/history/${numId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archiveReason: reason }),
    }).catch(() => {});
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/candidates" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        <PageHeader
          icon={<>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
          </>}
          title={screening?.candidateName ?? "Candidate"}
          subtitle={projectName ? `Screened in "${projectName}"` : undefined}
          action={
            // Deterministic destination, not router.back(). Three tiers,
            // most specific first: (1) returnTo — the durable batch page
            // this candidate was skipped out of (2026-07-28, real fix —
            // see app/projects/[id]/batches/[batchId]/page.tsx); (2) the
            // Screen tab, which restores its own live results view from
            // sessionStorage (first attempt at this, 2026-07-28 — still
            // useful for a quick same-tab round trip, just not durable
            // across machines on its own, see that component's comment);
            // (3) the candidates list as a last resort. An earlier
            // router.back() attempt here just left the recruiter on a
            // blank Filters tab, since Next's client router doesn't
            // reliably preserve a fully unmounted tab's React state across
            // a back-navigation.
            <Link
              href={
                returnTo
                  ?? (screening?.projectId != null ? `/projects/${screening.projectId}?tab=screen` : "/candidates")
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5m0 0 6 6m-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </Link>
          }
        />

        {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
            {error}
          </p>
        )}
        {!loading && !error && !screening && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Candidate not found.</p>
        )}

        {screening && (
          <ul>
            <ResultCard
              result={toCandidateResult(screening)}
              rank={1}
              solo
              roleContext={projectName}
              jdAnalysis={jdAnalysis}
              scoreThreshold={scoreThreshold}
              onStatusChange={handleStatusChange}
              onArchiveReasonChange={handleArchiveReasonChange}
            />
          </ul>
        )}
      </main>
    </div>
  );
}
