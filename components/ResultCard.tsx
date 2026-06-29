"use client";

import { useState, useRef } from "react";
import type { CandidateResult, CandidateStatus, CredibilityAssessment } from "@/lib/types";

import { CredibilityChecker } from "./CredibilityChecker";
import { CredibilitySection } from "./CredibilitySection";
import { InsightList } from "./InsightList";
import { QuestionGenerator } from "./QuestionGenerator";
import { RecommendationBadge } from "./RecommendationBadge";
import { ScoreBadge } from "./ScoreBadge";
import { StatusSelect } from "./StatusSelect";

// ── Main ResultCard ─────────────────────────────────────────────────────────

export function ResultCard({
  result,
  rank,
  roleContext,
  onStatusChange,
  solo = false,
}: {
  result: CandidateResult;
  rank: number;
  roleContext?: string;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  solo?: boolean;
}) {
  const [credibility, setCredibility] = useState<CredibilityAssessment | null>(
    result.credibility ?? null
  );
  const [showChecker, setShowChecker] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [trajectoryOpen, setTrajectoryOpen] = useState(true);
  const trajectoryRef = useRef<HTMLDivElement>(null);

  const canCheck = result.id !== undefined;

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
          {result.id !== undefined && result.status !== undefined && onStatusChange && (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusSelect
                status={result.status}
                onChange={(status) => onStatusChange(result.id!, status)}
              />
            </div>
          )}
          {(result.mustHaveScore !== undefined || result.niceToHaveScore !== undefined) && (
            <div className="flex items-center justify-center gap-1.5">
              {result.mustHaveScore !== undefined && (
                <span className={`inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Must-have {result.mustHaveScore}
                </span>
              )}
              {result.niceToHaveScore !== undefined && (
                <span className={`inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400 ${solo ? "text-sm" : "text-xs"}`}>
                  Nice-to-have {result.niceToHaveScore}
                </span>
              )}
            </div>
          )}
          <p className={`text-zinc-400 dark:text-zinc-500 ${solo ? "text-sm" : "text-xs"}`}>{result.fileName}</p>
        </div>
      </div>
      <p className={`mt-4 leading-relaxed text-zinc-600 dark:text-zinc-300 ${solo ? "text-base" : "text-sm"}`}>
        {result.summary}
      </p>

      {/* Full-width sections below the header row */}
      <div className={`flex flex-col ${solo ? "mt-6 gap-4" : "mt-4 gap-3"}`}>
        <InsightList label="Strengths" items={result.strengths} variant="positive" />
        <InsightList label="Concerns" items={result.concerns} variant="warning" screeningId={result.id} />
        {result.careerTrajectory && !credibility && (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setTrajectoryOpen((v) => !v)}
              className="flex items-center gap-2 py-1 text-left"
            >
              <span className={`text-xs font-semibold uppercase tracking-wide transition-colors ${trajectoryOpen ? "text-zinc-600 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-500"}`}>
                Career trajectory
              </span>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`ml-auto shrink-0 text-zinc-400 transition-transform duration-200 ${trajectoryOpen ? "rotate-90" : ""}`}
              >
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div
              ref={trajectoryRef}
              className="grid transition-[grid-template-rows] duration-200 ease-in-out"
              style={{ gridTemplateRows: trajectoryOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <p className="pt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {result.careerTrajectory}
                </p>
              </div>
            </div>
          </div>
        )}

        {credibility && <CredibilitySection assessment={credibility} />}

        {canCheck && !credibility && (
          <>
            <button
              type="button"
              onClick={() => setShowChecker((v) => !v)}
              className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                showChecker
                  ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400"
                  : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:border-violet-500/50 dark:hover:bg-violet-500/10 dark:hover:text-violet-400"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              Check credibility
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-in-out"
              style={{ gridTemplateRows: showChecker ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <CredibilityChecker
                  screeningId={result.id!}
                  roleContext={roleContext}
                  onComplete={(assessment) => {
                    setCredibility(assessment);
                    setShowChecker(false);
                    fetch(`/api/history/${result.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ credibility: assessment }),
                    }).catch(() => {});
                  }}
                />
              </div>
            </div>
          </>
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
                <QuestionGenerator screeningId={result.id!} />
              </div>
            </div>
          </>
        )}
      </div>
    </li>
  );
}
