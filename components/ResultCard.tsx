import type { CandidateResult, CandidateStatus } from "@/lib/types";
import { InsightList } from "./InsightList";
import { RecommendationBadge } from "./RecommendationBadge";
import { ScoreBadge } from "./ScoreBadge";
import { StatusSelect } from "./StatusSelect";

export function ResultCard({
  result,
  rank,
  onStatusChange,
}: {
  result: CandidateResult;
  rank: number;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
}) {
  return (
    <li className="animate-fade-in-up rounded-2xl border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-4">
        <ScoreBadge score={result.score} />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">#{rank}</span>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {result.candidateName}
            </h3>
            <RecommendationBadge recommendation={result.recommendation} />
            {result.id !== undefined && result.status !== undefined && onStatusChange && (
              <div onClick={(e) => e.stopPropagation()}>
                <StatusSelect
                  status={result.status}
                  onChange={(status) => onStatusChange(result.id!, status)}
                />
              </div>
            )}
          </div>
          {(result.mustHaveScore !== undefined || result.niceToHaveScore !== undefined) && (
            <div className="flex items-center gap-1.5">
              {result.mustHaveScore !== undefined && (
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  Must-have {result.mustHaveScore}
                </span>
              )}
              {result.niceToHaveScore !== undefined && (
                <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
                  Nice-to-have {result.niceToHaveScore}
                </span>
              )}
            </div>
          )}
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{result.fileName}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {result.summary}
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <InsightList label="Strengths" items={result.strengths} variant="positive" />
            <InsightList label="Concerns" items={result.concerns} variant="warning" />
          </div>
        </div>
      </div>
    </li>
  );
}
