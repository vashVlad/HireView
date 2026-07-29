"use client";

import { useState } from "react";
import Link from "next/link";
import type { CandidateResult } from "@/lib/types";

type Precheck = "idle" | "loading" | { screeningId: number; score: number } | "error";
type Preview = "idle" | "loading" | CandidateResult | "error";

/**
 * Dedicated "Transfer" button + popover, at the bottom of a Pipeline card —
 * Vlad's ask, 2026-07-29, replacing the original status-dropdown-driven
 * flow after he tested it and hit a real bug (a destination copy got
 * created but the source never flipped to "transferred" — see
 * transferScreeningToProject()'s two-step status update in
 * lib/screenings.ts for the fix), then refined twice more the same day:
 *
 * - The re-score trigger is a button, not a checkbox ("instead of a
 *   checkbox for screening add a button") — clicking it fires the preview
 *   call once; once a result comes back the button is replaced by the
 *   score itself rather than staying clickable, so there's no way to
 *   accidentally re-fire a second Claude call for the same pairing.
 * - If the candidate already has a real screening in the destination
 *   project (precheck), that score is shown immediately and the re-screen
 *   button never even renders — no tokens spent re-deriving something
 *   that's already known.
 * - If THIS screening has already been transferred somewhere, that's
 *   mentioned right here in this control's own footprint (a small link,
 *   same spot the "Transfer" button would occupy) instead of the whole
 *   control just disappearing with no explanation.
 *
 * Flow, one popover:
 *   1. Pick a destination project → fires /transfer/precheck (cheap, no
 *      Claude call). If the candidate already has a screening there, show
 *      that score directly — nothing left to decide, "Confirm" just links
 *      the original at that existing row (mode: "existing").
 *   2. If nothing existing: show the current score that would carry over
 *      as-is, plus a "Screen for this project" button. Clicking it fires
 *      /transfer/preview (a real scoreCandidate call against the
 *      destination JD, not saved yet) and shows the resulting score.
 *   3. "Confirm" commits via /transfer — mode "copy" (never screened) or
 *      "rescore" (screened via step 2, round-trips the exact preview
 *      result back so scoring never runs twice).
 */
export function TransferControl({
  screeningId,
  transferProjects,
  alreadyTransferred,
  onTransferred,
}: {
  screeningId: number;
  /** Projects this recruiter/admin can transfer INTO — already scoped by the caller (recruiter: own team only, admin: everything — GET /api/projects via teamIdsFilter, see lib/auth.ts), current project already excluded. */
  transferProjects: { id: number; name: string }[];
  /** Set when this exact screening has already been transferred — renders a small mention/link in place of the Transfer button instead of hiding this control entirely. */
  alreadyTransferred?: { projectName?: string; screeningId?: number } | null;
  onTransferred: (result: { newScreeningId: number; transferredToProjectId: number; transferredToProjectName: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<number | "">("");
  const [precheck, setPrecheck] = useState<Precheck>("idle");
  const [preview, setPreview] = useState<Preview>("idle");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProjectId("");
    setPrecheck("idle");
    setPreview("idle");
    setConfirming(false);
    setError(null);
  }

  async function handlePickProject(id: number) {
    setProjectId(id);
    setPreview("idle");
    setError(null);
    setPrecheck("loading");
    try {
      const res = await fetch(`/api/history/${screeningId}/transfer/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Precheck failed");
      setPrecheck(data.existing ? { screeningId: data.existing.screeningId, score: data.existing.score } : "idle");
    } catch {
      setPrecheck("error");
    }
  }

  async function handleScreenNow() {
    if (typeof projectId !== "number") return;
    setPreview("loading");
    try {
      const res = await fetch(`/api/history/${screeningId}/transfer/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Screening failed");
      setPreview(data.result);
    } catch {
      setPreview("error");
    }
  }

  async function handleConfirm() {
    if (typeof projectId !== "number") return;
    setConfirming(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { projectId };
      if (precheck !== "idle" && precheck !== "loading" && precheck !== "error") {
        body.mode = "existing";
        body.existingScreeningId = precheck.screeningId;
      } else if (preview !== "idle" && preview !== "loading" && preview !== "error") {
        body.mode = "rescore";
        body.previewResult = preview;
      } else {
        body.mode = "copy";
      }
      const res = await fetch(`/api/history/${screeningId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Transfer failed");
      onTransferred({
        newScreeningId: data.newScreeningId,
        transferredToProjectId: data.transferredToProjectId,
        transferredToProjectName: data.transferredToProjectName,
      });
      setOpen(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setConfirming(false);
    }
  }

  // Already transferred — mention it right here instead of hiding this
  // control with no trace. Not an interactive re-transfer flow (none
  // exists yet), just a small link matching where the Transfer button
  // would otherwise sit.
  if (alreadyTransferred) {
    return (
      <Link
        href={alreadyTransferred.screeningId != null ? `/candidates/${alreadyTransferred.screeningId}` : "#"}
        onClick={(e) => e.stopPropagation()}
        title={`Already transferred to "${alreadyTransferred.projectName ?? "another project"}"`}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 8l4 4-4 4M3 12h18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Transferred to {alreadyTransferred.projectName ?? "another project"}
      </Link>
    );
  }

  const hasExisting = precheck !== "idle" && precheck !== "loading" && precheck !== "error";
  const previewReady = preview !== "idle" && preview !== "loading" && preview !== "error";
  const canConfirm = typeof projectId === "number" && precheck !== "loading" && preview !== "loading";

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          if (open) reset();
          setOpen((o) => !o);
        }}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 8l4 4-4 4M3 12h18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Transfer
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Transfer to project
          </p>
          <select
            value={projectId}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) handlePickProject(id);
            }}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-sky-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          >
            <option value="" disabled>Choose a project…</option>
            {transferProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {precheck === "loading" && (
            <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">Checking…</p>
          )}
          {precheck === "error" && (
            <p className="mt-2 text-xs text-rose-500">Couldn't check that project — try again.</p>
          )}

          {/* Already has a real screening there — the score is shown
              immediately from the free precheck lookup, no Claude call
              spent re-deriving something already known. Nothing left to
              pick: Confirm just points the original at this existing row. */}
          {hasExisting && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Already screened there — score <span className="font-semibold text-zinc-700 dark:text-zinc-200">{(precheck as { score: number }).score}</span>.
              This will just point here at that result, no new copy.
            </p>
          )}

          {typeof projectId === "number" && precheck === "idle" && (
            <div className="mt-2.5 flex flex-col gap-2">
              {!previewReady && preview !== "loading" && (
                <button
                  type="button"
                  onClick={handleScreenNow}
                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  Screen for this project
                </button>
              )}
              {preview === "loading" && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Screening…</p>
              )}
              {preview === "error" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-rose-500">Screening failed.</span>
                  <button type="button" onClick={handleScreenNow} className="text-xs font-medium text-sky-600 underline dark:text-sky-400">Try again</button>
                </div>
              )}
              {previewReady && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  New score: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{(preview as CandidateResult).score}</span>
                </p>
              )}
              {!previewReady && preview !== "loading" && preview !== "error" && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Or leave unscreened — Confirm will just carry the candidate's current score over as-is.</p>
              )}
            </div>
          )}

          {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm || confirming}
              onClick={handleConfirm}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? "Transferring…" : "Confirm transfer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
