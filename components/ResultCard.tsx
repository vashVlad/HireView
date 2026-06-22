import type { CandidateResult } from "@/lib/types";
import { ScoreBadge } from "./ScoreBadge";

export function ResultCard({ result, rank }: { result: CandidateResult; rank: number }) {
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
          </div>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{result.fileName}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {result.summary}
          </p>

          {(result.strengths.length > 0 || result.concerns.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.strengths.map((strength) => (
                <span
                  key={strength}
                  className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                >
                  {strength}
                </span>
              ))}
              {result.concerns.map((concern) => (
                <span
                  key={concern}
                  className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                >
                  {concern}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
