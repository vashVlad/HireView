"use client";

import { useState } from "react";
import { FRAUD_PATTERN_TYPE_LABELS, type FraudRiskAssessment, type FraudRiskLevel } from "@/lib/types";

const RISK_CONFIG: Record<FraudRiskLevel, { label: string; className: string; dot: string }> = {
  low: { label: "Low risk", className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400", dot: "bg-emerald-400" },
  moderate: { label: "Moderate risk", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400", dot: "bg-amber-400" },
  high: { label: "High risk", className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400", dot: "bg-rose-400" },
};

function WarningIcon({ className }: { className: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className}>
      <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FraudRiskSummary({ assessment }: { assessment: FraudRiskAssessment }) {
  const cfg = RISK_CONFIG[assessment.overallRisk];
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-100 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
        <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">{assessment.riskScore}% fraud risk</span>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{assessment.summary}</p>

      {assessment.signals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {assessment.signals.map((s, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border-l-2 border-amber-300 bg-amber-50/60 px-2.5 py-2 dark:border-amber-500/50 dark:bg-amber-500/6">
              <span className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400"><WarningIcon className="" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">{FRAUD_PATTERN_TYPE_LABELS[s.patternType]}</span>
                  <span className="text-zinc-400 dark:text-zinc-500">— &ldquo;{s.claimText}&rdquo;</span>
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{s.explanation}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type CheckState = "idle" | "checking" | "error";

interface FraudRiskCheckerProps {
  screeningId: number;
  roleContext?: string;
  currentAssessment?: FraudRiskAssessment;
  /**
   * Same success/failure reporting contract as CrossReferenceChecker's
   * onComplete (components/CredibilityChecker.tsx) — return whether the
   * result actually persisted so a dropped save shows up in the UI instead
   * of silently vanishing on reload.
   */
  onComplete: (assessment: FraudRiskAssessment) => void | boolean | Promise<boolean>;
}

/**
 * Manual-trigger fraud risk check, mirroring CrossReferenceChecker's UX —
 * Vlad's ask, 2026-07-29: kept opt-in (never runs inside batch screening)
 * so a slow or failed check can only ever error this one check, never a
 * whole batch. Unlike CrossReferenceChecker, there's no file to pick: this
 * checks the candidate's OWN already-stored resume against the system-wide
 * fraud_calibration_examples library, so the only input is the click
 * itself. Only ever rendered when score >= 75 (see ResultCard.tsx) — a
 * candidate that didn't score well doesn't need this, its problems are
 * already visible.
 */
export function FraudRiskChecker({ screeningId, roleContext, currentAssessment, onComplete }: FraudRiskCheckerProps) {
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Same "completed but not yet saved" split as CrossReferenceChecker's
  // unsavedAssessment — see that component's doc comment.
  const [unsavedAssessment, setUnsavedAssessment] = useState<FraudRiskAssessment | null>(null);

  const displayAssessment = unsavedAssessment ?? currentAssessment;

  async function reportComplete(assessment: FraudRiskAssessment): Promise<boolean> {
    const result = onComplete(assessment);
    return result === undefined ? true : await result;
  }

  async function runCheck() {
    if (checkState === "checking") return;
    setCheckState("checking");
    setError(null);

    // Client-side timeout matching CrossReferenceChecker's — just under this
    // route's own maxDuration=60 ceiling, so a hung request always resolves
    // to a clear, actionable error instead of spinning forever.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55_000);

    try {
      const res = await fetch("/api/assess-fraud-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screeningId, roleContext }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Fraud risk check failed");
      }
      const data = await res.json();
      const assessment = data.assessment as FraudRiskAssessment;
      const saved = await reportComplete(assessment);
      if (saved) {
        setCheckState("idle");
        setUnsavedAssessment(null);
      } else {
        setUnsavedAssessment(assessment);
        setCheckState("error");
        setError("Check completed, but the result couldn't be saved — it will be lost on reload. Retry saving below.");
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "AbortError";
      setError(
        timedOut
          ? "Fraud risk check timed out — try again."
          : err instanceof Error
          ? err.message
          : "Unknown error"
      );
      setCheckState("error");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function retrySave() {
    if (!unsavedAssessment || checkState === "checking") return;
    setCheckState("checking");
    const saved = await reportComplete(unsavedAssessment);
    if (saved) {
      setUnsavedAssessment(null);
      setCheckState("idle");
      setError(null);
    } else {
      setCheckState("error");
      setError("Still couldn't save — check your connection and try again.");
    }
  }

  if (displayAssessment) {
    return (
      <div className="flex flex-col gap-3">
        <div className="relative">
          <FraudRiskSummary assessment={displayAssessment} />
          {checkState === "checking" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 dark:bg-zinc-900/70">
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
                {unsavedAssessment ? "Saving…" : "Re-checking…"}
              </div>
            </div>
          )}
        </div>

        {unsavedAssessment && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-xs text-rose-700 dark:text-rose-400">Not saved yet — will be lost if you leave this page.</p>
            <button
              type="button"
              onClick={retrySave}
              disabled={checkState === "checking"}
              className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkState === "checking" ? "Saving…" : "Retry save"}
            </button>
          </div>
        )}

        {error && !unsavedAssessment && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={runCheck}
          disabled={checkState === "checking"}
          className="flex items-center justify-center gap-2 self-start rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 transition-all hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {checkState === "checking" ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
              Checking…
            </>
          ) : (
            "Re-run fraud risk check"
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
      <button
        type="button"
        onClick={runCheck}
        disabled={checkState === "checking"}
        className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {checkState === "checking" ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white dark:border-zinc-900/40 dark:border-t-zinc-900" />
            Checking…
          </>
        ) : (
          "Run fraud risk check"
        )}
      </button>
    </div>
  );
}
