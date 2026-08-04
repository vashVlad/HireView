"use client";

import { useEffect, useState } from "react";
import { ARCHIVE_REASONS, FRAUD_PATTERN_TYPES, FRAUD_PATTERN_TYPE_LABELS, type FraudCalibrationExample, type FraudPatternType } from "@/lib/types";

interface ClaimDraft {
  claimText: string;
  explanation: string;
}

const OTHER = "__other__";

/**
 * Placed directly beneath the "Move to stage" chip row in the Tracker
 * drawer, shown only when Reject is the active stage — Vlad's ask,
 * 2026-07-29: "I want to have that rejection card input right beneath the
 * rejection chip."
 *
 * Replaces the old free-text-only "Rejection reason" textarea that used to
 * live inside DrawerBody (originally Teti's request, 2026-07-10 — capture
 * why a candidate was rejected so a recruiter can see it later if they
 * apply again; still writes to the same tracker.reject_reason column).
 * Reason is now either one of the existing
 * ARCHIVE_REASONS (reused here for a consistent, familiar list rather than
 * inventing a second one) or a manual "Other" free-text entry — Vlad's ask.
 * The reason itself still saves to the same tracker.reject_reason field as
 * before; nothing about where it's stored changed, only how it's entered.
 *
 * The "Suspected fraud" checkbox is new: checking it reveals a pattern-type
 * picker and one or more structured claim entries (the specific fabricated
 * point + why it was confirmed fabricated). Saving with the checkbox on
 * POSTs those to /api/fraud-calibration, which pulls this candidate's
 * already-stored resume server-side (no re-upload) and adds it to the
 * system-wide fraud_calibration_examples library that
 * lib/assessFraudRisk.ts few-shots against for future candidates. This is
 * deliberately best-effort and silent on failure (mirrors that route's own
 * fail-open design) — a fraud-calibration save failure must never block
 * saving the rejection reason itself.
 *
 * Collapses to a compact "Rejection submitted" confirmation after a
 * successful save, 2026-08-02 (Vlad's ask: "I want the tab to close up and
 * say reject submitted... instead of staying open as if nothing happened").
 * An "Edit" link reopens the full form. Also starts collapsed on mount
 * whenever a reason was already saved previously (reopening the drawer for
 * an already-rejected candidate) — the full form re-appearing every time
 * read as "nothing was saved" even when it was.
 */
