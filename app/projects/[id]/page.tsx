"use client";
import * as XLSX from "xlsx";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { CredibilityChecker } from "@/components/CredibilityChecker";
import { CredibilitySection } from "@/components/CredibilitySection";
import { FilterSetView } from "@/components/FilterSetView";
import { InsightList } from "@/components/InsightList";
import { ResultCard } from "@/components/ResultCard";
import { TrajectoryRenderer } from "@/components/TrajectoryRenderer";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusSelect } from "@/components/StatusSelect";
import { TrackerStageSelect } from "@/components/TrackerStageSelect";
import { TRACKER_STAGES } from "@/lib/types";
import type {
  CandidateResult, CandidateStatus, CredibilityAssessment, CredibilitySignal, FullTrackerData,
  JDAnalysis, Project, ScreenResumesError, ScreeningRecord, TrackerStage,
} from "@/lib/types";

const SIGNAL_BADGE: Record<CredibilitySignal, { label: string; className: string; icon: string }> = {
  clean:                { label: "LinkedIn clean",          className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400", icon: "✓" },
  minor_concerns:       { label: "LinkedIn minor concerns", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",          icon: "⚠" },
  significant_concerns: { label: "LinkedIn flags",          className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",              icon: "⛔" },
};

type SearchMode = "wide" | "narrow";

type Tab = "filters" | "screen" | "pipeline" | "tracker" | "settings";
type ScreenView = "form" | "loading" | "results";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatStatusDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Filters tab ────────────────────────────────────────────────────────────

function FiltersTab({ analysis, projectId, jobDescription, onAnalysisUpdated }: {
  analysis: JDAnalysis;
  projectId: number;
  jobDescription: string;
  onAnalysisUpdated: (analysis: JDAnalysis, jobDescription: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<SearchMode>("narrow");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [jdText, setJdText] = useState(jobDescription);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);

  async function handleReanalyze() {
    if (!jdFile && !jdText.trim()) return;
    setReanalyzeError(null);
    setReanalyzing(true);
    try {
      let res: Response;
      if (jdFile) {
        const fd = new FormData();
        fd.set("jdFile", jdFile);
        res = await fetch("/api/analyze-jd", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/analyze-jd", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobDescription: jdText }),
        });
      }
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      const newAnalysis: JDAnalysis = data.analysis;
      const newJd: string = data.jobDescription ?? jdText;
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: newJd, jdAnalysis: newAnalysis }),
      });
      onAnalysisUpdated(newAnalysis, newJd);
      setReanalyzeOpen(false);
      setJdFile(null);
    } catch {
      setReanalyzeError("Re-analysis failed. Try again.");
    } finally {
      setReanalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">LinkedIn Recruiter filters</span>
            <span className="rounded-full bg-emerald-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              Saved
            </span>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`shrink-0 text-zinc-400 transition-transform duration-700 ${open ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="grid transition-[grid-template-rows] duration-700 ease-in-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-6 border-t border-zinc-100 px-5 py-5 dark:border-zinc-800">
              <div className="flex items-center gap-1 self-start rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
                {(["narrow", "wide"] as SearchMode[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                      mode === m ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                    {m}
                  </button>
                ))}
              </div>

              <FilterSetView config={mode === "wide" ? analysis.wide : analysis.narrow} />

              <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Must-have</span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.mustHaveSkills.map((s) => (
                      <span key={s} className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-700/50 dark:bg-violet-500/10 dark:text-violet-300">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Nice-to-have</span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.niceToHaveSkills.map((s) => (
                      <span key={s} className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{s}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <button type="button" onClick={() => { setReanalyzeOpen((v) => !v); setJdText(jobDescription); setJdFile(null); setReanalyzeError(null); }}
                  className="text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
                  Re-analyze JD
                </button>
              </div>

              {reanalyzeOpen && (
                <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Upload a JD file or paste the text below.</p>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors ${
                    jdFile ? "border-violet-300 bg-violet-50/60 text-violet-700 dark:border-violet-600/50 dark:bg-violet-500/10 dark:text-violet-300"
                           : "border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500"}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
                    </svg>
                    <span className="truncate">{jdFile ? jdFile.name : "Upload JD file (.pdf or .docx)"}</span>
                    {jdFile && (
                      <button type="button" onClick={(e) => { e.preventDefault(); setJdFile(null); if (jdFileRef.current) jdFileRef.current.value = ""; }}
                        className="ml-auto shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
                    )}
                    <input ref={jdFileRef} type="file" accept=".pdf,.docx" className="sr-only"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { setJdFile(f); setJdText(""); } }} />
                  </label>
                  {!jdFile && (
                    <textarea
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      rows={8}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      placeholder="Or paste job description here..."
                    />
                  )}
                  {reanalyzeError && (
                    <p className="text-xs text-rose-500">{reanalyzeError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleReanalyze} disabled={reanalyzing || (!jdFile && !jdText.trim())}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                      {reanalyzing ? "Analyzing…" : "Re-analyze"}
                    </button>
                    <button type="button" onClick={() => setReanalyzeOpen(false)}
                      className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screen tab ─────────────────────────────────────────────────────────────

function ScreenTab({ project, onScreeningsSaved }: {
  project: Project;
  onScreeningsSaved: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [screenView, setScreenView] = useState<ScreenView>("form");
  const [results, setResults] = useState<CandidateResult[]>([]);
  const [fileErrors, setFileErrors] = useState<ScreenResumesError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLinkedInMode, setIsLinkedInMode] = useState(false);

  async function handleStatusChange(id: number, status: CandidateStatus) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { /* non-fatal */ }
  }

  async function handleSubmit() {
    if (files.length === 0) return;
    setFormError(null);
    setScreenView("loading");

    const formData = new FormData();
    formData.set("jobDescription", project.jobDescription);
    formData.set("roleContext", project.name);
    formData.set("projectId", String(project.id));
    if (isLinkedInMode) formData.set("linkedInMode", "true");
    files.forEach((f) => formData.append("resumes", f));

    try {
      const res = await fetch("/api/screen-resumes", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Something went wrong while screening resumes.");
      }
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);
      setFileErrors(Array.isArray(data.errors) ? data.errors : []);
      setScreenView("results");
      onScreeningsSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unknown error");
      setScreenView("form");
    }
  }

  function handleReset() {
    setScreenView("form");
    setResults([]);
    setFileErrors([]);
    setFiles([]);
  }

  if (screenView === "results") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Screening results</h3>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {results.length} candidate{results.length !== 1 ? "s" : ""} ranked by fit
              {fileErrors.length > 0 && ` · ${fileErrors.length} file${fileErrors.length !== 1 ? "s" : ""} failed`}
            </p>
          </div>
          <button type="button" onClick={handleReset}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
            Screen more
          </button>
        </div>

        {fileErrors.length > 0 && (
          <ul className="flex flex-col gap-2">
            {fileErrors.map((err) => (
              <li key={err.fileName} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                <span className="font-medium">{err.fileName}</span> — {err.error}
              </li>
            ))}
          </ul>
        )}

        <ul className="flex flex-col gap-4">
          {results.map((result, i) => (
            <ResultCard key={result.fileName} result={result} rank={i + 1} onStatusChange={handleStatusChange} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {isLinkedInMode ? "Screen LinkedIn profiles" : "Screen resumes"}
        </h3>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          {isLinkedInMode
            ? "Upload LinkedIn profile PDFs and Claude will rank them against the saved job description."
            : "Upload resumes and Claude will rank them against the saved job description."}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3 dark:border-violet-700/40 dark:bg-violet-500/5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-violet-400">
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="10" />
        </svg>
        <span className="text-sm text-violet-700 dark:text-violet-300">Using job description saved to <strong>{project.name}</strong></span>
      </div>

      <CalibrationPanel projectId={project.id} />

      <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          LinkedIn profiles <span className="text-zinc-400 dark:text-zinc-500">— adjusts scoring for profile PDFs</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isLinkedInMode}
          onClick={() => setIsLinkedInMode((v) => !v)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isLinkedInMode ? "bg-violet-600" : "bg-zinc-200 dark:bg-zinc-700"}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${isLinkedInMode ? "translate-x-4" : "translate-x-0"}`} />
        </button>
      </div>

      <ResumeUploader files={files} onFilesChange={setFiles} />

      {formError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {formError}
        </div>
      )}

      <button type="button" onClick={handleSubmit}
        disabled={files.length === 0 || screenView === "loading"}
        className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
        {screenView === "loading" ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            {isLinkedInMode ? "Screening profiles..." : "Screening resumes..."}
          </>
        ) : isLinkedInMode ? "Screen profiles" : "Screen resumes"}
      </button>
    </div>
  );
}

