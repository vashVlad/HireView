"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BlacklistEntry, CandidateResult, CandidateStatus, CredibilityAssessment, ExistingCandidateRef, FraudRiskAssessment, RejectionHistoryEntry, Recommendation, TrackerStage } from "@/lib/types";

import { CrossReferenceChecker } from "./CredibilityChecker";
import { FraudRiskChecker } from "./FraudRiskChecker";
import { InsightList } from "./InsightList";
import { RecommendationBadge } from "./RecommendationBadge";
import { ScoreBadge } from "./ScoreBadge";
import { StatusStageControl } from "./StatusStageControl";
import { TrajectoryRenderer } from "./TrajectoryRenderer";
import { ActivityTimeline } from "./ActivityTimeline";
import SourceIcon from "./SourceIcon";
import { getSourceType } from "@/lib/sourceType";
import type { JDAnalysis } from "@/lib/types";
import type { ScreeningAction } from "@/lib/screeningActions";

// ── Main ResultCard ─────────────────────────────────────────────────────────

export interface FitSuggestion {
  projectId: number;
  projectName: string;
  score: number;
  /** Full scored result against the target project — carried along so a transfer can save directly, without re-scoring. */
  result: CandidateResult;
  jobDescription: string;
}

/**
 * A project the candidate is already screened in — excluded from cross-
 * project fit scoring entirely (nothing to suggest there) and surfaced as a
 * plain mention instead. Vlad's ask, 2026-07-28: "if the person already
 * exists in one of the projects just simply mention that and don't screen
 * it again."
 */
export interface AlreadyInProject {
  projectId: number;
  projectName: string;
  /**
   * Added 2026-07-30 (Vlad's ask) alongside the "Also screened in X — Scored
   * Y" redesign — lets this link straight to that screening's own candidate
   * page instead of the general Pipeline tab, and show its score inline.
   */
  screeningId: number;
  score: number;
}

