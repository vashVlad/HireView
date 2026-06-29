"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreeningRecord, TrackerEntry, TrackerStage } from "@/lib/types";
import { TRACKER_STAGES } from "@/lib/types";
import { SiteHeader } from "@/components/SiteHeader";
import { CredibilitySection } from "@/components/CredibilitySection";

// ── Candidate drawer ──────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
    : score >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
    : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${color}`}>
      {score}
    </span>
  );
}

function CandidateDrawer({
  screeningId,
  onClose,
}: {
  screeningId: number | null;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<ScreeningRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (screeningId === null) { setRecord(null); return; }
    setLoading(true);
    fetch(`/api/history/${screeningId}`)
      .then((r) => r.json())
      .then((d) => setRecord(d.screening ?? null))
      .catch(() => setRecord(null))
      .finally(() => setLoading(false));
  }, [screeningId]);

  const open = screeningId !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 dark:bg-black/40 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 dark:bg-zinc-950 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {record?.candidateName ?? "Candidate"}
          </span>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
            </div>
          )}

          {!loading && record && (
            <div className="flex flex-col gap-5">
              {/* Score + recommendation */}
              <div className="flex items-center gap-3">
                <ScoreBadge score={record.score} />
                {record.recommendation && (
                  <span className={`text-xs font-medium uppercase tracking-wide ${
                    record.recommendation === "proceed"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-500 dark:text-red-400"
                  }`}>
                    {record.recommendation === "proceed" ? "Proceed" : "Decline"}
                  </span>
                )}
                {record.mustHaveScore != null && (
                  <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                    Must-have {record.mustHaveScore} · Nice-to-have {record.niceToHaveScore ?? "—"}
                  </span>
                )}
              </div>

              {/* Summary */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Summary</p>
                <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{record.summary}</p>
              </div>

              {/* Career trajectory */}
              {record.careerTrajectory && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Career trajectory</p>
                  <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{record.careerTrajectory}</p>
                </div>
              )}

              {/* Strengths */}
              {record.strengths.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Strengths</p>
                  <ul className="flex flex-col gap-1.5">
                    {record.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="mt-0.5 shrink-0 text-emerald-500">✓</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Concerns */}
              {record.concerns.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Concerns</p>
                  <ul className="flex flex-col gap-1.5">
                    {record.concerns.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Credibility */}
              {record.credibility && (
                <CredibilitySection assessment={record.credibility} />
              )}

              {/* Notes */}
              {record.notes && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Notes</p>
                  <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{record.notes}</p>
                </div>
              )}

              {/* Resume */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Resume</p>
                {record.resumeMimeType === "application/pdf" ? (
                  <iframe
                    src={`/api/history/${record.id}/resume`}
                    className="h-[520px] w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
                    title="Resume"
                  />
                ) : (
                  <a
                    href={`/api/history/${record.id}/resume`}
                    download={record.fileName}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 4v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Download {record.fileName}
                  </a>
                )}
              </div>
            </div>
          )}

          {!loading && !record && open && (
            <p className="py-20 text-center text-sm text-zinc-400">Could not load candidate.</p>
          )}
        </div>
      </div>
    </>
  );
}

const STAGE_COLORS: Record<TrackerStage, string> = {
  TA: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  L1: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  L2: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "In-Person": "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  Offer: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  Reject: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
};

function patchTracker(screeningId: number, fields: Record<string, unknown>) {
  fetch(`/api/tracker/${screeningId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }).catch(() => {});
}

function Cell({
  value,
  onCommit,
  placeholder,
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`w-full bg-transparent text-sm text-zinc-700 placeholder:text-zinc-300 focus:outline-none dark:text-zinc-200 dark:placeholder:text-zinc-600 ${className}`}
    />
  );
}