// ── Pipeline tab ───────────────────────────────────────────────────────────

function PipelineTab({ screenings: initialScreenings, projectId, stagesMap, onStageChange, onStatusChange, expandedId: externalExpandedId, onExpandedChange }: {
  screenings: ScreeningRecord[];
  projectId: number;
  stagesMap: Record<number, TrackerStage>;
  onStageChange: (id: number, stage: TrackerStage) => void;
  onStatusChange?: (id: number, status: CandidateStatus) => void;
  expandedId?: number | null;
  onExpandedChange?: (id: number | null) => void;
}) {
  const [screenings, setScreenings] = useState(initialScreenings);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | null>(null);
  const [expandedId, setExpandedIdState] = useState<number | null>(externalExpandedId ?? null);
  function setExpandedId(id: number | null) {
    setExpandedIdState(id);
    onExpandedChange?.(id);
  }
  // Auto-scroll to the expanded card when navigating from Tracker tab
  useEffect(() => {
    if (expandedId == null) return;
    const el = document.querySelector(`[data-candidate-id="${expandedId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [expandedId]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingFlagId, setPendingFlagId] = useState<number | null>(null);
  const [pendingFlagNote, setPendingFlagNote] = useState("");
  const [notesMap, setNotesMap] = useState<Record<number, { text: string; saveState: "idle" | "saving" | "saved" }>>({});
  const [credibilityMap, setCredibilityMap] = useState<Record<number, CredibilityAssessment>>({});
  const [showCheckerForId, setShowCheckerForId] = useState<number | null>(null);

  useEffect(() => {
    setScreenings(initialScreenings);
    const saved: Record<number, CredibilityAssessment> = {};
    for (const s of initialScreenings) {
      if (s.credibility) saved[s.id] = s.credibility;
    }
    setCredibilityMap(saved);
  }, [initialScreenings]);

  const handleStageChange = onStageChange;

  const filteredScreenings = screenings.filter((s) => {
    if (search && !s.candidateName.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && s.status !== statusFilter) return false;
    return true;
  });

  function getNotesText(s: ScreeningRecord) {
    return notesMap[s.id]?.text ?? s.notes ?? "";
  }

  async function handleStatusChange(id: number, status: CandidateStatus) {
    const now = new Date().toISOString();
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, status, statusUpdatedAt: now } : s));
    onStatusChange?.(id, status);
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    } catch { /* non-fatal */ }
  }

  async function handleToggleFlag(id: number, current: boolean, note?: string) {
    const next = !current;
    setPendingFlagId(null);
    setPendingFlagNote("");
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, flagged: next, flagNote: next ? note : undefined } : s));
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flagged: next, flagNote: note }) });
    } catch {
      setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, flagged: current } : s));
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setScreenings((prev) => prev.filter((s) => s.id !== id));
      setExpandedId(expandedId === id ? null : expandedId);
    } catch { /* show nothing */ }
    finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function saveNotes(id: number, text: string) {
    setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "saving" } }));
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: text }) });
      setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "saved" } }));
      setTimeout(() => setNotesMap((prev) => prev[id]?.saveState === "saved" ? { ...prev, [id]: { text, saveState: "idle" } } : prev), 2000);
    } catch {
      setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "idle" } }));
    }
  }

  const STATUS_PILLS: { label: string; value: CandidateStatus | null }[] = [
    { label: "All", value: null },
    { label: "New", value: "new_applicant" },
    { label: "Contacted", value: "contacted" },
    { label: "Screening", value: "screening" },
    { label: "Interview", value: "interview" },
    { label: "Archived", value: "archived" },
  ];

  if (screenings.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-200 px-6 py-12 text-center text-sm text-zinc-400 dark:border-zinc-800">
        No candidates yet — screen some resumes first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <input type="text" placeholder="Search candidates…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_PILLS.map((p) => (
            <button key={String(p.value)} type="button" onClick={() => setStatusFilter(p.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === p.value
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {filteredScreenings.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">No candidates match your filters.</p>
      )}
    <ul className="flex flex-col gap-3">
      {filteredScreenings.map((s) => {
        const expanded = expandedId === s.id;
        return (
          <li key={s.id} data-candidate-id={s.id} className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
            <div role="button" tabIndex={0}
              onClick={() => setExpandedId(expanded ? null : s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(expanded ? null : s.id); }}
              className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left">
              <ScoreBadge score={s.score} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {/* Name row */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{s.candidateName}</span>
                  {s.flagged && s.flagNote && (
                    <span className="shrink-0 truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">{s.flagNote}</span>
                  )}
                </div>
                {/* Meta row — date · notes indicator */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {formatDate(s.createdAt)}
                    {s.statusUpdatedAt && <> · {formatStatusDate(s.statusUpdatedAt)}</>}
                  </span>
                  {getNotesText(s) && (
                    <span className="rounded-full bg-violet-100 px-1.5 py-px text-[10px] font-medium text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">notes</span>
                  )}
                </div>
                {/* Status row */}
                <div className="mt-1.5 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <StatusSelect status={s.status} onChange={(status) => handleStatusChange(s.id, status)} />
                  {s.status === "interview" && (
                    <TrackerStageSelect
                      stage={stagesMap[s.id] ?? null}
                      onChange={(stage) => handleStageChange(s.id, stage)}
                    />
                  )}
                </div>
              </div>
              {/* Resume button */}
              <button type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const sw = window.screen.availWidth;
                  const sh = window.screen.availHeight;
                  const halfW = Math.floor(sw / 2);
                  // Use sw - halfW so resume + notes widths sum to exactly sw (handles odd screen widths)
                  window.open(
                    `/interview/${s.id}/document`,
                    `iv_doc_${s.id}`,
                    `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`
                  );
                }}
                aria-label="Open resume"
                title="Open resume"
                className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {/* Notes button */}
              <button type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const sw = window.screen.availWidth;
                  const sh = window.screen.availHeight;
                  const halfW = Math.floor(sw / 2);
                  const halfH = Math.floor(sh / 2);
                  // left = sw - halfW so it abuts the resume window exactly
                  window.open(
                    `/interview/${s.id}`,
                    `iv_notes_${s.id}`,
                    `width=${halfW},height=${halfH},left=${sw - halfW},top=0,menubar=no,toolbar=no,location=no,status=no`
                  );
                }}
                aria-label="Open interview notes"
                title="Open interview notes"
                className="shrink-0 rounded-full p-1.5 text-zinc-300 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:text-zinc-600 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
              <button type="button"
                onClick={(e) => { e.stopPropagation(); s.flagged ? handleToggleFlag(s.id, true) : setPendingFlagId((p) => p === s.id ? null : s.id); }}
                aria-label={s.flagged ? "Remove flag" : "Flag"}
                className={`shrink-0 rounded-full p-1.5 transition-colors ${s.flagged ? "text-amber-500 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10" : "text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"}`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill={s.flagged ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 22V15" strokeLinecap="round" />
                </svg>
              </button>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            {pendingFlagId === s.id && (
              <div className="flex items-center gap-2 border-t border-amber-100 bg-amber-50/50 px-5 py-3 dark:border-amber-500/20 dark:bg-amber-500/5" onClick={(e) => e.stopPropagation()}>
                <input autoFocus type="text" value={pendingFlagNote} onChange={(e) => setPendingFlagNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleToggleFlag(s.id, false, pendingFlagNote.trim() || undefined); if (e.key === "Escape") { setPendingFlagId(null); setPendingFlagNote(""); } }}
                  placeholder="Reason to come back? (optional)"
                  className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-amber-400 dark:border-amber-500/30 dark:bg-zinc-900 dark:text-zinc-100" />
                <button type="button" onClick={() => handleToggleFlag(s.id, false, pendingFlagNote.trim() || undefined)}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600">Flag</button>
                <button type="button" onClick={() => { setPendingFlagId(null); setPendingFlagNote(""); }}
                  className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancel</button>
              </div>
            )}

            {expanded && (
              <div className="flex flex-col gap-4 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">

                {/* ── Career story ──────────────────────────────────────── */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Career story</p>
                    {credibilityMap[s.id] && (() => {
                      const sig = SIGNAL_BADGE[credibilityMap[s.id].overallSignal] ?? SIGNAL_BADGE.minor_concerns;
                      return (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sig.className}`}>
                          {sig.icon} {sig.label}
                        </span>
                      );
                    })()}
                  </div>
                  <TrajectoryRenderer text={s.careerTrajectory ?? s.summary} className="text-sm" />
                  {credibilityMap[s.id] && (
                    <div className="mt-2.5 flex flex-col gap-1 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="font-medium text-zinc-500 dark:text-zinc-400">LinkedIn trajectory: </span>
                        {credibilityMap[s.id].trajectoryNote}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="font-medium text-zinc-500 dark:text-zinc-400">Industry: </span>
                        {credibilityMap[s.id].industryNote}
                      </p>
                      {credibilityMap[s.id].resumeDelta && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">
                          <span className="font-medium text-zinc-500 dark:text-zinc-400">Δ Resume: </span>
                          {credibilityMap[s.id].resumeDelta}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── LinkedIn verification ─────────────────────────────── */}
                {credibilityMap[s.id] ? (
                  <CredibilitySection assessment={credibilityMap[s.id]} showSummary={false} />
                ) : (
                  <div>
                    <button type="button"
                      onClick={() => setShowCheckerForId((p) => p === s.id ? null : s.id)}
                      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${showCheckerForId === s.id ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-400" : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"}`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" /></svg>
                      Check credibility
                    </button>
                    <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: showCheckerForId === s.id ? "1fr" : "0fr" }}>
                      <div className="overflow-hidden">
                        <CredibilityChecker screeningId={s.id} onComplete={(assessment) => {
                          setCredibilityMap((prev) => ({ ...prev, [s.id]: assessment }));
                          setShowCheckerForId(null);
                          fetch(`/api/history/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credibility: assessment }) }).catch(() => {});
                        }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Assessment ────────────────────────────────────────── */}
                {(s.mustHaveScore !== undefined || s.niceToHaveScore !== undefined) && (
                  <div className="flex items-center gap-1.5">
                    {s.mustHaveScore !== undefined && (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Must-have {s.mustHaveScore}</span>
                    )}
                    {s.niceToHaveScore !== undefined && (
                      <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">Nice-to-have {s.niceToHaveScore}</span>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <InsightList label="Strengths" items={s.strengths} variant="positive" />
                  <InsightList label="Concerns" items={s.concerns} variant="warning" screeningId={s.id} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Notes</span>
                    {notesMap[s.id]?.saveState === "saving" && <span className="text-xs text-zinc-400">Saving...</span>}
                    {notesMap[s.id]?.saveState === "saved" && <span className="text-xs text-emerald-500">Saved</span>}
                  </div>
                  <textarea value={getNotesText(s)}
                    onChange={(e) => setNotesMap((prev) => ({ ...prev, [s.id]: { text: e.target.value, saveState: "idle" } }))}
                    onBlur={(e) => saveNotes(s.id, e.target.value)}
                    placeholder="Add notes about this candidate..." rows={3}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-900" />
                </div>

                <div className="flex items-center justify-between">
                  <button type="button"
                    onClick={() => {
                      const sw = window.screen.availWidth;
                      const sh = window.screen.availHeight;
                      const halfW = Math.floor(sw / 2);
                      window.open(`/interview/${s.id}/document`, `iv_doc_${s.id}`, `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
                    }}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full bg-violet-50 px-3.5 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    View resume
                  </button>
                  {confirmDeleteId === s.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">Delete this record?</span>
                      <button type="button" onClick={() => handleDelete(s.id)} disabled={deletingId === s.id}
                        className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
                        {deletingId === s.id ? "Deleting..." : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(s.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12ZM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
    </div>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────

function SettingsTab({ project, onNameSaved, onStatusToggled, onDeleted }: {
  project: Project;
  onNameSaved: (name: string) => void;
  onStatusToggled: (status: "active" | "archived") => void;
  onDeleted: () => void;
}) {
  const [nameValue, setNameValue] = useState(project.name);
  const [savingName, setSavingName] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function saveName() {
    if (!nameValue.trim() || nameValue.trim() === project.name) return;
    setSavingName(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameValue.trim() }),
      });
      onNameSaved(nameValue.trim());
    } catch { /* non-fatal */ }
    finally { setSavingName(false); }
  }

  async function toggleStatus() {
    setTogglingStatus(true);
    const next = project.status === "active" ? "archived" : "active";
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      onStatusToggled(next);
    } catch { /* non-fatal */ }
    finally { setTogglingStatus(false); }
  }

  async function deleteProject() {
    setDeleting(true);
    try {
      await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      onDeleted();
    } catch { /* non-fatal */ }
    finally { setDeleting(false); }
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      {/* Role name */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Role name</label>
        <div className="flex items-center gap-2">
          <input ref={nameRef} value={nameValue} onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setNameValue(project.name); }}
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
          <button type="button" onClick={saveName}
            disabled={savingName || !nameValue.trim() || nameValue.trim() === project.name}
            className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Role status</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {project.status === "active" ? "Currently active — visible in your projects list." : "Archived — hidden from the main list."}
          </p>
        </div>
        <button type="button" onClick={toggleStatus} disabled={togglingStatus}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${project.status === "active" ? "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
          {togglingStatus ? "Updating..." : project.status === "active" ? "Archive role" : "Restore role"}
        </button>
      </div>

      {/* Delete */}
      <div className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50/50 px-5 py-4 dark:border-rose-500/30 dark:bg-rose-500/5">
        <div>
          <p className="text-sm font-medium text-rose-700 dark:text-rose-400">Delete role</p>
          <p className="text-xs text-rose-500/80 dark:text-rose-500/60 mt-0.5">Permanently removes the role and all its data.</p>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={deleteProject} disabled={deleting}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
              {deleting ? "Deleting..." : "Confirm delete"}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)}
            className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/10">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tracker tab ───────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  TA:         { bg: "bg-blue-50 dark:bg-blue-500/10",    text: "text-blue-700 dark:text-blue-400",    dot: "bg-blue-400",    border: "border-blue-200 dark:border-blue-500/30" },
  L1:         { bg: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-400",  border: "border-violet-200 dark:border-violet-500/30" },
  L2:         { bg: "bg-indigo-50 dark:bg-indigo-500/10", text: "text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-400",  border: "border-indigo-200 dark:border-indigo-500/30" },
  "In-Person":{ bg: "bg-amber-50 dark:bg-amber-500/10",   text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-400",   border: "border-amber-200 dark:border-amber-500/30" },
  Offer:      { bg: "bg-emerald-50 dark:bg-emerald-500/10",text: "text-emerald-700 dark:text-emerald-400",dot: "bg-emerald-400",border: "border-emerald-200 dark:border-emerald-500/30" },
  Reject:     { bg: "bg-rose-50 dark:bg-rose-500/10",     text: "text-rose-700 dark:text-rose-400",     dot: "bg-rose-400",    border: "border-rose-200 dark:border-rose-500/30" },
};

function DrawerBody({
  selected,
  trackerEntry,
  onTrackerSave,
  onViewResult,
  onScreeningFieldSaved,
}: {
  selected: ScreeningRecord;
  trackerEntry: FullTrackerData;
  onTrackerSave: (fields: Partial<FullTrackerData>) => void;
  onViewResult: (id: number) => void;
  onScreeningFieldSaved: (id: number, fields: Partial<ScreeningRecord>) => void;
}) {
  const [leverUrl, setLeverUrl] = useState(selected.leverUrl ?? "");
  const [company, setCompany] = useState(trackerEntry.company ?? "");
  const [role, setRole] = useState(trackerEntry.role ?? "");
  const [expectedLevel, setExpectedLevel] = useState(trackerEntry.expectedLevel ?? "");
  const [nextStep, setNextStep] = useState(trackerEntry.nextStep ?? "");
  const [stepsCompleted, setStepsCompleted] = useState(trackerEntry.stepsCompleted ?? "");
  const [comments, setComments] = useState(trackerEntry.comments ?? "");
  const [immigration, setImmigration] = useState(trackerEntry.immigration ?? "");
  const [onHold, setOnHold] = useState(trackerEntry.onHold ?? false);
  const [onHoldReason, setOnHoldReason] = useState(trackerEntry.onHoldReason ?? "");
  const [scheduled, setScheduled] = useState(trackerEntry.scheduled ?? false);
  const [interviewDate, setInterviewDate] = useState(trackerEntry.interviewDate ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLeverUrl(selected.leverUrl ?? "");
    setSaved(null);
  }, [selected.id, selected.leverUrl]);

  useEffect(() => {
    setCompany(trackerEntry.company ?? "");
    setRole(trackerEntry.role ?? "");
    setExpectedLevel(trackerEntry.expectedLevel ?? "");
    setNextStep(trackerEntry.nextStep ?? "");
    setStepsCompleted(trackerEntry.stepsCompleted ?? "");
    setComments(trackerEntry.comments ?? "");
    setImmigration(trackerEntry.immigration ?? "");
    setOnHold(trackerEntry.onHold ?? false);
    setOnHoldReason(trackerEntry.onHoldReason ?? "");
    setScheduled(trackerEntry.scheduled ?? false);
    setInterviewDate(trackerEntry.interviewDate ?? "");
  }, [selected.id]);

  function flashSaved(key: string) {
    setSaved(key);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(null), 2000);
  }

  async function saveScreeningField(field: string, value: string) {
    setSaving(field);
    try {
      const res = await fetch(`/api/history/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        flashSaved(field);
        onScreeningFieldSaved(selected.id, { [field]: value } as Partial<ScreeningRecord>);
      }
    } catch { /* non-fatal */ }
    setSaving(null);
  }

  function saveTrackerField(fields: Partial<FullTrackerData>, key: string) {
    onTrackerSave(fields);
    flashSaved(key);
  }

  const inputCls = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500";
  const labelCls = "text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500";

  function FieldLabel({ label, fkey }: { label: string; fkey: string }) {
    return (
      <div className="mb-1.5 flex items-center justify-between">
        <p className={labelCls}>{label}</p>
        {saving === fkey && <span className="text-[10px] text-zinc-400">Saving…</span>}
        {saving !== fkey && saved === fkey && <span className="text-[10px] text-emerald-500">Saved</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
      {/* View result link */}
      <button type="button" onClick={() => onViewResult(selected.id)}
        className="flex items-center gap-1.5 self-start text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        View full screening result
      </button>

      {/* Scheduled toggle */}
      <button
        type="button"
        onClick={() => {
          const next = !scheduled;
          setScheduled(next);
          saveTrackerField({ scheduled: next }, "scheduled");
        }}
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
          scheduled
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
            : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
        }`}>
        <span className={`relative flex h-3 w-3 shrink-0 ${scheduled ? "" : "animate-pulse"}`}>
          {!scheduled && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />}
          <span className={`relative inline-flex h-3 w-3 rounded-full ${scheduled ? "bg-emerald-400" : "bg-amber-400"}`} />
        </span>
        <div>
          <p className={`text-sm font-semibold ${scheduled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
            {scheduled ? "Interview scheduled" : "Not yet scheduled"}
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Click to toggle</p>
        </div>
      </button>

      {/* Interview date */}
      <div>
        <FieldLabel label="Interview date" fkey="interviewDate" />
        <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)}
          onBlur={(e) => saveTrackerField({ interviewDate: e.target.value }, "interviewDate")}
          className={inputCls} />
      </div>

      {/* Lever URL */}
      <div>
        <FieldLabel label="Lever profile" fkey="leverUrl" />
        <div className="flex gap-2">
          <input type="url" value={leverUrl} onChange={(e) => setLeverUrl(e.target.value)}
            onBlur={(e) => saveScreeningField("leverUrl", e.target.value)}
            placeholder="https://hire.lever.co/candidates/…"
            className={`min-w-0 flex-1 ${inputCls}`} />
          {leverUrl && (
            <a href={leverUrl} target="_blank" rel="noopener noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10 dark:hover:text-violet-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round"/>
                <path d="M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Open
            </a>
          )}
        </div>
      </div>

      {/* Company + Role */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel label="Company" fkey="company" />
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
            onBlur={(e) => saveTrackerField({ company: e.target.value }, "company")}
            placeholder="Accenture" className={inputCls} />
        </div>
        <div>
          <FieldLabel label="Exp. level" fkey="expectedLevel" />
          <input type="text" value={expectedLevel} onChange={(e) => setExpectedLevel(e.target.value)}
            onBlur={(e) => saveTrackerField({ expectedLevel: e.target.value }, "expectedLevel")}
            placeholder="C1, D2…" className={inputCls} />
        </div>
      </div>

      {/* Role */}
      <div>
        <FieldLabel label="Role" fkey="role" />
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)}
          onBlur={(e) => saveTrackerField({ role: e.target.value }, "role")}
          placeholder="FDE_AI Builder" className={inputCls} />
      </div>

      {/* Next Step */}
      <div>
        <FieldLabel label="Next step" fkey="nextStep" />
        <input type="text" value={nextStep} onChange={(e) => setNextStep(e.target.value)}
          onBlur={(e) => saveTrackerField({ nextStep: e.target.value }, "nextStep")}
          placeholder="L2 6/30 with Nayana & Sean" className={inputCls} />
      </div>

      {/* Steps Completed */}
      <div>
        <FieldLabel label="Steps completed" fkey="stepsCompleted" />
        <textarea rows={2} value={stepsCompleted} onChange={(e) => setStepsCompleted(e.target.value)}
          onBlur={(e) => saveTrackerField({ stepsCompleted: e.target.value }, "stepsCompleted")}
          placeholder="TA 6/8; L1 6/22 with Karthik; L2 6/23 with Nayana & Sean"
          className={`resize-none ${inputCls}`} />
      </div>

      {/* Comments */}
      <div>
        <FieldLabel label="Comments" fkey="comments" />
        <textarea rows={2} value={comments} onChange={(e) => setComments(e.target.value)}
          onBlur={(e) => saveTrackerField({ comments: e.target.value }, "comments")}
          placeholder="NY office Tuesday, Wednesday & Thursday…"
          className={`resize-none ${inputCls}`} />
      </div>

      {/* Immigration */}
      <div>
        <FieldLabel label="Immigration" fkey="immigration" />
        <input type="text" value={immigration} onChange={(e) => setImmigration(e.target.value)}
          onBlur={(e) => saveTrackerField({ immigration: e.target.value }, "immigration")}
          placeholder="H1B Transfer, GC, US Citizen…" className={inputCls} />
      </div>

      {/* On hold */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
        <div>
          <p className={labelCls}>On hold</p>
          {onHold && (
            <input type="text" value={onHoldReason} onChange={(e) => setOnHoldReason(e.target.value)}
              onBlur={(e) => saveTrackerField({ onHold: true, onHoldReason: e.target.value }, "onHoldReason")}
              placeholder="Reason…"
              className="mt-1 w-full bg-transparent text-xs text-zinc-500 placeholder-zinc-400 focus:outline-none dark:text-zinc-400" />
          )}
        </div>
        <button type="button" onClick={() => {
          const next = !onHold;
          setOnHold(next);
          saveTrackerField({ onHold: next }, "onHold");
        }}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${onHold ? "bg-amber-400" : "bg-zinc-300 dark:bg-zinc-600"}`}>
          <span className={`inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white transition-transform ${onHold ? "translate-x-4" : ""}`} />
        </button>
      </div>


    </div>
  );
}

function TrackerTab({ screenings, stagesMap, onStageChange, trackerData, onTrackerDataChange, onViewResult, onScreeningFieldSaved }: {
  screenings: ScreeningRecord[];
  stagesMap: Record<number, TrackerStage>;
  onStageChange: (id: number, stage: TrackerStage) => void;
  trackerData: Record<number, FullTrackerData>;
  onTrackerDataChange: (id: number, fields: Partial<FullTrackerData>) => void;
  onViewResult: (id: number) => void;
  onScreeningFieldSaved: (id: number, fields: Partial<ScreeningRecord>) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreeningRecord | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>(() =>
    Object.fromEntries(screenings.filter((s) => s.photoUrl).map((s) => [s.id, s.photoUrl!]))
  );

  async function handlePhotoUpload(screeningId: number, file: File) {
    const form = new FormData();
    form.append("photo", file);
    const res = await fetch(`/api/history/${screeningId}/photo`, { method: "POST", body: form });
    if (res.ok) {
      const { photoUrl } = await res.json();
      setPhotoUrls((prev) => ({ ...prev, [screeningId]: photoUrl }));
      onScreeningFieldSaved(screeningId, { photoUrl });
    }
  }

  // Close drawer on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSelected(null); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep selected in sync if stagesMap changes (e.g. after drag)
  useEffect(() => {
    if (selected) setSelected((prev) => screenings.find((s) => s.id === prev?.id) ?? null);
  }, [screenings, stagesMap]);

  const interviewScreenings = screenings.filter((s) => s.status === "interview");

  const filtered = interviewScreenings.filter((s) =>
    !search || s.candidateName.toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, ScreeningRecord[]> = { unplaced: [] };
  for (const stage of TRACKER_STAGES) grouped[stage] = [];
  for (const s of filtered) {
    const stage = stagesMap[s.id];
    if (stage) grouped[stage].push(s);
    else grouped["unplaced"].push(s);
  }

  function handleDragStart(e: React.DragEvent, id: number) {
    setDraggingId(id);
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverStage(null);
  }

  function handleDragOver(e: React.DragEvent, stageKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageKey);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStage(null);
  }

  function handleDrop(e: React.DragEvent, stageKey: string) {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!isNaN(id) && TRACKER_STAGES.includes(stageKey as TrackerStage)) {
      onStageChange(id, stageKey as TrackerStage);
    }
    setDraggingId(null);
    setDragOverStage(null);
  }

  function exportToExcel() {
    const rows = interviewScreenings.map((s) => {
      const td = trackerData[s.id] ?? {};
      return {
        "Name": s.candidateName,
        "Stage": stagesMap[s.id] ?? "New",
        "Scheduled": td.scheduled ? "Yes" : "No",
        "Company": td.company ?? "",
        "Role": td.role ?? "",
        "Exp. Level": td.expectedLevel ?? "",
        "Next Step": td.nextStep ?? "",
        "Steps Completed": td.stepsCompleted ?? "",
        "Comments": td.comments ?? "",
        "Immigration": td.immigration ?? "",
        "Interview Date": td.interviewDate ?? "",
             "On Hold": td.onHold ? (td.onHoldReason ? `Yes — ${td.onHoldReason}` : "Yes") : "No",
        "Lever URL": s.leverUrl ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    // Column widths
    ws["!cols"] = [
      { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 18 },
      { wch: 10 }, { wch: 28 }, { wch: 32 }, { wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 36 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tracker");
    XLSX.writeFile(wb, "tracker.xlsx");
  }

  if (interviewScreenings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" strokeLinecap="round"/>
            <rect x="9" y="3" width="6" height="4" rx="1" strokeLinecap="round"/>
            <path d="M9 12h6M9 16h4" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No active interviews</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Move candidates to Interview status in the Pipeline tab to track them here.</p>
      </div>
    );
  }

  const allStages: Array<{ key: string; label: string; isUnplaced?: boolean }> = [
    { key: "unplaced", label: "New", isUnplaced: true },
    ...TRACKER_STAGES.map((s) => ({ key: s, label: s })),
  ];

  const drawerStage = selected ? stagesMap[selected.id] : null;

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Search */}
        <div className="relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <input type="text" placeholder="Search candidates…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-4 text-sm placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500" />
        </div>

        {/* Summary bar */}
        <div className="flex flex-wrap gap-2">
          {TRACKER_STAGES.map((stage) => {
            const c = STAGE_COLORS[stage];
            const count = grouped[stage]?.length ?? 0;
            if (count === 0) return null;
            return (
              <span key={stage} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${c.bg} ${c.text} ${c.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                {stage} · {count}
              </span>
            );
          })}
        </div>

        {/* Swimlanes */}
        <div className="flex flex-col divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {allStages.map(({ key, label, isUnplaced }) => {
            const candidates = grouped[key] ?? [];
            const c = isUnplaced
              ? { bg: "bg-zinc-50 dark:bg-zinc-900/50", text: "text-zinc-400 dark:text-zinc-500", dot: "bg-zinc-300", border: "border-zinc-200 dark:border-zinc-700" }
              : STAGE_COLORS[key];
            const isDropTarget = !isUnplaced && TRACKER_STAGES.includes(key as TrackerStage);
            const isOver = dragOverStage === key;

            return (
              <div key={key}
                className={`flex items-start gap-0 first:rounded-t-2xl last:rounded-b-2xl overflow-hidden transition-colors ${isOver ? "ring-2 ring-inset ring-violet-400 dark:ring-violet-500" : ""}`}
                onDragOver={isDropTarget ? (e) => handleDragOver(e, key) : undefined}
                onDragLeave={isDropTarget ? handleDragLeave : undefined}
                onDrop={isDropTarget ? (e) => handleDrop(e, key) : undefined}
              >
                {/* Stage label */}
                <div className={`flex w-28 shrink-0 flex-col items-start gap-1 self-stretch border-r px-4 py-4 transition-colors ${c.bg} ${c.border}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                    <span className={`text-xs font-bold uppercase tracking-wide ${c.text}`}>{label}</span>
                  </div>
                  <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-600">{candidates.length} {candidates.length === 1 ? "person" : "people"}</span>
                </div>

                {/* Chips */}
                <div className={`flex flex-1 flex-wrap items-start gap-2 px-4 py-3 transition-colors ${
                  isOver ? "bg-violet-50/60 dark:bg-violet-500/5" : "bg-white dark:bg-zinc-900/30"
                }`}>
                  {isOver && candidates.length === 0 && (
                    <div className="flex h-10 w-full items-center justify-center rounded-lg border-2 border-dashed border-violet-300 dark:border-violet-500/40">
                      <span className="text-xs font-medium text-violet-400 dark:text-violet-500">Drop here</span>
                    </div>
                  )}
                  {!isOver && candidates.length === 0 && (
                    <span className="self-center text-xs text-zinc-300 dark:text-zinc-700">—</span>
                  )}
                  {candidates.map((s) => {
                    const isActive = selected?.id === s.id;
                    const isDragging = draggingId === s.id;
                    return (
                      <div
                        key={s.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, s.id)}
                        onDragEnd={handleDragEnd}
                        className={`cursor-grab active:cursor-grabbing transition-opacity ${isDragging ? "opacity-40" : "opacity-100"}`}
                      >
                        <button
                          type="button"
                          onClick={() => !isDragging && setSelected(isActive ? null : s)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all select-none ${
                            isActive
                              ? "border-violet-300 bg-violet-50 shadow-md dark:border-violet-500/40 dark:bg-violet-500/10"
                              : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                          }`}>
                          <label
                            className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                            title="Upload photo"
                          >
                            {photoUrls[s.id] ? (
                              <img src={photoUrls[s.id]} alt={s.candidateName} className="h-full w-full object-cover" />
                            ) : (
                              <span className={`flex h-full w-full items-center justify-center text-xs font-bold ${
                                s.score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : s.score >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                : "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                              }`}>{s.score}</span>
                            )}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(s.id, f); e.target.value = ""; }}
                            />
                          </label>
                          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" className="shrink-0 text-zinc-300 dark:text-zinc-600">
                            <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
                            <circle cx="2" cy="7" r="1.5"/><circle cx="6" cy="7" r="1.5"/>
                            <circle cx="2" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/>
                          </svg>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{s.candidateName}</span>
                          {trackerData[s.id]?.interviewDate && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                              {new Date(trackerData[s.id].interviewDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                          {!isUnplaced && (
                            trackerData[s.id]?.scheduled
                              ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="Scheduled" />
                              : <span className="relative flex h-2 w-2 shrink-0" title="Not scheduled">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                                </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Export */}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={exportToExcel}
          className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-emerald-500/40 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round"/>
            <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round"/>
          </svg>
          Export to Excel
        </button>
      </div>

      {/* ── Slide-over drawer ── */}
      {selected && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
            onClick={() => setSelected(null)}
          />
          {/* Panel */}
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-zinc-900 animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-zinc-100 px-6 py-5 dark:border-zinc-800">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{selected.candidateName}</h3>
                <div className="flex items-center gap-2">
                  <span className={`flex h-7 w-14 items-center justify-center rounded-lg text-sm font-bold ${
                    selected.score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                    : selected.score >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    : "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                  }`}>{selected.score}/100</span>
                  {drawerStage && (() => {
                    const sc = STAGE_COLORS[drawerStage];
                    return (
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                        {drawerStage}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)}
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Move stage */}
            <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Move to stage</p>
              <div className="flex flex-wrap gap-1.5">
                {TRACKER_STAGES.map((st) => {
                  const sc = STAGE_COLORS[st];
                  const active = drawerStage === st;
                  const isReject = st === "Reject";
                  return (
                    <button key={st} type="button"
                      onClick={() => onStageChange(selected.id, st)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                        active
                          ? `${sc.bg} ${sc.text} ${sc.border} shadow-sm`
                          : isReject
                          ? "border-zinc-200 text-zinc-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                          : "border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                      }`}>
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable content */}
            <DrawerBody
              selected={selected}
              trackerEntry={trackerData[selected.id] ?? {}}
              onTrackerSave={(fields) => onTrackerDataChange(selected.id, fields)}
              onViewResult={(id) => { setSelected(null); onViewResult(id); }}
              onScreeningFieldSaved={onScreeningFieldSaved}
            />
          </div>
        </>
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [screenings, setScreenings] = useState<ScreeningRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("filters");
  const [trackerData, setTrackerData] = useState<Record<number, FullTrackerData>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Derived for PipelineTab
  const stagesMap: Record<number, TrackerStage> = {};
  for (const [sid, td] of Object.entries(trackerData)) {
    if (td.stage) stagesMap[Number(sid)] = td.stage;
  }

  const interviewCount = screenings.filter((s) => s.status === "interview").length;

  const TABS: { key: Tab; label: string }[] = [
    { key: "filters", label: "Filters" },
    { key: "screen", label: "Screen" },
    { key: "pipeline", label: `Pipeline${screenings.length > 0 ? ` (${screenings.length})` : ""}` },
    { key: "tracker", label: `Tracker${interviewCount > 0 ? ` (${interviewCount})` : ""}` },
    { key: "settings", label: "Settings" },
  ];

  function handleStageChange(id: number, stage: TrackerStage) {
    handleTrackerDataChange(id, { stage });
  }

  function handleTrackerDataChange(id: number, fields: Partial<FullTrackerData>) {
    setTrackerData((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...fields } }));
    fetch(`/api/tracker/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }).catch(() => {});
  }

  async function loadScreenings() {
    const res = await fetch(`/api/history?projectId=${id}`);
    const data = await res.json();
    setScreenings(data.screenings ?? []);
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/projects/${id}`).then((r) => r.json()),
      fetch(`/api/history?projectId=${id}`).then((r) => r.json()),
    ])
      .then(([projectData, historyData]) => {
        if (projectData.error) { setNotFound(true); return; }
        setProject(projectData.project);
        const allScreenings: ScreeningRecord[] = historyData.screenings ?? [];
        setScreenings(allScreenings);
        const iIds = allScreenings.filter((s) => s.status === "interview").map((s) => s.id);
        if (iIds.length > 0) {
          fetch(`/api/tracker?ids=${iIds.join(",")}`)
            .then((r) => r.json())
            .then((d) => setTrackerData(d.entries ?? {}))
            .catch(() => {});
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
        <SiteHeader active="/projects" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-10">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
        </main>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
        <SiteHeader active="/projects" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
          <p className="text-zinc-500 dark:text-zinc-400">Role not found.</p>
          <Link href="/projects" className="text-sm text-violet-600 underline underline-offset-2 dark:text-violet-400">Back to Projects</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/projects" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-1">
          <Link href="/projects" className="mb-1 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M5 12l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Projects
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{project.name}</h2>
            {project.status === "archived" && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Archived</span>
            )}
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {screenings.length} candidate{screenings.length !== 1 ? "s" : ""} screened · Created {formatDate(project.createdAt)}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => { setTab(t.key); setExpandedId(null); }}
              className={`-mb-px px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {/* Tab content */}
        {tab === "filters" && project.jdAnalysis && (
          <FiltersTab
            analysis={project.jdAnalysis}
            projectId={project.id}
            jobDescription={project.jobDescription}
            onAnalysisUpdated={(newAnalysis, newJd) => setProject((p) => p ? { ...p, jdAnalysis: newAnalysis, jobDescription: newJd } : p)}
          />
        )}
        {tab === "filters" && !project.jdAnalysis && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No LinkedIn Recruiter filters yet.</p>
            <Link href={`/jd-analyzer?projectId=${project.id}`}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Analyze JD
            </Link>
          </div>
        )}
        {tab === "screen" && (
          <ScreenTab project={project} onScreeningsSaved={loadScreenings} />
        )}
        {tab === "pipeline" && (
          <PipelineTab
            screenings={screenings}
            projectId={project.id}
            stagesMap={stagesMap}
            onStageChange={handleStageChange}
            onStatusChange={(id, status) => {
              const now = new Date().toISOString();
              setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, status, statusUpdatedAt: now } : s));
            }}
            expandedId={expandedId}
            onExpandedChange={setExpandedId}
          />
        )}
        {tab === "tracker" && (
          <TrackerTab
            screenings={screenings}
            stagesMap={stagesMap}
            onStageChange={handleStageChange}
            trackerData={trackerData}
            onTrackerDataChange={handleTrackerDataChange}
            onViewResult={(id: number) => { setExpandedId(id); setTab("pipeline"); }}
            onScreeningFieldSaved={(id, fields) => setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, ...fields } : s))}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            project={project}
            onNameSaved={(name) => setProject((p) => p ? { ...p, name } : p)}
            onStatusToggled={(status) => setProject((p) => p ? { ...p, status } : p)}
            onDeleted={() => window.location.href = "/projects"}
          />
        )}
      </main>
    </div>
  );
}
