"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CandidateResult, CandidateStatus, CredibilityAssessment, ExistingCandidateRef, RejectionHistoryEntry } from "@/lib/types";

import { CrossReferenceChecker } from "./CredibilityChecker";
import { InsightList } from "./InsightList";
import { RecommendationBadge } from "./RecommendationBadge";
import { ScoreBadge } from "./ScoreBadge";
import { StatusSelect } from "./StatusSelect";
import { TrajectoryRenderer, countKeywordMatches } from "./TrajectoryRenderer";
import SourceIcon from "./SourceIcon";
import { getSourceType } from "@/lib/sourceType";
import type { JDAnalysis } from "@/lib/types";

// ── Main ResultCard ─────────────────────────────────────────────────────────

export interface FitSuggestion {
  projectId: number;
  projectName: string;
  score: number;
  /** Full scored result against the target project — carried along so a transfer can save directly, without re-scoring. */
  result: CandidateResult;
  jobDescription: string;
}

export function ResultCard({
  result,
  rank,
  roleContext,
  jdAnalysis,
  onStatusChange,
  onArchiveReasonChange,
  belowThreshold = false,
  onFindBetterFit,
  onCheckCrossProjectPromise,
  onTransferToProject,
  otherActiveCount,
  nameMatch,
  rejectionHistory,
  solo = false,
}: {
  result: CandidateResult;
  rank: number;
  roleContext?: string;
  jdAnalysis?: JDAnalysis | null;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  /**
   * Archive-reason picker shown on the status pill once status is
   * "archived" — mirrors StatusStageControl's reason segment used on
   * Pipeline/All Candidates cards. Vlad's ask, 2026-07-15: this post-
   * screening card previously showed only the bare status with no way to
   * capture why a candidate was archived right after scoring.
   */
  onArchiveReasonChange?: (id: number, archiveReason: string) => void;
  /**
   * Every screened candidate is saved regardless of score — this just
   * decides whether to surface the cross-project fit suggestion (a
   * below-threshold score on THIS project doesn't mean much for others).
   */
  belowThreshold?: boolean;
  onFindBetterFit?: () => Promise<FitSuggestion | null>;
  /** Cheap Claude classification call — decides whether this candidate is worth auto-firing the full cross-project check for. */
  onCheckCrossProjectPromise?: () => Promise<boolean>;
  onTransferToProject?: (suggestion: FitSuggestion) => Promise<void>;
  /** Count of other active projects across every team this recruiter belongs to. undefined = not checked yet, 0 = nothing to suggest against. */
  otherActiveCount?: number;
  /**
   * Post-score name match against an already-saved candidate in this
   * project — the one case exact-content hashing can't catch (two genuinely
   * different resume files that turn out to name the same person). Purely
   * informational: scoring already happened by the time this is known.
   * Offers an optional "Compare" against the matched candidate (see the
   * showNameCompare state below) — this used to live on a separate,
   * pre-score filename-match signal, retired 2026-07-15 because comparing
   * filenames (rather than real identity) produced false positives on
   * generic filenames like "Resume (16).pdf". nameMatch is strictly more
   * reliable for the same underlying question, so Compare moved here
   * instead of being dropped. See decisions-log.md.
   */
  nameMatch?: ExistingCandidateRef;
  /**
   * System-wide (any project, any team) — this candidate was rejected
   * somewhere in the system before. Deliberately not scoped like nameMatch,
   * duplicateFlag, or historyAlertType — any recruiter should see this.
   */
  rejectionHistory?: RejectionHistoryEntry;
  solo?: boolean;
}) {
  const [credibility, setCredibility] = useState<CredibilityAssessment | null>(
    result.credibility ?? null
  );
  const [archiveReason, setArchiveReason] = useState<string | undefined>(result.archiveReason);
  const [savedId] = useState<number | undefined>(result.id);
  // Notes field, added 2026-07-16 in place of the removed Generate Question
  // tool — same pattern as CandidateCard's notes textarea on the All
  // Candidates page (app/candidates/page.tsx), just backed by result.notes
  // instead of a ScreeningRecord.
  const [noteText, setNoteText] = useState(result.notes ?? "");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [showNameCompare, setShowNameCompare] = useState(false);
  const [nameCompareAssessment, setNameCompareAssessment] = useState<CredibilityAssessment | null>(null);
  const [checkingGate, setCheckingGate] = useState(false);
  const [gateChecked, setGateChecked] = useState(false);
  const [checkingFit, setCheckingFit] = useState(false);
  const [fitChecked, setFitChecked] = useState(false);
  const [fitSuggestion, setFitSuggestion] = useState<FitSuggestion | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferredTo, setTransferredTo] = useState<{ projectId: number; projectName: string } | null>(null);

  const canCheck = savedId !== undefined;
  const trajectoryText = result.careerTrajectory ?? result.summary;

  const hasOtherActiveProjects = otherActiveCount !== undefined && otherActiveCount > 0;

  // combinedScoreDelta: credibility (cross-reference check) and nameCompare
  // (Compare against a name-matched candidate) are independent adjustments —
  // both should shift the displayed score if both fired, not just whichever
  // ran last. Added 2026-07-16.
  const combinedScoreDelta = (credibility?.scoreDelta ?? 0) + (nameCompareAssessment?.scoreDelta ?? 0);

  async function handleSaveNotes(text: string) {
    if (savedId === undefined) return;
    setNoteSaveState("saving");
    await fetch(`/api/history/${savedId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: text }),
    }).catch(() => {});
    setNoteSaveState("saved");
    setTimeout(() => setNoteSaveState("idle"), 2000);
  }

  async function handleFindBetterFit() {
    if (!onFindBetterFit || checkingFit) return;
    setCheckingFit(true);
    setFitError(null);
    try {
      const suggestion = await onFindBetterFit();
      setFitSuggestion(suggestion);
      setFitChecked(true);
    } catch (err) {
      setFitError(err instanceof Error ? err.message : "Could not check other roles");
    } finally {
      setCheckingFit(false);
    }
  }

  // Auto-fire gate: a cheap Claude classification call (not a local keyword
  // heuristic — two prior local heuristics, must-have score and keyword
  // overlap, both missed real cross-project fits because they approximate
  // semantic judgment with something structurally weaker; see decisions-log
  // 2026-07-10). If it says the candidate is plausibly promising, chain
  // straight into the real check with no button.
  //
  // gateStartedRef (not state) guards against double-starting this: state
  // set INSIDE this effect (checkingGate) must never also be a dependency
  // of this same effect — doing that once caused a real bug here (see
  // decisions-log 2026-07-10). That fix used a `cancelled` flag set in the
  // effect's cleanup — but `onCheckCrossProjectPromise` is an inline arrow
  // function the parent recreates on every render, so it's still a fresh
  // reference on nearly every re-render while the gate call is in flight.
  // That reruns this effect: the ref guard correctly stops a *second* API
  // call from starting, but the cleanup from the ORIGINAL run still fires
  // and flips `cancelled`, so when the original call resolves it silently
  // bails out without ever calling setCheckingGate(false) — "Checking other
  // active roles…" stuck forever, same symptom as the bug this was meant to
  // fix, just triggered a different way. Fix: only bail on true unmount
  // (mountedRef, set once via its own `[]` effect), never on a same-instance
  // dependency-array rerun — gateStartedRef already guarantees this async
  // chain only ever starts once per card.
  const gateStartedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!onCheckCrossProjectPromise || !hasOtherActiveProjects || !belowThreshold) return;
    if (gateStartedRef.current) return;
    gateStartedRef.current = true;

    (async () => {
      setCheckingGate(true);
      let promising = false;
      try {
        promising = await onCheckCrossProjectPromise();
      } catch {
        promising = false;
      }
      if (!mountedRef.current) return;
      setCheckingGate(false);
      setGateChecked(true);
      if (promising) handleFindBetterFit();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCheckCrossProjectPromise, hasOtherActiveProjects, belowThreshold]);

  async function handleTransfer() {
    if (!onTransferToProject || !fitSuggestion || transferring) return;
    setTransferring(true);
    setTransferError(null);
    try {
      await onTransferToProject(fitSuggestion);
      setTransferredTo({ projectId: fitSuggestion.projectId, projectName: fitSuggestion.projectName });
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setTransferring(false);
    }
  }

  const mustSkills = jdAnalysis?.mustHaveSkills ?? [];
  const niceSkills = jdAnalysis?.niceToHaveSkills ?? [];
  const mustMatched = trajectoryText ? countKeywordMatches(trajectoryText, mustSkills) : 0;
  const niceMatched = trajectoryText ? countKeywordMatches(trajectoryText, niceSkills) : 0;

  return (
    <li className={`animate-fade-in-up rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 ${solo ? "p-10" : "p-5"}`}>
      {/* Header: centered score + name */}
      <div className="flex flex-col items-center gap-3 text-center">
        <ScoreBadge
          score={result.score}
          size={solo ? "lg" : "md"}
          adjustedScore={combinedScoreDelta ? result.score + combinedScoreDelta : undefined}
        />
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className={`font-semibold text-zinc-400 dark:text-zinc-500 ${solo ? "text-sm" : "text-xs"}`}>#{rank}</span>
            <h3 className={`font-semibold text-zinc-900 dark:text-zinc-50 ${solo ? "text-2xl" : "text-base"}`}>
              {result.candidateName}
            </h3>
            <RecommendationBadge recommendation={result.recommendation} />
            {result.duplicateFlag && (
              <span
                title="Duplicate detected — matches another candidate's content fingerprint"
                className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
              >
                Duplicate detected
              </span>
            )}
            {result.historyAlertType && (
              <Link
                href={result.historyAlertMatchProjectId != null ? `/projects/${result.historyAlertMatchProjectId}?tab=pipeline` : "#"}
                title={
                  result.historyAlertMatchCandidateName && result.historyAlertMatchProjectName
                    ? `Matches ${result.historyAlertMatchCandidateName} in ${result.historyAlertMatchProjectName}`
                    : result.historyAlertType === "known_fraud_pattern"
                    ? "Known fraud pattern — matches a flagged candidate in another project"
                    : "Previously seen in another project"
                }
                className={
                  result.historyAlertType === "known_fraud_pattern"
                    ? "shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                    : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25"
                }
              >
                {result.historyAlertType === "known_fraud_pattern" ? "Known fraud pattern" : "Previously seen"}
              </Link>
            )}
            <SourceIcon type={getSourceType(result)} agencyName={result.agencyName} />
          </div>
          {savedId !== undefined && result.status !== undefined && onStatusChange && (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusSelect
                status={result.status}
                onChange={(status) => onStatusChange(savedId, status)}
                archiveReason={archiveReason}
                onArchiveReasonChange={(reason) => {
                  setArchiveReason(reason);
                  onArchiveReasonChange?.(savedId, reason);
                }}
              />
            </div>
          )}
          {(result.mustHaveScore !== undefined || result.niceToHaveScore !== undefined) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {result.mustHaveScore !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Must-have {result.mustHaveScore}
                  {mustSkills.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                      {mustMatched}/{mustSkills.length} kw
                    </span>
                  )}
                </span>
              )}
              {result.niceToHaveScore !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Nice-to-have {result.niceToHaveScore}
                  {niceSkills.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-violet-200 px-1.5 text-violet-800 dark:bg-violet-500/30 dark:text-violet-300">
                      {niceMatched}/{niceSkills.length} kw
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
          <p className={`text-zinc-400 dark:text-zinc-500 ${solo ? "text-sm" : "text-xs"}`}>{result.fileName}</p>
        </div>
      </div>
      {nameMatch && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <div className="flex items-center justify-between gap-2">
            <p className="text-center flex-1">
              A different resume file for a candidate named <strong>{nameMatch.candidateName}</strong> already exists in this project — worth a second look, wasn&#x2019;t caught before scoring.
            </p>
            {savedId !== undefined && !nameCompareAssessment && (
              <button type="button" onClick={() => setShowNameCompare((v) => !v)}
                className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:bg-zinc-900 dark:text-amber-400 dark:hover:bg-zinc-800">
                {showNameCompare ? "Hide" : "Compare"}
              </button>
            )}
          </div>
          {nameCompareAssessment && (
            <p className="mt-1.5 text-center text-zinc-600 dark:text-zinc-300">
              Compared — see details below.
            </p>
          )}
          {(showNameCompare || nameCompareAssessment) && savedId !== undefined && (
            <div className="mt-2 rounded-lg border border-amber-100 bg-white p-3 dark:border-amber-500/20 dark:bg-zinc-900">
              {/*
               * screeningId is THIS candidate's own saved record (savedId),
               * crossRefScreeningId is the other, already-saved candidate
               * nameMatch points at. This Compare action used to live on a
               * separate pre-score filename-match signal, which had exactly
               * this direction backwards (screeningId was the OTHER
               * candidate) — see decisions-log.md, 2026-07-15, for the full
               * story of why that was wrong and why nameMatch (real identity
               * comparison, not a filename string) is the more trustworthy
               * trigger for this action going forward.
               */}
              <CrossReferenceChecker
                screeningId={savedId}
                roleContext={roleContext}
                crossRefScreeningId={nameMatch.id}
                crossRefLabel={nameMatch.candidateName}
                currentAssessment={nameCompareAssessment ?? undefined}
                onComplete={setNameCompareAssessment}
              />
            </div>
          )}
        </div>
      )}
      {rejectionHistory && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          Previously rejected{rejectionHistory.projectName ? <> for <strong>{rejectionHistory.projectName}</strong></> : null}
          {rejectionHistory.reason ? <> — &#x201C;{rejectionHistory.reason}&#x201D;</> : " — no reason recorded"}.
        </p>
      )}

      {/* Cross-project fit — surfaced immediately, right before Career Trajectory,
          so a recruiter sees it before reading anything else. Every candidate is
          already saved regardless of score; this is purely about whether a
          stronger-fitting open role exists elsewhere. A cheap Claude gate decides
          whether to auto-fire the real check; manual link otherwise. */}
      {belowThreshold && !transferredTo && onFindBetterFit && hasOtherActiveProjects && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 dark:border-violet-500/30 dark:bg-violet-500/10">
          {fitError && <p className="text-xs text-rose-500">{fitError}</p>}
          {!fitError && (checkingGate || checkingFit) && (
            <p className="text-xs text-violet-500 dark:text-violet-400">Checking other active roles…</p>
          )}
          {!fitError && !checkingGate && !checkingFit && fitChecked && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                {fitSuggestion ? (
                  <>
                    Stronger fit for <span className="font-semibold text-violet-600 dark:text-violet-400">{fitSuggestion.projectName}</span> — scored {fitSuggestion.score} there
                  </>
                ) : (
                  "No stronger fit found among your other active roles."
                )}
              </p>
              {fitSuggestion && onTransferToProject && (
                <div className="flex items-center gap-2 shrink-0">
                  {transferError && <span className="text-xs text-rose-500">{transferError}</span>}
                  <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={transferring}
                    className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {transferring ? "Transferring…" : `Transfer to ${fitSuggestion.projectName}`}
                  </button>
                </div>
              )}
            </div>
          )}
          {!fitError && !checkingGate && !checkingFit && !fitChecked && (gateChecked || !onCheckCrossProjectPromise) && (
            <button
              type="button"
              onClick={handleFindBetterFit}
              className="text-xs font-medium text-violet-500 underline decoration-dotted underline-offset-2 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              Check other active roles
            </button>
          )}
        </div>
      )}

      {/* Transferred confirmation — replaces the fit-suggestion block once a transfer succeeds */}
      {transferredTo && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          Transferred to{" "}
          <Link
            href={`/projects/${transferredTo.projectId}?tab=pipeline`}
            className="font-semibold underline underline-offset-2 hover:text-emerald-800 dark:hover:text-emerald-300"
          >
            {transferredTo.projectName}
          </Link>
        </div>
      )}

      {trajectoryText && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Career trajectory
          </p>
          <TrajectoryRenderer
            text={trajectoryText}
            className={solo ? "text-base" : "text-sm"}
            highlights={mustSkills.length || niceSkills.length ? { must: mustSkills, nice: niceSkills } : undefined}
          />
        </div>
      )}

      {/* Full-width sections below the header row */}
      <div className={`flex flex-col ${solo ? "mt-6 gap-4" : "mt-4 gap-3"}`}>
        <InsightList label="Strengths" items={result.strengths} variant="positive" />
        <InsightList label="Concerns" items={result.concerns} variant="warning" screeningId={savedId} />
        {canCheck && (
          <CrossReferenceChecker
            screeningId={savedId!}
            roleContext={roleContext}
            currentAssessment={credibility ?? undefined}
            onComplete={async (assessment) => {
              try {
                const res = await fetch(`/api/history/${savedId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ credibility: assessment }),
                });
                if (!res.ok) return false;
                setCredibility(assessment);
                return true;
              } catch {
                return false;
              }
            }}
          />
        )}

        {canCheck && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Notes</span>
              {noteSaveState === "saving" && <span className="text-xs text-zinc-400">Saving...</span>}
              {noteSaveState === "saved" && <span className="text-xs text-emerald-500">Saved</span>}
            </div>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
              onBlur={(e) => handleSaveNotes(e.target.value)}
              placeholder="Add notes about this candidate..." rows={3}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-900" />
          </div>
        )}
      </div>
    </li>
  );
}