export function RejectionCard({
  screeningId,
  initialReason,
  onSaveReason,
}: {
  screeningId: number;
  initialReason: string;
  /**
   * Delegates the reject_reason PATCH to the caller (TrackerTab's existing
   * onTrackerDataChange) instead of this component making its own fetch —
   * keeps trackerData's in-memory copy and the DB in sync through the same
   * single code path every other tracker field already uses, so reopening
   * this drawer later reflects what was just saved.
   */
  onSaveReason: (reason: string) => void;
}) {
  const initialIsKnown = (ARCHIVE_REASONS as readonly string[]).includes(initialReason);
  const [reasonChoice, setReasonChoice] = useState<string>(
    initialReason ? (initialIsKnown ? initialReason : OTHER) : ""
  );
  const [otherText, setOtherText] = useState(initialIsKnown ? "" : initialReason);
  const [isFraud, setIsFraud] = useState(false);
  const [patternType, setPatternType] = useState<FraudPatternType>("fabricated_experience");
  const [claims, setClaims] = useState<ClaimDraft[]>([{ claimText: "", explanation: "" }]);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(!!initialReason);

  // Looks up whether THIS candidate's rejection was already flagged as
  // fraud in a previous session — added 2026-08-04 (Vlad's ask: "make sure
  // that I can see fraud reason when I try to edit a rejected candidate
  // from the tracker drawer"). Before this, the collapsed "Rejection
  // submitted" confirmation's "— fraud flagged" suffix only ever reflected
  // `isFraud`'s own component-local state, which resets to false on every
  // remount — so reopening the drawer for an already-fraud-flagged
  // candidate silently dropped that information, even though it was saved
  // correctly server-side (fraud_calibration_examples.source_screening_id).
  const [savedFraudExample, setSavedFraudExample] = useState<FraudCalibrationExample | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!initialReason) return;
    fetch(`/api/fraud-calibration?screeningId=${screeningId}`)
      .then((res) => (res.ok ? res.json() : { example: null }))
      .then((data) => {
        if (!cancelled) setSavedFraudExample(data.example ?? null);
      })
      .catch(() => {
        // Non-fatal — the rest of the rejection card still works without this.
      });
    return () => {
      cancelled = true;
    };
  }, [screeningId, initialReason]);

  const finalReason = reasonChoice === OTHER ? otherText.trim() : reasonChoice;
  const showsFraudFlagged = isFraud || savedFraudExample != null;

  function updateClaim(index: number, field: keyof ClaimDraft, value: string) {
    setClaims((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }

  function addClaim() {
    setClaims((prev) => [...prev, { claimText: "", explanation: "" }]);
  }

  function removeClaim(index: number) {
    setClaims((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    try {
      onSaveReason(finalReason);

      if (isFraud) {
        const validClaims = claims.filter((c) => c.claimText.trim().length > 0);
        if (validClaims.length > 0) {
          const res = await fetch("/api/fraud-calibration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ screeningId, patternType, claims: validClaims }),
          }).catch(() => null);
          // Optimistic — mirrors the shape getFraudCalibrationExampleByScreeningId
          // would return, so the collapsed summary below shows this save
          // immediately instead of waiting on a refetch that might not even
          // happen again this mount (the lookup effect only runs once, keyed
          // off `initialReason` at mount time).
          if (res?.ok) {
            const data = await res.json().catch(() => null);
            if (data?.example) setSavedFraudExample(data.example);
          }
        }
      }
      setSubmitted(true);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-zinc-700 placeholder-zinc-400 focus:border-rose-400 focus:outline-none dark:border-rose-500/30 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder-zinc-500";
  const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500";

  if (submitted) {
    return (
      <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-emerald-600 dark:text-emerald-400">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {showsFraudFlagged ? "Rejection submitted — fraud flagged" : "Rejection submitted"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="shrink-0 text-xs font-medium text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Edit
            </button>
          </div>
          {/* Read-only fraud reason summary, 2026-08-04 (Vlad's ask) — the
              whole point of surfacing this here is so reopening the drawer
              later actually shows WHY it was flagged, not just that it was.
              Deliberately not the full editable pattern-type-dropdown-plus-
              N-textareas form from below; that's for entering new claims,
              this is for reading ones already on file — a plain, compact
              summary matches how every other "signal" in this app displays
              (e.g. FraudRiskChecker's own summary card, credibility's
              SIGNAL_BADGE), rather than reopening a heavy input form just
              to look at something. */}
          {savedFraudExample && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-rose-200 bg-white/70 p-2.5 dark:border-rose-500/25 dark:bg-black/10">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Fraud reason — {FRAUD_PATTERN_TYPE_LABELS[savedFraudExample.patternType]}
              </p>
              {savedFraudExample.claims.map((c, i) => (
                <p key={i} className="text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">&ldquo;{c.claimText}&rdquo;</span>
                  {c.explanation && <> — {c.explanation}</>}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
        <div className="mb-1.5 flex items-center justify-between">
          <p className={labelCls}>Rejection reason</p>
          {saving && <span className="text-[10px] text-zinc-400">Saving…</span>}
        </div>

        <select
          value={reasonChoice}
          onChange={(e) => setReasonChoice(e.target.value)}
          className={`${inputCls} cursor-pointer`}
        >
          <option value="" disabled>Select a reason…</option>
          {ARCHIVE_REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>

        {reasonChoice === OTHER && (
          <textarea
            rows={2}
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Describe why this candidate was rejected — visible system-wide if they apply again"
            className={`mt-2 resize-none ${inputCls}`}
          />
        )}

        {/* Suspected fraud */}
        <label className="mt-3 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isFraud}
            onChange={(e) => setIsFraud(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer rounded border-rose-300 text-rose-600 focus:ring-rose-400"
          />
          <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">Suspected fraud — add to calibration library</span>
        </label>

        {isFraud && (
          <div className="mt-2.5 flex flex-col gap-2.5 rounded-lg border border-rose-200 bg-white/60 p-2.5 dark:border-rose-500/20 dark:bg-black/10">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-500 dark:text-rose-400">Pattern type</p>
              <select
                value={patternType}
                onChange={(e) => setPatternType(e.target.value as FraudPatternType)}
                className={`${inputCls} cursor-pointer`}
              >
                {FRAUD_PATTERN_TYPES.map((p) => (
                  <option key={p} value={p}>{FRAUD_PATTERN_TYPE_LABELS[p]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500 dark:text-rose-400">Specific fabricated claims</p>
              {claims.map((claim, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-rose-100 bg-rose-50/50 p-2 dark:border-rose-500/15 dark:bg-rose-500/5">
                  <div className="flex items-start gap-1.5">
                    <textarea
                      rows={2}
                      value={claim.claimText}
                      onChange={(e) => updateClaim(i, "claimText", e.target.value)}
                      placeholder='Claim as it appears on the resume, e.g. "Senior Engineer at Google, 2019-2022"'
                      className={`min-w-0 flex-1 resize-none ${inputCls}`}
                    />
                    {claims.length > 1 && (
                      <button type="button" onClick={() => removeClaim(i)}
                        title="Remove"
                        className="mt-1 shrink-0 text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    value={claim.explanation}
                    onChange={(e) => updateClaim(i, "explanation", e.target.value)}
                    placeholder="How this was confirmed fabricated (from the interview)"
                    className={`resize-none ${inputCls}`}
                  />
                </div>
              ))}
              <button type="button" onClick={addClaim}
                className="self-start text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300">
                + Add another claim
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || (reasonChoice === OTHER && !otherText.trim()) || !reasonChoice}
          className="mt-3 w-full rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save rejection
        </button>
      </div>
    </div>
  );
}