export function ResultCard({
  result,
  rank,
  roleContext,
  jdAnalysis,
  onStatusChange,
  stage,
  onStageChange,
  onArchiveReasonChange,
  onBlacklistChange,
  eligibleForFitCheck = false,
  onFindBetterFit,
  onCheckCrossProjectPromise,
  onTransferToProject,
  otherActiveCount,
  nameMatch,
  rejectionHistory,
  blacklistMatch,
  scoreThreshold,
  solo = false,
}: {
  result: CandidateResult;
  rank: number;
  roleContext?: string;
  jdAnalysis?: JDAnalysis | null;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  /**
   * Tracker stage (TA/L1/L2/In-Person/Offer/Reject), 2026-07-31 (Vlad's
   * ask) — lets a recruiter pick a stage directly on this post-screening
   * card, in the same motion as picking "Screening" for status, instead of
   * having to separately open the Pipeline/Tracker tab afterward. Reuses
   * StatusStageControl exactly as-is (see that component's own doc comment
   * for how a combined status="screening" + stage pick already collapses
   * into one Confirm) — this card just needs to supply the current value
   * and a place to save it. `null`/undefined until a screening actually has
   * a tracker entry yet, same as the Pipeline tab's own `stagesMap` lookup.
   */
  stage?: TrackerStage | null;
  onStageChange?: (id: number, stage: TrackerStage) => void;
  /**
   * Archive-reason picker shown on the status pill once status is
   * "archived" — mirrors StatusStageControl's reason segment used on
   * Pipeline/All Candidates cards. Vlad's ask, 2026-07-15: this post-
   * screening card previously showed only the bare status with no way to
   * capture why a candidate was archived right after scoring.
   */
  onArchiveReasonChange?: (id: number, archiveReason: string) => void;
  /**
   * Blacklist checkbox on the same archive-reason picker, 2026-07-31 (Vlad's
   * ask). Mirrors onArchiveReasonChange's mirror-and-forward shape exactly.
   */
  onBlacklistChange?: (id: number, blacklisted: boolean, reason: string | null) => void;
  /**
   * Every screened candidate is saved regardless of score — this just
   * decides whether to surface the cross-project fit suggestion. Renamed
   * from `belowThreshold` 2026-07-27: originally true only when the score
   * missed this project's threshold outright. Widened (see FIT_CHECK_MARGIN
   * in app/projects/[id]/page.tsx) to also cover a marginal PASS — scoring
   * just above threshold on this project doesn't rule out scoring much
   * better on another one, and a real case surfaced exactly that (54 vs. a
   * 50 threshold here, 80 elsewhere, never checked under the old rule).
   */
  eligibleForFitCheck?: boolean;
  onFindBetterFit?: () => Promise<{ suggestion: FitSuggestion | null; alreadyIn: AlreadyInProject[] }>;
  /** Cheap Claude classification call — decides whether this candidate is worth auto-firing the full cross-project check for. */
  onCheckCrossProjectPromise?: () => Promise<{ promising: boolean; alreadyIn: AlreadyInProject[] }>;
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
  /**
   * System-wide (any project, any team) blacklist warning — Vlad's ask,
   * 2026-07-31: "When a person is archived, let the recruiter blacklist the
   * person if needed, which will be shown during the screening if the same
   * person is applying for a different role." Same name-match pattern and
   * caveats as rejectionHistory above, deliberately styled to stand out much
   * more (Vlad: "must pop") — this is a stronger signal than a plain past
   * rejection.
   */
  blacklistMatch?: BlacklistEntry;
  /**
   * This project's own configurable auto-archive bar (Project.scoreThreshold)
   * — Vlad's ask, 2026-08-03: "why does the result card say 'Proceed' if the
   * candidate was below the threshold?" Root cause: `result.recommendation`
   * comes straight from scoreCandidate.ts (do-not-touch), which derives it
   * from a FIXED `score > 50` split baked into the scoring call, completely
   * independent of whatever threshold this specific project is actually
   * configured with. A candidate could clear that hardcoded 50 (badge says
   * "Proceed") while still scoring below this project's real, higher bar and
   * getting auto-archived — a direct contradiction on screen. When provided,
   * the badge below is recomputed from `score >= scoreThreshold` instead of
   * trusting the model's independent value, matching the exact rule
   * lib/screenings.ts's saveScreening() already uses to decide auto-archive
   * (`score < scoreThreshold` → archived) — same "deterministic, not
   * model-decided" pattern already used for credibility/fraud severity
   * elsewhere in this app. Optional and falls back to `result.recommendation`
   * so a caller with no project context (none currently exists) doesn't break.
   */
  scoreThreshold?: number;
  solo?: boolean;
}) {
  const [credibility, setCredibility] = useState<CredibilityAssessment | null>(
    result.credibility ?? null
  );
  // Manual fraud risk check — added 2026-07-30, only ever offered at score
  // >= 75 (see canShowFraudRisk below). See components/FraudRiskChecker.tsx.
  const [fraudRisk, setFraudRisk] = useState<FraudRiskAssessment | null>(
    result.fraudRisk ?? null
  );
  const [archiveReason, setArchiveReason] = useState<string | undefined>(result.archiveReason);
  const [blacklisted, setBlacklisted] = useState<boolean>(result.blacklisted ?? false);
  const [blacklistReason, setBlacklistReason] = useState<string | null>(result.blacklistReason ?? null);
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
  const [alreadyInProjects, setAlreadyInProjects] = useState<AlreadyInProject[]>([]);
  const [fitError, setFitError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferredTo, setTransferredTo] = useState<{ projectId: number; projectName: string } | null>(null);
  // Activity timeline — added 2026-07-29. Previously this only rendered on
  // the Pipeline tab's own inline card markup; ResultCard (the batch-results
  // page and candidate full page both render this) never fetched or showed
  // it at all. Fetched once, the same GET /api/history/[id]/actions route
  // the Pipeline tab already uses.
  const [actions, setActions] = useState<ScreeningAction[] | "loading" | undefined>(undefined);

  const canCheck = savedId !== undefined;
  // Vlad's ask, 2026-07-29: fraud risk checking only makes sense — and is
  // only ever offered — for strong-looking candidates (score >= 75). A
  // weaker resume's problems are already visible without this check.
  // Already-run results stay visible even if a later rescore drops the
  // score below 75, so a past check is never hidden retroactively.
  const canShowFraudRisk = canCheck && (result.score >= 75 || fraudRisk !== null);

  useEffect(() => {
    if (savedId === undefined) return;
    setActions("loading");
    fetch(`/api/history/${savedId}/actions`)
      .then((res) => res.json())
      .then((data) => setActions(data.actions ?? []))
      .catch(() => setActions([]));
  }, [savedId]);

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
      const { suggestion, alreadyIn } = await onFindBetterFit();
      setFitSuggestion(suggestion);
      if (alreadyIn.length > 0) setAlreadyInProjects(alreadyIn);
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
    if (!onCheckCrossProjectPromise || !hasOtherActiveProjects || !eligibleForFitCheck) return;
    if (gateStartedRef.current) return;
    gateStartedRef.current = true;

    (async () => {
      setCheckingGate(true);
      let promising = false;
      try {
        const gateResult = await onCheckCrossProjectPromise();
        promising = gateResult.promising;
        if (gateResult.alreadyIn.length > 0) setAlreadyInProjects(gateResult.alreadyIn);
      } catch {
        promising = false;
      }
      if (!mountedRef.current) return;
      setCheckingGate(false);
      setGateChecked(true);
      if (promising) handleFindBetterFit();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCheckCrossProjectPromise, hasOtherActiveProjects, eligibleForFitCheck]);

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

  // mustMatched/niceMatched (keyword match COUNTS) removed 2026-07-27,
  // Vlad's ask — mustSkills/niceSkills themselves stay: they still drive
  // the actual keyword HIGHLIGHTING via TrajectoryRenderer's `highlights`
  // prop below, which is untouched by this change. Only the numeric "X/Y kw"
  // badge that used to sit next to Must-have/Nice-to-have is gone.
  const mustSkills = jdAnalysis?.mustHaveSkills ?? [];
  const niceSkills = jdAnalysis?.niceToHaveSkills ?? [];

  // See scoreThreshold's doc comment above — recomputed against THIS
  // project's real bar instead of trusting result.recommendation's
  // independent, hardcoded 50-point split.
  const displayRecommendation: Recommendation =
    scoreThreshold !== undefined
      ? (result.score >= scoreThreshold ? "proceed" : "decline")
      : result.recommendation;

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
            <RecommendationBadge recommendation={displayRecommendation} />
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
            {/* Target company score boost, 2026-08-07 (Vlad's ask) — only
                shown when a match was actually found (see
                lib/targetCompanyBoost.ts); an empty array (checked, no
                match) or undefined (no target companies configured) both
                render nothing, matching this row's "only surface a signal,
                not a reassurance" convention (same as the duplicate/history
                badges above). */}
            {result.targetCompanyMatches && result.targetCompanyMatches.length > 0 && (
              <span
                title={`Score boosted +5 for matching: ${result.targetCompanyMatches.join(", ")}`}
                className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
              >
                Target company match
              </span>
            )}
            {/* JD checklist net delta, 2026-08-17 (Vlad's ask) — only shown
                when the checklist was actually evaluated (undefined =
                project has no checklist) and produced a nonzero net effect
                on the score; a zero delta (nothing fired either way, or
                decrease/add items cancelled out) renders nothing, same
                "only surface a signal" convention as the badges above. Full
                per-item breakdown (which items fired and why) renders below
                near Strengths/Concerns, not here — this is just the
                at-a-glance total.  */}
            {result.checklistEvaluation && result.checklistEvaluation.scoreDelta !== 0 && (
              <span
                title="Net effect of the JD checklist on this score — see the Checklist breakdown below for which items fired"
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  result.checklistEvaluation.scoreDelta > 0
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                }`}
              >
                Checklist {result.checklistEvaluation.scoreDelta > 0 ? "+" : ""}
                {result.checklistEvaluation.scoreDelta}
              </span>
            )}
            <SourceIcon type={getSourceType(result)} agencyName={result.agencyName} contentIsLinkedIn={result.resumeIsLinkedIn} />
            {/* Visible agency name, added 2026-07-27 (Vlad's ask: "also show
                agency name when it's given") — previously only surfaced as a
                hover tooltip via SourceIcon's title (sourceLabelWithDetail),
                easy to miss. Red to match the agency icon/badge's existing
                accent color elsewhere in this app (the agency-name input
                field's border, the Agency picker's selected-ring color). */}
            {getSourceType(result) === "agency" && result.agencyName && (
              <span className={`shrink-0 font-medium text-orange-600 dark:text-orange-400 ${solo ? "text-sm" : "text-xs"}`}>
                {result.agencyName}
              </span>
            )}
          </div>
          {savedId !== undefined && result.status !== undefined && onStatusChange && (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusStageControl
                status={result.status}
                stage={stage ?? null}
                onStatusChange={(status) => onStatusChange(savedId, status)}
                onStageChange={(newStage) => onStageChange?.(savedId, newStage)}
                archiveReason={archiveReason}
                onArchiveReasonChange={(reason) => {
                  setArchiveReason(reason);
                  onArchiveReasonChange?.(savedId, reason);
                }}
                blacklisted={blacklisted}
                blacklistReason={blacklistReason}
                onBlacklistChange={(next, reason) => {
                  setBlacklisted(next);
                  setBlacklistReason(reason);
                  onBlacklistChange?.(savedId, next, reason);
                }}
              />
            </div>
          )}
          {(result.mustHaveScore !== undefined || result.niceToHaveScore !== undefined) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {/* Keyword match counts ("X/Y kw") removed 2026-07-27, Vlad's
                  ask — the actual keyword highlighting stays completely
                  intact, it lives entirely in the `highlights` prop passed
                  to TrajectoryRenderer below (mustSkills/niceSkills), which
                  this badge never fed into or gated — it was purely an extra
                  numeric label alongside it. mustMatched/niceMatched (the
                  removed counts) and the now-unused countKeywordMatches
                  import were deleted outright rather than left as dead code. */}
              {result.mustHaveScore !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Must-have {result.mustHaveScore}
                </span>
              )}
              {result.niceToHaveScore !== undefined && (
                <span className={`inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Nice-to-have {result.niceToHaveScore}
                </span>
              )}
            </div>
          )}
          {/* Cross-project NAME match, added 2026-07-27 (Vlad: "just
              mentions that this person was also screened in a different
              project"). Repositioned twice same day per Vlad's follow-ups:
              first out of the crowded badge row next to the name, then here
              — in what used to be the file name's spot — instead of between
              the name/badges row and the status dropdown. Used to fall back
              to the file name when there's no match; that fallback was
              removed 2026-07-29 (Vlad: "remove filenames from the result
              cards") — this slot now renders nothing at all when there's no
              name match, rather than showing anything in its place.
              Deliberately separate from historyAlertType above — that one
              is content-fingerprint-based and can miss the same real person
              presenting a very differently-worded resume for a different
              role; this is a plain name match, no fraud implication.
              Skipped when historyAlertType already points at this exact
              same screening (see lib/screenings.ts), so a real match is
              never mentioned twice. */}
          {result.crossProjectNameMatchScreeningId != null && (
            <p className={`text-zinc-400 dark:text-zinc-500 ${solo ? "text-sm" : "text-xs"}`}>
              Also screened in{" "}
              {result.crossProjectNameMatchProjectId != null ? (
                <Link
                  href={`/projects/${result.crossProjectNameMatchProjectId}?tab=pipeline`}
                  className="font-medium text-sky-600 underline decoration-dotted underline-offset-2 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  &#x201C;{result.crossProjectNameMatchProjectName ?? "another project"}&#x201D;
                </Link>
              ) : (
                <span className="font-medium">&#x201C;another project&#x201D;</span>
              )}
              {/* Score, added 2026-07-27 (Vlad's ask) — the matched
                  screening's own score, not this one's, so a recruiter
                  knows at a glance how that other pass went. */}
              {result.crossProjectNameMatchScore != null && <> &#x2014; Scored {result.crossProjectNameMatchScore}</>}
            </p>
          )}
        </div>
      </div>
      {nameMatch && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <div className="flex items-center justify-between gap-2">
            <p className="text-center flex-1">
              A different resume file for a candidate named <strong>{nameMatch.candidateName}</strong>{" "}
              already exists in this project — worth a second look, wasn&#x2019;t caught before scoring.
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
      {/* Blacklist warning — deliberately styled to "pop" much harder than
          rejectionHistory below it (Vlad's explicit ask): solid near-black
          fill, white bold text, a warning glyph, shown ABOVE the plain
          rejection banner since it's the stronger signal of the two. Same
          confidence-tier caveat as rejectionHistory (loose name match unless
          corroborated by an exact content-hash match). */}
      {blacklistMatch && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-zinc-950 bg-zinc-950 px-3 py-2.5 text-white dark:border-white dark:bg-white dark:text-zinc-950">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="9" strokeLinecap="round" />
            <path d="M5.5 5.5 18.5 18.5" strokeLinecap="round" />
          </svg>
          <p className="text-left text-xs leading-snug">
            <span className="font-bold uppercase tracking-wide">Blacklisted</span>
            {blacklistMatch.projectName ? <> — archived from <strong>{blacklistMatch.projectName}</strong></> : null}
            {blacklistMatch.reason ? <> — &#x201C;{blacklistMatch.reason}&#x201D;</> : " — no reason recorded"}.{" "}
            {blacklistMatch.confidence === "name_and_resume" ? (
              <span className="font-medium">Same resume on file — high-confidence match.</span>
            ) : (
              <span className="italic opacity-80">Name match only — could be a different person with the same name.</span>
            )}
          </p>
        </div>
      )}
      {rejectionHistory && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          Previously rejected{rejectionHistory.projectName ? <> for <strong>{rejectionHistory.projectName}</strong></> : null}
          {rejectionHistory.reason ? <> — &#x201C;{rejectionHistory.reason}&#x201D;</> : " — no reason recorded"}.
          {/* Confidence tier added 2026-07-29 — the underlying match is a
              loose, case/whitespace-only name comparison (see
              normalizeCandidateName), which a common name can trigger on two
              different people. Only say "same resume on file" when the
              upload's own content hash actually matches the rejected
              screening's; otherwise say plainly that it's a name match only,
              so a recruiter doesn't over-trust a coincidence. */}
          {rejectionHistory.confidence === "name_and_resume" ? (
            <> <span className="font-medium">Same resume on file — high-confidence match.</span></>
          ) : (
            <> <span className="italic">Name match only — could be a different person with the same name.</span></>
          )}
        </p>
      )}

      {/* Already-in-project mention, added 2026-07-28 (Vlad's ask), redesigned
          2026-07-30 into a plain line per candidate instead of a boxed
          paragraph: "these projects were excluded from scoring entirely
          (free name-match pre-check, no Claude call spent) since there's
          nothing to suggest where the candidate already exists — just say
          so." Pulled out of the violet fit-suggestion box below (that box is
          now only about the actionable "check other roles" flow) and shown
          independently of fitChecked/fitSuggestion, since it can resolve
          from either the gate call or the full check. Links straight to the
          matched screening's own candidate page and shows its score, now
          that alreadyInProjects carries both (see AlreadyInProject above). */}
      {eligibleForFitCheck && !transferredTo && hasOtherActiveProjects && alreadyInProjects.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {alreadyInProjects.map((p) => (
            <p key={p.projectId} className="text-xs text-zinc-500 dark:text-zinc-400">
              Also screened in{" "}
              <Link
                // returnTo, 2026-08-11 (Vlad's ask, same fix as the matching
                // link in app/projects/[id]/page.tsx) — without this,
                // /candidates/[id]'s Back button falls back to the MATCHED
                // screening's own project, not wherever this ResultCard was
                // actually being viewed from (Screen tab results, a batch
                // page, or the standalone candidate page itself).
                href={`/candidates/${p.screeningId}${
                  typeof window !== "undefined"
                    ? `?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
                    : ""
                }`}
                className="font-medium text-violet-600 underline decoration-dotted underline-offset-2 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
              >
                {p.projectName}
              </Link>
              {" "}— Scored {p.score}
            </p>
          ))}
        </div>
      )}

      {/* Cross-project fit — surfaced immediately, right before Career Trajectory,
          so a recruiter sees it before reading anything else. Every candidate is
          already saved regardless of score; this is purely about whether a
          stronger-fitting open role exists elsewhere. A cheap Claude gate decides
          whether to auto-fire the real check; manual link otherwise. */}
      {eligibleForFitCheck && !transferredTo && onFindBetterFit && hasOtherActiveProjects && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 dark:border-violet-500/30 dark:bg-violet-500/10">
          {fitError && <p className="text-xs text-rose-500">{fitError}</p>}
          {!fitError && (checkingGate || checkingFit) && (
            <p className="text-xs text-violet-500 dark:text-violet-400">Checking other active roles…</p>
          )}
          {!fitError && !checkingGate && !checkingFit && fitChecked && (
            // Layout bug fixed 2026-07-20 (Vlad shared a screenshot): this row
            // used to be a plain `flex items-center justify-between` with no
            // `min-w-0` on the text and no responsive stacking — on a narrow
            // viewport neither the paragraph nor the "Transfer to X" button had
            // room to actually lay out, so both got squeezed into unreadable,
            // overlapping-looking narrow columns instead of wrapping properly.
            // Stacking vertically below `sm:` (text on top, button full-width
            // underneath) and giving the paragraph `min-w-0` so it can wrap
            // within its own row once side-by-side again at `sm:` and up.
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="min-w-0 text-xs text-zinc-600 dark:text-zinc-300">
                {fitSuggestion ? (
                  <>
                    Stronger fit for <span className="font-semibold text-violet-600 dark:text-violet-400">{fitSuggestion.projectName}</span> — scored {fitSuggestion.score} there
                  </>
                ) : (
                  "No stronger fit found among your other active roles."
                )}
              </p>
              {fitSuggestion && onTransferToProject && (
                <div className="flex items-center gap-2 sm:shrink-0">
                  {transferError && <span className="text-xs text-rose-500">{transferError}</span>}
                  <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={transferring}
                    className="w-full shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
        {/* JD checklist breakdown, 2026-08-17 (Vlad's ask) — only FIRED items
            shown (not the whole checklist), so a long checklist with few
            hits doesn't clutter every card; a recruiter can always see the
            full item list on the Filters tab. Reads label/category/points
            straight off each result (denormalized at evaluation time — see
            ChecklistItemResult's comment in lib/types.ts) rather than
            looking the item back up in the project's current checklist, so
            this always shows exactly what the candidate was evaluated
            against, even if the checklist has since been edited. */}
        {result.checklistEvaluation && result.checklistEvaluation.results.some((r) => r.fired) && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Checklist</p>
            <ul className="flex flex-col gap-1">
              {result.checklistEvaluation.results
                .filter((r) => r.fired)
                .map((r) => {
                  const signedPoints = r.category === "decrease" ? -r.points : r.points;
                  return (
                    <li key={r.itemId} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 shrink-0 font-mono text-xs font-semibold ${signedPoints > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {signedPoints > 0 ? "+" : ""}{signedPoints}
                      </span>
                      <span className="text-zinc-600 dark:text-zinc-300">
                        <span className="font-medium text-zinc-800 dark:text-zinc-100">{r.label}</span>
                        {r.reasoning && <span className="text-zinc-400 dark:text-zinc-500"> — {r.reasoning}</span>}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
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

        {canShowFraudRisk && (
          <FraudRiskChecker
            screeningId={savedId!}
            roleContext={roleContext}
            currentAssessment={fraudRisk ?? undefined}
            onComplete={async (assessment) => {
              try {
                const res = await fetch(`/api/history/${savedId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ fraudRisk: assessment }),
                });
                if (!res.ok) return false;
                setFraudRisk(assessment);
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

        {/* Activity — added 2026-07-29, bottom of card as an audit-trail
            footer, after the interactive sections above it. */}
        {canCheck && <ActivityTimeline actions={actions} candidateName={result.candidateName} />}
      </div>
    </li>
  );
}