function TrackerRow({
  index,
  entry,
  onUpdate,
  onOpenCard,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  index: number;
  entry: TrackerEntry;
  onUpdate: (u: TrackerEntry) => void;
  onOpenCard: (id: number) => void;
  onDragStart: (id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (id: number) => void;
  isDragOver: boolean;
}) {
  const [local, setLocal] = useState(entry);
  const trRef = useRef<HTMLTableRowElement>(null);

  function update(fields: Partial<TrackerEntry>) {
    const updated = { ...local, ...fields };
    setLocal(updated);
    onUpdate(updated);
    const payload: Record<string, unknown> = {};
    if (fields.stage !== undefined) payload.stage = fields.stage;
    if (fields.leverId !== undefined) payload.leverId = fields.leverId;
    if (fields.company !== undefined) payload.company = fields.company;
    if (fields.role !== undefined) payload.role = fields.role;
    if (fields.expectedLevel !== undefined) payload.expectedLevel = fields.expectedLevel;
    if (fields.nextStep !== undefined) payload.nextStep = fields.nextStep;
    if (fields.stepsCompleted !== undefined) payload.stepsCompleted = fields.stepsCompleted;
    if (fields.comments !== undefined) payload.comments = fields.comments;
    if (fields.immigration !== undefined) payload.immigration = fields.immigration;
    if (fields.onHold !== undefined) payload.onHold = fields.onHold;
    patchTracker(entry.screeningId, payload);
  }

  const tdBase = "px-2.5 py-2.5 align-top";
  const dim = local.onHold ? "opacity-50" : "";

  return (
    <>
      <tr
        ref={trRef}
        onDragStart={() => onDragStart(entry.screeningId)}
        onDragEnd={() => { if (trRef.current) trRef.current.draggable = false; }}
        onDragOver={(e) => onDragOver(e, entry.screeningId)}
        onDrop={() => onDrop(entry.screeningId)}
        className={`border-b transition-colors dark:border-zinc-800 ${
          isDragOver
            ? "border-violet-300 bg-violet-50/60 dark:border-violet-600/50 dark:bg-violet-500/5"
            : "border-zinc-100 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
        } ${dim}`}
      >
        {/* Drag handle */}
        <td className={`${tdBase} w-6 cursor-grab text-center active:cursor-grabbing`}>
          <div
            onMouseDown={() => { if (trRef.current) trRef.current.draggable = true; }}
            className="inline-flex items-center justify-center text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400"
          >
            <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
              <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
              <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
            </svg>
          </div>
        </td>

        {/* # */}
        <td className={`${tdBase} w-8 text-center text-xs text-zinc-400`}>{index}</td>

        {/* Hold */}
        <td className={`${tdBase} w-7 text-center`}>
          <button
            type="button"
            title={local.onHold ? "Remove hold" : "Put on hold"}
            onClick={() => update({ onHold: !local.onHold })}
            className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
              local.onHold
                ? "bg-amber-400 text-white"
                : "bg-zinc-100 text-zinc-400 hover:bg-amber-100 hover:text-amber-500 dark:bg-zinc-800"
            }`}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 6V2H11v4H8L12 10l4-4h-3zM5 14h14v2H5zM5 18h14v4H5z"/>
            </svg>
          </button>
        </td>

        {/* Lever */}
        <td className={`${tdBase} min-w-[90px] max-w-[130px]`}>
          <Cell value={local.leverId} placeholder="Lever URL" onCommit={(v) => update({ leverId: v })} />
        </td>

        {/* Company */}
        <td className={`${tdBase} min-w-[100px]`}>
          <Cell value={local.company} placeholder="Company" onCommit={(v) => update({ company: v })} />
        </td>

        {/* Name */}
        <td className={`${tdBase} min-w-[130px]`}>
          <button
            type="button"
            onClick={() => onOpenCard(entry.screeningId)}
            className="text-sm font-medium text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
          >
            {local.candidateName}
          </button>
        </td>

        {/* Role */}
        <td className={`${tdBase} min-w-[130px]`}>
          <Cell value={local.role} placeholder="Role" onCommit={(v) => update({ role: v })} />
        </td>

        {/* Expected Level */}
        <td className={`${tdBase} min-w-[72px]`}>
          <Cell value={local.expectedLevel} placeholder="C1" onCommit={(v) => update({ expectedLevel: v })} />
        </td>

        {/* Stage */}
        <td className={`${tdBase} min-w-[100px]`}>
          <select
            value={local.stage}
            onChange={(e) => update({ stage: e.target.value as TrackerStage })}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium outline-none ${STAGE_COLORS[local.stage]}`}
          >
            {TRACKER_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>

        {/* Next Step */}
        <td className={`${tdBase} min-w-[160px]`}>
          <Cell value={local.nextStep} placeholder="Next step…" onCommit={(v) => update({ nextStep: v })} />
        </td>

        {/* Steps Completed */}
        <td className={`${tdBase} min-w-[160px]`}>
          <Cell value={local.stepsCompleted} placeholder="Steps done…" onCommit={(v) => update({ stepsCompleted: v })} />
        </td>

        {/* Comments */}
        <td className={`${tdBase} min-w-[150px]`}>
          <Cell value={local.comments} placeholder="Comments…" onCommit={(v) => update({ comments: v })} />
        </td>

        {/* Immigration */}
        <td className={`${tdBase} min-w-[100px]`}>
          <Cell value={local.immigration} placeholder="GC / H1B…" onCommit={(v) => update({ immigration: v })} />
        </td>
      </tr>
    </>
  );
}

