"use client";

import { useState } from "react";
import Link from "next/link";
import type { CandidateResult } from "@/lib/types";

type Precheck = "idle" | "loading" | { screeningId: number; score: number } | "error";
type Preview = "idle" | "loading" | CandidateResult | "error";
type Mode = "copy" | "rescore" | "existing";

/**
 * Dedicated "Transfer" button + popover, at the bottom of a Pipeline card —
 * Vlad's ask, 2026-07-29, replacing the original status-dropdown-driven
 * flow after he tested it and hit a real bug (a destination copy got
 * created but the source never flipped to "transferred" — see
 * transferScreeningToProject()'s two-step status update in
 * lib/screenings.ts for the fix), then refined further the same day:
 *
 * - The re-score trigger is a button, not a checkbox.
 * - If the candidate already has a real screening in the destination
 *   project (precheck), that score is shown immediately — no Claude call
 *   spent re-deriving something already known.
 * - If THIS screening has already been transferred somewhere, that's
 *   mentioned right here (the button's own label, plus a note + view link
 *   inside the popover) instead of the whole control disappearing — and
 *   the control STAYS fully usable, so transferring again to a different
 *   project is a normal, supported flow (Vlad's ask, 2026-07-29: "when I
 *   try to press transfer to another project it doesn't do anything" —
 *   an earlier version hard-stopped here with a plain, non-reopenable
 *   link). The backend needs no changes to support this: every call
 *   already overwrites the pointer columns and re-sets status, whether
 *   this is the first transfer or the third.
 * - No separate "Confirm transfer" step after screening — Vlad's ask:
 *   "I assume during the screening the candidate is being transferred
 *   already so there's no need for the confirm transfer button." Each path
 *   is now exactly one button that does the whole thing:
 *     - "Screen & transfer" runs /transfer/preview (a real scoreCandidate
 *       call against the destination JD) and, the moment that result comes
 *       back, immediately commits via /transfer (mode: "rescore",
 *       round-tripping that exact result so scoring never runs twice) —
 *       one click, no second confirmation gate.
 *     - "Transfer with current score" commits immediately with the
 *       candidate's own existing result (mode: "copy").
 *     - When the candidate already has a screening in the destination,
 *       the single button just links the original at it (mode: "existing").
 *   If the commit step itself fails after a real re-score already
 *   succeeded, the computed score is kept so "Retry transfer" doesn't burn
 *   a second Claude call re-deriving the same number.
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
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProjectId("");
    setPrecheck("idle");
    setPreview("idle");
    setCommitting(false);
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

  // Single commit path shared by all three modes — the only place that
  // actually calls /transfer. `payload` is the existing screening id for
  // "existing", the freshly-scored result for "rescore", or unused for
  // "copy".
  async function commitTransfer(mode: Mode, payload?: number | CandidateResult) {
    if (typeof projectId !== "number") return;
    setCommitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { projectId, mode };
      if (mode === "existing") body.existingScreeningId = payload;
      if (mode === "rescore") body.previewResult = payload;
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
      setCommitting(false);
    }
  }

  // Screens for the destination project, then immediately transfers with
  // that exact result — no separate confirm click. If scoring itself
  // fails, nothing has committed yet, so "Try again" just re-screens. If
  // scoring succeeds but the commit call fails, `preview` already holds
  // the computed result, so "Retry transfer" (rendered below) reuses it
  // instead of re-running scoreCandidate.
  async function handleScreenAndTransfer() {
    if (typeof projectId !== "number") return;
    setError(null);
    setPreview("loading");
    let result: CandidateResult;
    try {
      const res = await fetch(`/api/history/${screeningId}/transfer/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Screening failed");
      result = data.result;
      setPreview(result);
    } catch (err) {
      setPreview("error");
      setError(err instanceof Error ? err.message : "Screening failed");
      return;
    }
    await commitTransfer("rescore", result);
  }

  const hasExisting = precheck !== "idle" && precheck !== "loading" && precheck !== "error";
  const previewReady = preview !== "idle" && preview !== "loading" && preview !== "error";

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => {
          if (open) reset();
          setOpen((o) => !o);
        }}
        title={alreadyTransferred ? `Already transferred to "${alreadyTransferred.projectName ?? "another project"}" — click to transfer somewhere else` : undefined}
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 8l4 4-4 4M3 12h18" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {alreadyTransferred ? `Transferred to ${alreadyTransferred.projectName ?? "another project"}` : "Transfer"}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {/* Vlad's ask, 2026-07-29: clicking this used to do nothing once
              a screening was already transferred — the control used to
              hard-stop and render a plain, non-reopenable Link instead of
              this popover. Now it stays fully usable afterward too: this
              note just adds context (where it currently is, with a way to
              view it) above the same picker, so transferring again to a
              DIFFERENT project is a normal, supported flow — the backend
              already re-points the pointer columns and status on every
              call, nothing DB-side needed to allow this. */}
          {alreadyTransferred && (
            <p className="mb-2 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              Currently transferred to <span className="font-semibold text-zinc-700 dark:text-zinc-200">{alreadyTransferred.projectName ?? "another project"}</span>
              {alreadyTransferred.screeningId != null && (
                <Link href={`/candidates/${alreadyTransferred.screeningId}`} onClick={(e) => e.stopPropagation()} className="underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200">
                  · View
                </Link>
              )}
            </p>
          )}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            {alreadyTransferred ? "Transfer to a different project" : "Transfer to project"}
          </p>
          <select
            value={projectId}
            disabled={committing}
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) handlePickProject(id);
            }}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-sky-300 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
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
              spent re-deriving something already known. One button, no
              separate confirm step: it just points the original at this
              existing row. */}
          {hasExisting && (
            <div className="mt-2.5 flex flex-col gap-2">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Already screened there — score <span className="font-semibold text-zinc-700 dark:text-zinc-200">{(precheck as { score: number }).score}</span>. No new copy needed.
              </p>
              <button
                type="button"
                disabled={committing}
                onClick={() => commitTransfer("existing", (precheck as { screeningId: number }).screeningId)}
                className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {committing ? "Transferring…" : "Transfer to that result"}
              </button>
              {error && <p className="text-xs text-rose-500">{error}</p>}
            </div>
          )}

          {typeof projectId === "number" && precheck === "idle" && (
            <div className="mt-2.5 flex flex-col gap-2">
              {preview === "idle" && (
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => commitTransfer("copy")}
                  className="text-left text-xs font-medium text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  {committing ? "Transferring…" : "Or transfer with the current score as-is"}
                </button>
              )}
              {preview === "loading" && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Screening…</p>
              )}
              {preview === "error" && (
                <div className="flex items-center gap-2">
                  {/* Real message from the server, not a hardcoded generic
                      string — a genuine bug found 2026-07-29 alongside the
                      similar server-side one (see lib/errorMessage.ts):
                      this branch used to always show "Screening failed."
                      regardless of what `error` actually held. */}
                  <span className="text-xs text-rose-500">{error ?? "Screening failed."}</span>
                  <button type="button" onClick={handleScreenAndTransfer} className="text-xs font-medium text-sky-600 underline dark:text-sky-400">Try again</button>
                </div>
              )}
              {previewReady && committing && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Transferring…</p>
              )}
              {previewReady && !committing && error && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    New score: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{(preview as CandidateResult).score}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-rose-500">{error}</span>
                    <button
                      type="button"
                      onClick={() => commitTransfer("rescore", preview as CandidateResult)}
                      className="text-xs font-medium text-sky-600 underline dark:text-sky-400"
                    >
                      Retry transfer
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Only for the "copy" (transfer with current score) commit
              failing — every other error case (screening itself failing,
              or the commit failing after a real re-score) already renders
              its own inline message above, right next to its own retry
              action, so this must not also fire for those or the same
              message would show twice. */}
          {!hasExisting && precheck !== "loading" && preview === "idle" && error && (
            <p className="mt-2 text-xs text-rose-500">{error}</p>
          )}

          {/* Screen & transfer lives at the bottom of the popover, next to
              Cancel — Vlad's ask: keep the primary action in the same
              footer spot the other confirmation buttons used to sit in,
              rather than up in the middle of the options list. Only shows
              once a destination with nothing existing there is picked and
              before a screen is actually in flight/committed. */}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); }}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            {typeof projectId === "number" && precheck === "idle" && preview === "idle" && (
              <button
                type="button"
                disabled={committing}
                onClick={handleScreenAndTransfer}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Screen &amp; transfer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
