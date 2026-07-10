"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CandidateResult, CandidateStatus, CredibilityAssessment, ExistingCandidateRef } from "@/lib/types";

import { CrossReferenceChecker } from "./CredibilityChecker";
import { InsightList } from "./InsightList";
import { QuestionGenerator } from "./QuestionGenerator";
import { RecommendationBadge } from "./RecommendationBadge";
import { ScoreBadge } from "./ScoreBadge";
import { StatusSelect } from "./StatusSelect";
import { TrajectoryRenderer, countKeywordMatches } from "./TrajectoryRenderer";
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
  onSave,
  onFindBetterFit,
  onCheckCrossProjectPromise,
  onTransferToProject,
  otherActiveCount,
  nameMatch,
  solo = false,
}: {
  result: CandidateResult;
  rank: number;
  roleContext?: string;
  jdAnalysis?: JDAnalysis | null;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  onSave?: () => Promise<number>;
  onFindBetterFit?: () => Promise<FitSuggestion | null>;
  /** Cheap Claude classification call — decides whether this candidate is worth auto-firing the full cross-project check for. */
  onCheckCrossProjectPromise?: () => Promise<boolean>;
  onTransferToProject?: (suggestion: FitSuggestion) => Promise<void>;
  /** Count of other active projects in the team. undefined = not checked yet, 0 = nothing to suggest against. */
  otherActiveCount?: number;
  /**
   * Post-score name match against an already-saved candidate in this
   * project — the one case the pre-score hash/filename check can't catch
   * (two genuinely different resume files for the same person). Purely
   * informational: scoring already happened by the time this is known.
   */
  nameMatch?: ExistingCandidateRef;
  solo?: boolean;
}) {
  const [credibility, setCredibility] = useState<CredibilityAssessment | null>(
    result.credibility ?? null
  );
  const [showQuestion, setShowQuestion] = useState(false);
  const [savedId, setSavedId] = useState<number | undefined>(result.id);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  // of this same effect — doing that once caused a real bug here. Setting
  // checkingGate(true) triggers a re-render, React sees the dependency
  // changed, tears down this effect instance (flipping its `cancelled`
  // flag), and starts a second one — but the original async call is still
  // in flight. When it finally resolves, it sees `cancelled` and bails out
  // without ever calling setCheckingGate(false), leaving "Checking other
  // active roles…" stuck on screen forever. A ref sidesteps this entirely
  // since setting a ref doesn't trigger a re-render or re-run the effect.
  const gateStartedRef = useRef(false);
  useEffect(() => {
    if (!onCheckCrossProjectPromise || !hasOtherActiveProjects || savedId !== undefined) return;
    if (gateStartedRef.current) return;
    gateStartedRef.current = true;

    let cancelled = false;
    (async () => {
      setCheckingGate(true);
      let promising = false;
      try {
        promising = await onCheckCrossProjectPromise();
      } catch {
        promising = false;
      }
      if (cancelled) return;
      setCheckingGate(false);
      setGateChecked(true);
      if (promising) handleFindBetterFit();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCheckCrossProjectPromise, hasOtherActiveProjects, savedId]);

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

  async function handleSave() {
    if (!onSave || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const id = await onSave();
      setSavedId(id);
      result.id = id; // mutate so status change handler works
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
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
        <ScoreBadge score={result.score} size={solo ? "lg" : "md"} />
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className={`font-semibold text-zinc-400 dark:text-zinc-500 ${solo ? "text-sm" : "text-xs"}`}>#{rank}</span>
            <h3 className={`font-semibold text-zinc-900 dark:text-zinc-50 ${solo ? "text-2xl" : "text-base"}`}>
              {result.candidateName}
            </h3>
            <RecommendationBadge recommendation={result.recommendation} />
          </div>
          {savedId !== undefined && result.status !== undefined && onStatusChange && (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusSelect
                status={result.status}
                onChange={(status) => onStatusChange(savedId, status)}
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
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          A different resume file for a candidate named <strong>{nameMatch.candidateName}</strong> already exists in this project — worth a second look, wasn&#x2019;t caught before scoring.
        </p>
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

      {/* Transferred confirmation — replaces the unsaved banner once a transfer succeeds */}
      {transferredTo && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          Transferred to{" "}
          <Link
            href={`/projects/${transferredTo.projectId}?tab=pipeline`}
            className="font-semibold underline underline-offset-2 hover:text-emerald-800 dark:hover:text-emerald-300"
          >
            {transferredTo.projectName}
          </Link>
        </div>
      )}

      {/* Unsaved banner */}
      {savedId === undefined && onSave && !transferredTo && (
        <div className="mt-4 flex flex-col gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Score below threshold — not saved to pipeline
            </p>
            <div className="flex items-center gap-2 shrink-0">
              {saveError && <span className="text-xs text-rose-500">{saveError}</span>}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {saving ? "Saving…" : "Save anyway"}
              </button>
            </div>
          </div>

          {/* Cross-project fit — a cheap Claude gate decides whether to auto-fire the real check; manual link otherwise */}
          {onFindBetterFit && hasOtherActiveProjects && (
            <div className="border-t border-zinc-200 pt-2.5 dark:border-zinc-700">
              {fitError && <p className="text-xs text-rose-500">{fitError}</p>}
              {!fitError && (checkingGate || checkingFit) && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Checking other active roles…</p>
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
                  className="text-xs font-medium text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  Check other active roles
                </button>
              )}
            </div>
          )}
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
            onComplete={(assessment) => {
              setCredibility(assessment);
              fetch(`/api/history/${savedId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credibility: assessment }),
              }).catch(() => {});
            }}
          />
        )}

        {canCheck && (
          <>
            <button
              type="button"
              onClick={() => setShowQuestion((v) => !v)}
              className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                showQuestion
                  ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-violet-500/50 dark:hover:bg-violet-500/10 dark:hover:text-violet-400"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Generate question
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-in-out"
              style={{ gridTemplateRows: showQuestion ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <QuestionGenerator screeningId={savedId!} />
              </div>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