export default function TrackerPage() {
  const [entries, setEntries] = useState<TrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TrackerStage | "all">("all");
  const [exporting, setExporting] = useState(false);
  const [drawerScreeningId, setDrawerScreeningId] = useState<number | null>(null);
  const dragSourceId = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/tracker")
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleUpdate(updated: TrackerEntry) {
    setEntries((prev) => prev.map((e) => e.screeningId === updated.screeningId ? updated : e));
  }

  function handleDragStart(id: number) {
    dragSourceId.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: number) {
    e.preventDefault();
    if (dragSourceId.current !== id) setDragOverId(id);
  }

  function handleDrop(targetId: number) {
    setDragOverId(null);
    const sourceId = dragSourceId.current;
    dragSourceId.current = null;
    if (sourceId === null || sourceId === targetId) return;

    setEntries((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((e) => e.screeningId === sourceId);
      const toIdx = next.findIndex((e) => e.screeningId === targetId);
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      // Persist new order
      fetch("/api/tracker/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((e, i) => ({ screeningId: e.screeningId, orderIndex: i })) }),
      }).catch(() => {});
      return next;
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/tracker/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `HireView-Tracker-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed — try again.");
    } finally {
      setExporting(false);
    }
  }

  const filtered = filter === "all" ? entries : entries.filter((e) => e.stage === filter);
  const active = entries.filter((e) => e.stage !== "Offer" && e.stage !== "Reject" && !e.onHold);

  const HEADERS = [
    { key: "drag", label: "" },
    { key: "num", label: "#" },
    { key: "hold", label: "" },
    { key: "lever", label: "Lever" },
    { key: "company", label: "Company" },
    { key: "name", label: "Name" },
    { key: "role", label: "Role" },
    { key: "level", label: "Exp. Level" },
    { key: "status", label: "Status" },
    { key: "next", label: "Next Step" },
    { key: "steps", label: "Steps Completed" },
    { key: "comments", label: "Comments" },
    { key: "immigration", label: "Immigration" },
  ];

  return (
    <>
      <CandidateDrawer screeningId={drawerScreeningId} onClose={() => setDrawerScreeningId(null)} />
      <SiteHeader active="/tracker" />
      <div className="mx-auto max-w-[1400px] px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Candidate Tracker</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {active.length} active · {entries.length} total
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || entries.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-40 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>

        {/* Stage filter */}
        <div className="mb-5 flex flex-wrap gap-2">
          {(["all", ...TRACKER_STAGES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                filter === s
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              {s === "all" ? "All" : s}
              {s !== "all" && (
                <span className="ml-1.5 tabular-nums text-xs opacity-60">
                  {entries.filter((e) => e.stage === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <p className="py-16 text-center text-sm text-zinc-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-8 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No candidates here yet.</p>
            <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
              Set a candidate&#39;s status to <span className="font-medium text-emerald-600 dark:text-emerald-400">Interview</span> in the screener or history to add them.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full border-collapse" onDragLeave={() => setDragOverId(null)}>
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  {HEADERS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="whitespace-nowrap px-2.5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, i) => (
                  <TrackerRow
                    key={entry.screeningId}
                    index={i + 1}
                    entry={entry}
                    onUpdate={handleUpdate}
                    onOpenCard={setDrawerScreeningId}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    isDragOver={dragOverId === entry.screeningId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
