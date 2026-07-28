"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/ResultCard";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import type { CandidateResult, CandidateStatus, JDAnalysis, ScreeningRecord } from "@/lib/types";

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

// ScreeningRecord (read from the DB) and CandidateResult (what ResultCard
// expects) are near-identical but not the same type — this app never had a
// reason to unify them before now. The one real incompatibility:
// recommendation is nullable on ScreeningRecord (an old screening from
// before this field existed) but not on CandidateResult. Coalescing to
// "decline" is a display-only default for the rare null case — it doesn't
// touch the stored value, and ResultCard's own status/notes/credibility
// controls all still act on the real saved record via its own `id`.
function toCandidateResult(s: ScreeningRecord): CandidateResult {
  return {
    id: s.id,
    fileName: s.fileName,
    candidateName: s.candidateName,
    score: s.score,
    mustHaveScore: s.mustHaveScore,
    niceToHaveScore: s.niceToHaveScore,
    summary: s.summary,
    strengths: s.strengths,
    concerns: s.concerns,
    careerTrajectory: s.careerTrajectory,
    recommendation: s.recommendation ?? "decline",
    status: s.status,
    credibility: s.credibility,
    archiveReason: s.archiveReason,
    notes: s.notes,
    linkedInMode: s.linkedInMode,
    agencyName: s.agencyName,
    duplicateFlag: s.duplicateFlag,
    duplicateMatchId: s.duplicateMatchId,
    historyAlertType: s.historyAlertType,
    historyAlertMatchId: s.historyAlertMatchId,
    historyAlertMatchProjectId: s.historyAlertMatchProjectId,
    historyAlertMatchProjectName: s.historyAlertMatchProjectName,
    historyAlertMatchCandidateName: s.historyAlertMatchCandidateName,
  };
}

export default function CandidateFullResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const numId = parseInt(id, 10);
  const router = useRouter();

  const [screening, setScreening] = useState<ScreeningRecord | null>(null);
  const [projectName, setProjectName] = useState<string | undefined>(undefined);
  const [jdAnalysis, setJdAnalysis] = useState<JDAnalysis | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Back should return to wherever the recruiter actually came from — most
  // often the Screen tab's results view mid-batch (e.g. clicked "View full
  // result" on an already-screened candidate while reviewing a batch of
  // freshly-uploaded resumes), which is client-side React state with no URL
  // of its own, so a hardcoded href here would always dump them onto the
  // Pipeline tab instead and lose that in-progress batch view. Vlad's ask,
  // 2026-07-28. document.referrer is set once per real page load and is
  // unaffected by client-side <Link> transitions within the same tab, so it
  // reliably distinguishes "arrived via clicking around in the app this
  // session" (same-origin — safe to router.back()) from "opened via a
  // bookmarked/shared link" (this page is explicitly designed to support
  // that, per the comment above — falls back to the project's Pipeline tab).
  const [cameFromWithinApp, setCameFromWithinApp] = useState(false);
  useEffect(() => {
    setCameFromWithinApp(document.referrer.startsWith(window.location.origin));
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
            <button
              type="button"
              onClick={() => {
                if (cameFromWithinApp) {
                  router.back();
                } else {
                  const fallbackHref =
                    projectName && screening?.projectId != null
                      ? `/projects/${screening.projectId}?tab=pipeline`
                      : "/candidates";
                  router.push(fallbackHref);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5m0 0 6 6m-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
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
              onStatusChange={handleStatusChange}
              onArchiveReasonChange={handleArchiveReasonChange}
            />
          </ul>
        )}
      </main>
    </div>
  );
}
