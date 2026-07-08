"use client";

import { useState } from "react";

interface CalibrationButtonsProps {
  screeningId: number;
  /** Shown next to thumbs down button — how many examples for this project */
  calibrationCount?: number;
  onSaved?: (label: "good" | "bad") => void;
}

/**
 * Thumbs up / thumbs down buttons for marking a screened candidate as a
 * calibration example. Appears in the expanded pipeline card.
 *
 * Thumbs up → marks as "good" immediately.
 * Thumbs down → opens a correction modal (optional score + note), then saves as "bad".
 */
export function CalibrationButtons({ screeningId, calibrationCount, onSaved }: CalibrationButtonsProps) {
  const [saved, setSaved] = useState<"good" | "bad" | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [scoreCorrection, setScoreCorrection] = useState(50);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(label: "good" | "bad", finalNote?: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/history/${screeningId}/calibrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, note: finalNote ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save");
        setSaving(false);
        return;
      }
      setSaved(label);
      setShowModal(false);
      onSaved?.(label);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleThumbsDown() {
    setShowModal(true);
  }

  async function handleModalSubmit() {
    const correctionNote = `Score correction: should be ~${scoreCorrection}.${note.trim() ? ` Reason: ${note.trim()}` : ""}`;
    await submit("bad", correctionNote);
  }

  if (saved) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {saved === "good" ? "Saved as good example" : "Saved as poor fit example"}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Calibration count badge */}
        {calibrationCount != null && calibrationCount > 0 && (
          <span className="mr-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-400">
            {calibrationCount} example{calibrationCount !== 1 ? "s" : ""}
          </span>
        )}

        {/* Thumbs up */}
        <button
          type="button"
          title="Good fit — add as calibration example"
          onClick={() => submit("good")}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Thumbs down */}
        <button
          type="button"
          title="Poor fit — add as calibration example with correction"
          onClick={handleThumbsDown}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {error && <span className="text-[10px] text-rose-500">{error}</span>}
      </div>

      {/* Correction modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Correct the score
            </h3>
            <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
              What score should this candidate have gotten? This becomes a calibration example for future screenings.
            </p>

            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Corrected score
                </label>
                <span className="text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {scoreCorrection}
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={5}
                value={scoreCorrection}
                onChange={(e) => setScoreCorrection(Number(e.target.value))}
                className="w-full accent-violet-600"
              />
            </div>

            <div className="mb-5 flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Reason (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Missing Python but strong architecture background"
                rows={2}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-violet-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </div>

            {error && <p className="mb-3 text-xs text-rose-500">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleModalSubmit}
                disabled={saving}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save correction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
