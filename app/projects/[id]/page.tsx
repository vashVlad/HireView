"use client";
import * as XLSX from "xlsx";
import Link from "next/link";
import { Fragment, use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlreadyScreenedCard } from "@/components/AlreadyScreenedCard";
import { CalibrationButtons } from "@/components/CalibrationButtons";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { CrossReferenceChecker } from "@/components/CredibilityChecker";
import { FraudRiskChecker } from "@/components/FraudRiskChecker";
import { FilterSetView } from "@/components/FilterSetView";
import { InsightList } from "@/components/InsightList";
import { RejectionCard } from "@/components/RejectionCard";
import { ResultCard, type FitSuggestion, type AlreadyInProject } from "@/components/ResultCard";
import { TrajectoryRenderer } from "@/components/TrajectoryRenderer";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusStageControl } from "@/components/StatusStageControl";
import { TransferControl } from "@/components/TransferControl";
import { CANDIDATE_STATUS_LABELS, TRACKER_STAGES } from "@/lib/types";
import type {
  BlacklistEntry, CandidateResult, CandidateStatus, CheckExistingResult, ChecklistItem, CredibilityAssessment, CredibilitySignal,
  ExistingCandidateRef, FraudRiskAssessment, FullTrackerData, JDAnalysis, Project, ProjectChecklist, RejectionHistoryEntry, ScreenResumesError, ScreeningRecord, TrackerStage,
} from "@/lib/types";
import { ScoringLoader } from "@/components/ScoringLoader";
import type { ScreeningAction } from "@/lib/screeningActions";
import type { CrossProjectMatch } from "@/lib/screenings";
import { normalizeCandidateName } from "@/lib/resumeContentHash";
import { combineTargetCompanies } from "@/lib/targetCompanyBoost";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { computeMatchClusters, type MatchCluster } from "@/lib/matchClusters";
import SourceIcon from "@/components/SourceIcon";
import { getSourceType, type SourceType } from "@/lib/sourceType";

// Cross-project fit check eligibility margin, widened 2026-07-27 (Vlad: a
// candidate scoring 54 against a 50 threshold — a real but marginal pass —
// was never checked against another project where they scored 80). A
// candidate is eligible for the cross-project fit check whenever their score
// is below (project threshold + this margin) — covers the original
// below-threshold case (score < threshold) and now also a marginal pass
// (threshold <= score < threshold + margin). Only a comfortably-clearing
// score (threshold + margin or higher) is assumed not to need the check.
// See app/projects/[id]/page.tsx's ResultCard render loop and
// decisions-log.md's matching 2026-07-27 entry.
const FIT_CHECK_MARGIN = 15;

const SIGNAL_BADGE: Record<CredibilitySignal, { label: string; className: string; icon: string }> = {
  clean:                { label: "Cross-ref clean",          className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400", icon: "✓" },
  minor_concerns:       { label: "Cross-ref minor concerns", className: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",          icon: "⚠" },
  significant_concerns: { label: "Cross-ref flags",          className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",              icon: "⛔" },
};

type SearchMode = "wide" | "narrow";

type Tab = "filters" | "screen" | "pipeline" | "tracker" | "settings" | "archiveFits";

/** Archive Fits, 2026-07-30 — one row of the pending review queue, matches GET /api/projects/[id]/archive-fits's shape. */
interface ArchiveFitCandidate {
  id: number;
  screeningId: number;
  candidateName: string;
  score: number;
  suggestedRoleFit: string | null;
  /**
   * Stage 2, 2026-08-17 — see lib/archiveFits.ts's ArchiveFitQueueRow
   * comment for the full "why." Real checklist items this candidate's
   * strengths/concerns already back up, computed live (not persisted) so
   * it can never go stale against a since-edited checklist. Empty array
   * either way (no checklist configured, or genuinely no evidence found) —
   * the card just shows Stage 1's plain suggested-fit text in that case.
   */
  matchedChecklistItems: ChecklistItem[];
}
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

function FiltersTab({ analysis, projectId, jobDescription, onAnalysisUpdated, checklist, onChecklistUpdated }: {
  analysis: JDAnalysis;
  projectId: number;
  jobDescription: string;
  onAnalysisUpdated: (analysis: JDAnalysis, jobDescription: string) => void;
  /** null = checked, no checklist configured yet. undefined = not fetched (shouldn't happen once the parent's GET response includes it, kept for defensiveness). */
  checklist?: ProjectChecklist | null;
  onChecklistUpdated: (checklist: ProjectChecklist) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<SearchMode>("narrow");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);
  const [jdText, setJdText] = useState(jobDescription);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);
  const jdFileRef = useRef<HTMLInputElement>(null);

  // Score boost companies, 2026-08-07 (Vlad's ask) — see the card's own
  // comment below for the full "why" and how this relates to the LinkedIn
  // filter view's targetCompanies.
  const [companyInput, setCompanyInput] = useState("");
  const [savingCompanies, setSavingCompanies] = useState(false);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const boostCompanies = combineTargetCompanies(analysis.wide.targetCompanies, analysis.narrow.targetCompanies);

  async function saveBoostCompanies(newList: string[]) {
    setSavingCompanies(true);
    setCompaniesError(null);
    try {
      const newAnalysis: JDAnalysis = {
        ...analysis,
        wide: { ...analysis.wide, targetCompanies: newList },
        narrow: { ...analysis.narrow, targetCompanies: newList },
      };
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdAnalysis: newAnalysis }),
      });
      if (!res.ok) throw new Error("Save failed");
      onAnalysisUpdated(newAnalysis, jobDescription);
    } catch {
      setCompaniesError("Couldn't save — try again.");
    } finally {
      setSavingCompanies(false);
    }
  }

  // Editable Keywords/Job Titles boolean fields, 2026-08-07 (Vlad's ask) —
  // saves into whichever mode (wide/narrow) is currently selected via the
  // toggle above, since that's the exact FilterConfig FilterSetView is
  // rendering. Same PATCH-full-jdAnalysis pattern as saveBoostCompanies.
  const [filterFieldError, setFilterFieldError] = useState<string | null>(null);
  async function saveFilterField(field: "jobTitlesBoolean" | "keywords", value: string) {
    setFilterFieldError(null);
    try {
      const newAnalysis: JDAnalysis = {
        ...analysis,
        [mode]: { ...analysis[mode], [field]: value },
      };
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdAnalysis: newAnalysis }),
      });
      if (!res.ok) throw new Error("Save failed");
      onAnalysisUpdated(newAnalysis, jobDescription);
    } catch {
      setFilterFieldError("Couldn't save — try again.");
    }
  }

  function handleAddCompany() {
    const trimmed = companyInput.trim();
    if (!trimmed) return;
    if (boostCompanies.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCompanyInput("");
      return;
    }
    setCompanyInput("");
    saveBoostCompanies([...boostCompanies, trimmed]);
  }

  function handleRemoveCompany(company: string) {
    saveBoostCompanies(boostCompanies.filter((c) => c.toLowerCase() !== company.toLowerCase()));
  }

  // JD checklist ("Trust badge"), 2026-08-17 (Vlad's ask) — individually
  // editable items, not one freeform block (Vlad's explicit preference).
  // Local `items` mirrors the checklist prop so every keystroke stays
  // instant/local; a save (blur, or immediately for add/remove/regenerate)
  // PATCHes the whole array, same "full replacement, not per-field" pattern
  // FunnelView's other list-editing UIs already use.
  const [checklistTab, setChecklistTab] = useState<"decrease" | "add">("decrease");
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(checklist?.items ?? []);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [checklistError, setChecklistError] = useState<string | null>(null);
  const [generatingChecklist, setGeneratingChecklist] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // Re-sync local items whenever the parent hands down a genuinely new
  // checklist (e.g. after a regenerate finishes) — but not on every parent
  // re-render, or an in-progress local edit would get clobbered mid-keystroke.
  const checklistGeneratedAt = checklist?.generatedAt;
  useEffect(() => {
    setChecklistItems(checklist?.items ?? []);
  }, [checklistGeneratedAt]);

  async function saveChecklistItems(newItems: ChecklistItem[]) {
    setSavingChecklist(true);
    setChecklistError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/checklist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: newItems }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      onChecklistUpdated(data.checklist);
    } catch {
      setChecklistError("Couldn't save — try again.");
    } finally {
      setSavingChecklist(false);
    }
  }

  function handleChecklistFieldChange(id: string, field: "label" | "points", value: string) {
    setChecklistItems((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, [field]: field === "points" ? Math.max(1, Number(value) || 1) : value }
          : item
      )
    );
  }

  function handleAddChecklistItem(category: "decrease" | "add") {
    const newItem: ChecklistItem = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      category,
      label: "",
      points: category === "decrease" ? 10 : 5,
    };
    const newItems = [...checklistItems, newItem];
    setChecklistItems(newItems);
    saveChecklistItems(newItems);
  }

  function handleRemoveChecklistItem(id: string) {
    const newItems = checklistItems.filter((item) => item.id !== id);
    setChecklistItems(newItems);
    saveChecklistItems(newItems);
  }

  async function handleGenerateChecklist() {
    setGeneratingChecklist(true);
    setChecklistError(null);
    setConfirmRegenerate(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/checklist`, { method: "POST" });
      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setChecklistItems(data.checklist.items);
      onChecklistUpdated(data.checklist);
    } catch {
      setChecklistError("Couldn't generate a checklist — try again.");
    } finally {
      setGeneratingChecklist(false);
    }
  }

  const visibleChecklistItems = checklistItems.filter((item) => item.category === checklistTab);

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

              <FilterSetView config={mode === "wide" ? analysis.wide : analysis.narrow} editable onFieldChange={saveFilterField} />
              {filterFieldError && <p className="text-xs text-rose-500">{filterFieldError}</p>}

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
                    <span className="truncate">{jdFile ? jdFile.name : "Upload JD file (.pdf, .doc, or .docx)"}</span>
                    {jdFile && (
                      <button type="button" onClick={(e) => { e.preventDefault(); setJdFile(null); if (jdFileRef.current) jdFileRef.current.value = ""; }}
                        className="ml-auto shrink-0 text-zinc-400 hover:text-rose-500">✕</button>
                    )}
                    <input ref={jdFileRef} type="file" accept=".pdf,.doc,.docx" className="sr-only"
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

      {/* Score boost companies, 2026-08-07 (Vlad's ask): "add companies in
          there that would increase the score if it matches with the
          candidate's resume." Reuses analysis.wide/narrow.targetCompanies
          (same underlying JD Analyzer data, per Vlad's explicit choice) but
          deliberately its OWN card, separate from the LinkedIn Recruiter
          filters above — that view was already trimmed down to 5 filters
          (Vlad's earlier ask, see memory/jd_filter_output_feedback.md) and
          never showed target companies at all; this isn't un-decluttering
          that view, it's a new purpose for otherwise-unused data. Editing
          here writes the SAME list into both wide and narrow so the two
          stay in sync — see lib/targetCompanyBoost.ts's combineTargetCompanies
          for why the score-boost check still unions both (pre-existing
          projects may have them differ until edited here). +5 to the score
          for new screenings only — see lib/screenings.ts's saveScreening(). */}
      <div className="rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">Score boost companies</span>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            New candidates whose resume mentions any of these get +5 added to their score. Doesn't affect already-screened candidates.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {boostCompanies.length === 0 && (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">No companies added yet.</span>
          )}
          {boostCompanies.map((c) => (
            <span key={c} className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-500/10 dark:text-emerald-300">
              {c}
              <button type="button" onClick={() => handleRemoveCompany(c)} disabled={savingCompanies}
                className="text-emerald-500 hover:text-rose-500 disabled:opacity-50" aria-label={`Remove ${c}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCompany(); } }}
            placeholder="Add a company…"
            disabled={savingCompanies}
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button type="button" onClick={handleAddCompany} disabled={savingCompanies || !companyInput.trim()}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Add
          </button>
        </div>
        {companiesError && <p className="mt-2 text-xs text-rose-500">{companiesError}</p>}
      </div>

      {/* JD checklist ("Trust badge"), 2026-08-17 (Vlad's ask): specific,
          individually-checkable items derived from the JD — "decrease" items
          dock points when a genuine gap is unevidenced, "add" items award
          points when a reinforcing signal IS evidenced. Evaluated once per
          candidate at screening time (lib/evaluateChecklist.ts) and applied
          as a deterministic score delta (lib/screenings.ts's saveScreening,
          same pattern as the boost-companies card above) — never baked into
          scoreCandidate.ts's own judgment. Deliberately excludes
          target-company-match items to avoid double-counting with the card
          above — see lib/generateChecklist.ts's own comment. */}
      <div className="rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">JD checklist</span>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Specific, checkable items scored per candidate at screening time — decrease items dock points for unevidenced must-haves, add items award points for reinforcing signals.
            </p>
          </div>
          {checklistItems.length > 0 && !confirmRegenerate && (
            <button type="button" onClick={() => setConfirmRegenerate(true)} disabled={generatingChecklist}
              className="shrink-0 text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-300">
              Regenerate from JD
            </button>
          )}
        </div>

        {confirmRegenerate && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-500/10 dark:text-amber-300">
            <span className="flex-1">Regenerating replaces every item below, including any manual edits. Continue?</span>
            <button type="button" onClick={handleGenerateChecklist} className="font-semibold underline underline-offset-2">Yes, regenerate</button>
            <button type="button" onClick={() => setConfirmRegenerate(false)} className="text-amber-600 hover:text-amber-800 dark:text-amber-400">Cancel</button>
          </div>
        )}

        {generatingChecklist ? (
          <div className="mt-4 flex flex-col items-center gap-2 py-6">
            <ScoringLoader className="h-8 w-56" />
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Building checklist from the JD…</span>
          </div>
        ) : checklistItems.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">No checklist yet.</p>
            <button type="button" onClick={handleGenerateChecklist}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Generate checklist
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-1 self-start rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
              {([
                { key: "decrease" as const, label: "Decrease score" },
                { key: "add" as const, label: "Add score" },
              ]).map((t) => (
                <button key={t.key} type="button" onClick={() => setChecklistTab(t.key)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    checklistTab === t.key ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"}`}>
                  {t.label} ({checklistItems.filter((i) => i.category === t.key).length})
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {visibleChecklistItems.length === 0 && (
                <span className="text-sm text-zinc-400 dark:text-zinc-500">No {checklistTab === "decrease" ? "decrease" : "add"} items yet.</span>
              )}
              {visibleChecklistItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => handleChecklistFieldChange(item.id, "label", e.target.value)}
                    onBlur={() => saveChecklistItems(checklistItems)}
                    placeholder="Describe the specific, checkable signal…"
                    className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                  <input
                    type="number"
                    min={1}
                    value={item.points}
                    onChange={(e) => handleChecklistFieldChange(item.id, "points", e.target.value)}
                    onBlur={() => saveChecklistItems(checklistItems)}
                    className={`w-16 rounded-lg border px-2 py-1.5 text-center text-sm outline-none focus:ring-2 dark:bg-zinc-900 dark:text-zinc-100 ${
                      item.category === "decrease"
                        ? "border-rose-200 text-rose-600 focus:border-rose-400 focus:ring-rose-100 dark:border-rose-700/50 dark:text-rose-300"
                        : "border-emerald-200 text-emerald-600 focus:border-emerald-400 focus:ring-emerald-100 dark:border-emerald-700/50 dark:text-emerald-300"
                    }`}
                  />
                  <button type="button" onClick={() => handleRemoveChecklistItem(item.id)} disabled={savingChecklist}
                    className="shrink-0 text-zinc-400 hover:text-rose-500 disabled:opacity-50" aria-label="Remove item">
                    ×
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => handleAddChecklistItem(checklistTab)} disabled={savingChecklist}
                className="mt-1 self-start rounded-lg border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200">
                + Add {checklistTab === "decrease" ? "decrease" : "add"} item
              </button>
            </div>
          </>
        )}
        {checklistError && <p className="mt-2 text-xs text-rose-500">{checklistError}</p>}
      </div>
    </div>
  );
}

// ── Screen tab ─────────────────────────────────────────────────────────────
//
// Batch results persistence (sessionStorage), added 2026-07-28 (Vlad's ask):
// after screening a batch and clicking "View full result" on an
// already-screened candidate's card, pressing Back should return to that
// exact batch — not a blank Screen form. ScreenTab is conditionally rendered
// by its parent (`{tab === "screen" && <ScreenTab .../>}`), so it fully
// unmounts on any tab switch; the results view previously lived only in this
// component's React state with no URL of its own, so switching tabs and back
// (even without ever leaving the page) already lost it before this fix, not
// just the round trip through the candidate page. sessionStorage, keyed per
// project, survives both: read once synchronously on mount (via the lazy
// useState initializers below, before first paint) and written whenever the
// results view's data changes. Cleared on "Screen more" (handleReset).
//
// Raw File objects can't be persisted (not JSON-serializable) — restored
// existingMatches entries carry `file: undefined`, which
// AlreadyScreenedCard already handles gracefully (disables "Re-screen
// anyway" with a "try re-uploading" tooltip, the same pattern ResultCard's
// fit-suggestion/transfer actions already use for a missing original file).
// Everything else (viewing scores, status changes, "View full result",
// cross-project fit on the real results) is unaffected — those act on saved
// ids, not the raw file.
function batchStorageKey(projectId: number): string {
  return `hv:screen-batch:${projectId}`;
}

interface PersistedBatch {
  results: CandidateResult[];
  existingMatches: { match: CheckExistingResult }[];
  existingCandidates: ExistingCandidateRef[];
  nameMatches: [string, ExistingCandidateRef][];
  rejectionHistoryBaseline: RejectionHistoryEntry[];
  rejectionMatches: [string, RejectionHistoryEntry][];
  blacklistBaseline: BlacklistEntry[];
  blacklistMatches: [string, BlacklistEntry][];
  fileErrors: ScreenResumesError[];
  /** See the currentBatchId state below and app/projects/[id]/batches/[batchId]/page.tsx. */
  batchId?: string;
}

function readPersistedBatch(projectId: number): PersistedBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(batchStorageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBatch;
    if (!Array.isArray(parsed.results) || parsed.results.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ScreenTab({ project, onScreeningsSaved, onScreeningFieldSaved, stagesMap, onStageChange }: {
  project: Project;
  onScreeningsSaved: () => void;
  /**
   * Mirrors TrackerTab's prop of the same name/shape (below): patches the
   * parent's own `screenings` state directly by id, so a status/archive-
   * reason change made right here on a post-screening ResultCard is
   * reflected in the Pipeline tab immediately, without needing a full
   * `onScreeningsSaved`/`loadScreenings` refetch or a page reload. Vlad's
   * ask, 2026-07-20 — before this, handleStatusChange/handleArchiveReasonChange
   * below only ever updated this component's own local `results` state
   * (and the DB via PATCH), never the parent's `screenings`, so the change
   * was invisible on Pipeline until something else happened to trigger a
   * refetch (e.g. screening another batch).
   */
  onScreeningFieldSaved?: (id: number, fields: Partial<ScreeningRecord>) => void;
  /**
   * Same stagesMap/onStageChange the parent already threads into
   * PipelineTab/TrackerTab — passed through as-is so ResultCard's stage
   * picker (2026-07-31, Vlad's ask: "let the recruiter choose a screening
   * stage right after post-screening") writes to the exact same tracker
   * row/route (`PATCH /api/tracker/[screeningId]`) those tabs already use,
   * rather than a second parallel stage concept scoped to just this tab.
   */
  stagesMap: Record<number, TrackerStage>;
  onStageChange: (id: number, stage: TrackerStage) => void;
}) {
  // Read once per mount — see the block comment above this component for
  // why this exists. `initialBatch` is resolved before any of the state
  // below initializes, so each field below can restore from it in one pass.
  const [initialBatch] = useState(() => readPersistedBatch(project.id));

  const [files, setFiles] = useState<File[]>([]);
  const [screenView, setScreenView] = useState<ScreenView>(() => (initialBatch ? "results" : "form"));
  const [results, setResults] = useState<CandidateResult[]>(() => initialBatch?.results ?? []);
  const [fileErrors, setFileErrors] = useState<ScreenResumesError[]>(() => initialBatch?.fileErrors ?? []);
  const [formError, setFormError] = useState<string | null>(null);
  // Durable, database-backed link to this batch (/projects/[id]/batches/
  // [batchId]) — set from POST /api/screen-resumes's response once
  // something new is actually scored. Vlad's ask, 2026-07-28: a real
  // cross-device/shareable-with-a-teammate URL, since sessionStorage (this
  // component's own results-view restore, above) only ever lives in one
  // browser tab.
  // NOT cleared by handleReset()/"Screen more" (2026-07-28 fix — Claude Code
  // found the original behavior lost the link the moment "Screen more" was
  // clicked: if that next round turned out to be all-duplicate skips, no new
  // batchId is ever generated to replace it, so the duplicate cards'
  // "View full result" -> Back had nowhere real to go even though the prior
  // batch still exists in the DB. Only overwritten below (handleSubmit, once
  // a real new batchId comes back) — never cleared, so it always points at
  // the most recent batch that actually has content, across any number of
  // "Screen more" rounds. This is client-side-only React state either way,
  // so the fix has the same multi-team/cross-device story as the DB-backed
  // page itself — nothing here is shared across users, only the URL it
  // points to is.
  const [currentBatchId, setCurrentBatchId] = useState<string | undefined>(() => initialBatch?.batchId);
  // "Link to this batch" also copies the URL to the clipboard, 2026-08-04
  // (Vlad's ask) — same origin+path copy pattern already used for the
  // per-candidate share link (handleCopyLink in this file's PipelineTab) and
  // app/candidates/page.tsx. Does not prevent the normal navigation — the
  // link still works as a link, this just also puts the URL on the
  // clipboard so the recruiter can paste it somewhere (Slack, email) without
  // a separate copy step.
  const [batchLinkCopied, setBatchLinkCopied] = useState(false);
  async function handleCopyBatchLink(batchId: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/projects/${project.id}/batches/${batchId}`);
    setBatchLinkCopied(true);
    setTimeout(() => setBatchLinkCopied(false), 1500);
  }
  // Files that matched an existing screening in this project via the free
  // pre-check (app/api/screen-resumes/check-existing) — set aside before
  // ever reaching the scoring route, keyed by the original File so a
  // "Re-screen anyway" can still send it through on demand.
  //
  // Only "duplicate" (exact content-hash match) belongs here — that's the
  // only status check-existing returns besides "new" as of 2026-07-15.
  // Filename-only matching ("possible_update") was removed the same day: it
  // compared incidental filename strings rather than real identity, and
  // false-flagged unrelated candidates who happened to share a generic
  // download filename (e.g. "Resume (16).pdf" — the default browser
  // auto-rename for any resume literally named "Resume.pdf", which
  // normalizes to nothing but the bare word "resume"). The real case this
  // was trying to catch — a genuinely returning candidate — is already
  // covered more reliably by the post-score name-match check below
  // (existingCandidates/nameMatches), which compares actual extracted
  // identity instead of a filename. See decisions-log.md, 2026-07-15.
  // `file` is optional — undefined right after a sessionStorage restore
  // (raw File objects aren't JSON-serializable), see the block comment
  // above this component. AlreadyScreenedCard already handles that case.
  const [existingMatches, setExistingMatches] = useState<
    { match: CheckExistingResult; file?: File }[]
  >(() => initialBatch?.existingMatches ?? []);
  // Candidates already saved in this project, by normalized name — the one
  // signal exact-content hashing can't catch (two different resume files
  // for the same person). Populated during the pre-check, compared against
  // AFTER scoring since candidate name doesn't exist before then.
  const [existingCandidates, setExistingCandidates] = useState<ExistingCandidateRef[]>(() => initialBatch?.existingCandidates ?? []);
  // fileName -> matched existing candidate, purely informational (scoring
  // already happened by the time a name match is knowable).
  const [nameMatches, setNameMatches] = useState<Map<string, ExistingCandidateRef>>(
    () => new Map(initialBatch?.nameMatches ?? [])
  );
  // System-wide (any project, any team) prior rejections, by normalized
  // name — Teti's request, 2026-07-10. Same pattern as nameMatches, just
  // sourced from checkData.rejectionHistory instead of existingCandidates.
  const [rejectionHistoryBaseline, setRejectionHistoryBaseline] = useState<RejectionHistoryEntry[]>(() => initialBatch?.rejectionHistoryBaseline ?? []);
  const [rejectionMatches, setRejectionMatches] = useState<Map<string, RejectionHistoryEntry>>(
    () => new Map(initialBatch?.rejectionMatches ?? [])
  );
  // System-wide blacklist, 2026-07-31 (Vlad's ask) — identical pattern to
  // rejectionHistoryBaseline/rejectionMatches above, just sourced from
  // checkData.blacklist instead.
  const [blacklistBaseline, setBlacklistBaseline] = useState<BlacklistEntry[]>(() => initialBatch?.blacklistBaseline ?? []);
  const [blacklistMatches, setBlacklistMatches] = useState<Map<string, BlacklistEntry>>(
    () => new Map(initialBatch?.blacklistMatches ?? [])
  );
  // Source picker, 2026-07-20 (Vlad's ask): three mutually-exclusive types —
  // Applicant (default), LinkedIn (existing linkedin_mode, unchanged scoring
  // behavior via isLinkedInMode below), Agency (new, carries a free-text
  // agency name, no scoring impact — see lib/sourceType.ts). `isLinkedInMode`
  // kept as a derived const rather than removed so every existing
  // isLinkedInMode-keyed copy string/behavior below (screen button label,
  // loading text, formData wiring) needed zero other changes.
  const [sourceType, setSourceType] = useState<SourceType>("applicant");
  const [agencyNameInput, setAgencyNameInput] = useState("");
  const isLinkedInMode = sourceType === "linkedin";
  // undefined = not checked yet, 0 = checked and there's nothing to suggest against.
  const [otherActiveCount, setOtherActiveCount] = useState<number | undefined>(undefined);
  // Serializes every cross-project-fit call — gate checks and real checks,
  // auto-fired and manual alike — to at most one in flight at a time, so a
  // batch of several below-threshold candidates can't burst concurrent
  // Claude calls.
  const fitQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Cancel-during-screening — client-side only, since scoreCandidate.ts and
  // app/api/screen-resumes/route.ts are do-not-touch (no server-side way to
  // abort a Claude call already in flight). Aborting the fetch just stops
  // this browser tab from waiting on the response and discards whatever
  // comes back; it does not stop Claude API usage for calls already
  // in-flight server-side by the time Cancel is clicked. Vlad's ask,
  // 2026-07-17 — a batch of several resumes could otherwise leave a
  // recruiter stuck watching a spinner with no way out.
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (screenView !== "results") return;
    let cancelled = false;
    fetch(`/api/cross-project-fit?currentProjectId=${project.id}`)
      .then((res) => (res.ok ? res.json() : { count: 0 }))
      .then((data) => { if (!cancelled) setOtherActiveCount(data.count ?? 0); })
      .catch(() => { if (!cancelled) setOtherActiveCount(0); });
    return () => { cancelled = true; };
  }, [screenView, project.id]);

  // Keep sessionStorage in sync with the results view — see the block
  // comment above this component. Fires on every relevant change (status
  // updates, a forced rescore, etc.), not just once at batch-completion
  // time, so a restored view stays consistent with anything the recruiter
  // did before navigating away and back.
  useEffect(() => {
    if (screenView !== "results" || results.length === 0) return;
    const toPersist: PersistedBatch = {
      results,
      existingMatches: existingMatches.map(({ match }) => ({ match })),
      existingCandidates,
      nameMatches: [...nameMatches.entries()],
      rejectionHistoryBaseline,
      rejectionMatches: [...rejectionMatches.entries()],
      blacklistBaseline,
      blacklistMatches: [...blacklistMatches.entries()],
      fileErrors,
      batchId: currentBatchId,
    };
    try {
      window.sessionStorage.setItem(batchStorageKey(project.id), JSON.stringify(toPersist));
    } catch {
      // Storage full/unavailable — non-fatal, just means Back won't restore this time.
    }
  }, [screenView, results, existingMatches, existingCandidates, nameMatches, rejectionHistoryBaseline, rejectionMatches, blacklistBaseline, blacklistMatches, fileErrors, currentBatchId, project.id]);

  async function handleStatusChange(id: number, status: CandidateStatus) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    // Vlad's ask, 2026-07-20: "let me also change the status" on
    // AlreadyScreenedCard, not just view it — that card's data lives in
    // existingMatches (a CheckExistingResult, not a CandidateResult), so it
    // needs its own branch of this same optimistic update. Harmless no-op
    // map over existingMatches when id belongs to a regular result instead.
    setExistingMatches((prev) =>
      prev.map((m) => (m.match.existing?.id === id ? { ...m, match: { ...m.match, existing: { ...m.match.existing!, status } } } : m))
    );
    const statusUpdatedAt = new Date().toISOString();
    onScreeningFieldSaved?.(id, { status, statusUpdatedAt });
    try {
      await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { /* non-fatal */ }
  }

  // Mirrors handleStatusChange above — added 2026-07-15 so the post-screening
  // ResultCard's archive-reason picker (StatusSelect) has somewhere to save
  // to, same as StatusStageControl's reason segment on Pipeline/All Candidates.
  async function handleArchiveReasonChange(id: number, archiveReason: string) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, archiveReason } : r)));
    // Same AlreadyScreenedCard branch as handleStatusChange above.
    setExistingMatches((prev) =>
      prev.map((m) => (m.match.existing?.id === id ? { ...m, match: { ...m.match, existing: { ...m.match.existing!, archiveReason } } } : m))
    );
    onScreeningFieldSaved?.(id, { archiveReason });
    try {
      await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveReason }),
      });
    } catch { /* non-fatal */ }
  }

  // Blacklist, 2026-07-31 (Vlad's ask) — mirrors handleArchiveReasonChange
  // exactly, same optimistic-update + PATCH /api/history/[id] shape.
  async function handleBlacklistChange(id: number, blacklisted: boolean, blacklistReason: string | null) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, blacklisted, blacklistReason: blacklistReason ?? undefined } : r)));
    onScreeningFieldSaved?.(id, { blacklisted, blacklistReason: blacklistReason ?? undefined });
    try {
      await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blacklisted, blacklistReason }),
      });
    } catch { /* non-fatal */ }
  }

  // Sends exactly the files given to the real scoring route, unchanged from
  // how it's always been called — this function is the only thing that
  // decides which files reach it, so /api/screen-resumes and scoreCandidate
  // stay completely untouched either way.
  async function scoreFiles(filesToScore: File[], signal?: AbortSignal): Promise<{ results: CandidateResult[]; errors: ScreenResumesError[]; batchId?: string }> {
    const formData = new FormData();
    formData.set("jobDescription", project.jobDescription);
    formData.set("roleContext", project.name);
    formData.set("projectId", String(project.id));
    if (isLinkedInMode) formData.set("linkedInMode", "true");
    if (sourceType === "agency" && agencyNameInput.trim()) formData.set("agencyName", agencyNameInput.trim());
    filesToScore.forEach((f) => formData.append("resumes", f));

    const res = await fetch("/api/screen-resumes", { method: "POST", body: formData, signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "Something went wrong while screening resumes.");
    }
    const data = await res.json();
    return {
      results: Array.isArray(data.results) ? data.results : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      batchId: typeof data.batchId === "string" ? data.batchId : undefined,
    };
  }

  async function handleSubmit() {
    if (files.length === 0) return;
    setFormError(null);
    setScreenView("loading");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Free pre-check first — anything that already exists in this project
      // never reaches the scoring route at all, so it never costs a Claude call.
      const checkFormData = new FormData();
      checkFormData.set("projectId", String(project.id));
      files.forEach((f) => checkFormData.append("resumes", f));

      let classifications: CheckExistingResult[] = [];
      let candidates: ExistingCandidateRef[] = [];
      let rejections: RejectionHistoryEntry[] = [];
      let blacklistEntries: BlacklistEntry[] = [];
      try {
        const checkRes = await fetch("/api/screen-resumes/check-existing", { method: "POST", body: checkFormData, signal: controller.signal });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          classifications = Array.isArray(checkData.results) ? checkData.results : [];
          candidates = Array.isArray(checkData.existingCandidates) ? checkData.existingCandidates : [];
          rejections = Array.isArray(checkData.rejectionHistory) ? checkData.rejectionHistory : [];
          blacklistEntries = Array.isArray(checkData.blacklist) ? checkData.blacklist : [];
        }
      } catch (err) {
        // Re-throw an abort so the outer catch handles it as a cancel, not a
        // silently-swallowed pre-check failure — everything else about a
        // failed pre-check is still fine to fall through on.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
      }

      const byFileName = new Map(classifications.map((c) => [c.fileName, c]));
      const newFiles: File[] = [];
      const matched: { match: CheckExistingResult; file: File }[] = [];
      for (const f of files) {
        const c = byFileName.get(f.name);
        if (c && c.existing && c.status === "duplicate") {
          // Exact content match — genuinely nothing new to learn, safe to skip scoring.
          matched.push({ match: c, file: f });
        } else {
          newFiles.push(f);
        }
      }

      // Each uploaded file's own resume_content_hash, computed for free by
      // check-existing regardless of duplicate status — used below to
      // corroborate rejection-history name matches against the actual
      // document, not just the candidate's name text.
      const hashByFileName = new Map(
        classifications
          .filter((c): c is CheckExistingResult & { resumeContentHash: string } => Boolean(c.resumeContentHash))
          .map((c) => [c.fileName, c.resumeContentHash])
      );

      const { results: scored, errors, batchId } = newFiles.length > 0
        ? await scoreFiles(newFiles, controller.signal)
        : { results: [], errors: [], batchId: undefined as string | undefined };

      setResults(scored);
      setFileErrors(errors);
      setExistingMatches(matched);
      setExistingCandidates(candidates);
      setNameMatches(findNameMatches(scored, candidates));
      setRejectionHistoryBaseline(rejections);
      setRejectionMatches(findRejectionMatches(scored, rejections, hashByFileName));
      setBlacklistBaseline(blacklistEntries);
      setBlacklistMatches(findBlacklistMatches(scored, blacklistEntries, hashByFileName));
      // Durable "come back to this batch" link — only set when this call
      // actually scored something new (batchId is undefined when every file
      // in the upload was a duplicate skip, matching newFiles.length > 0
      // above). See the block comment above ScreenTab.
      if (batchId) setCurrentBatchId(batchId);
      setScreenView("results");
      if (scored.length > 0) onScreeningsSaved();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User-initiated cancel (handleCancel below) — quietly back out to
        // the form instead of surfacing this as an error. Any candidates
        // that had already finished saving server-side before the cancel
        // was clicked are still in the DB (best-effort, not rolled back —
        // Claude calls already in flight can't be stopped from the client)
        // and will simply show up on the Pipeline tab on next visit.
        setFormError(null);
      } else {
        setFormError(err instanceof Error ? err.message : "Unknown error");
      }
      setScreenView("form");
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  // Neither the hash nor filename pre-check can catch "two different resume
  // files that turn out to be the same candidate" — the name only exists
  // once scoring is done. Purely informational by the time this runs: the
  // Claude call already happened, this just surfaces it instead of leaving
  // two silent, unlinked cards. Checks against candidates already saved in
  // the project AND against siblings scored in the same batch.
  function findNameMatches(scored: CandidateResult[], baseline: ExistingCandidateRef[]): Map<string, ExistingCandidateRef> {
    const byNormalizedName = new Map(baseline.map((c) => [normalizeCandidateName(c.candidateName), c]));
    const matches = new Map<string, ExistingCandidateRef>();
    for (const r of scored) {
      const key = normalizeCandidateName(r.candidateName);
      const existing = byNormalizedName.get(key);
      if (existing) {
        matches.set(r.fileName, existing);
      } else {
        // First time seeing this name in the batch — register it so a later
        // sibling with the same name (but a different file) gets flagged too.
        byNormalizedName.set(key, { id: r.id ?? -1, candidateName: r.candidateName });
      }
    }
    return matches;
  }

  // System-wide (any project, any team) rejection history — same pattern as
  // findNameMatches, just matched against rejectionHistoryBaseline instead
  // of same-project candidates. No batch-sibling registration here (unlike
  // findNameMatches): two people in the SAME upload batch coincidentally
  // sharing a name isn't "this candidate was rejected before."
  //
  // Tightened 2026-07-29 (meeting-prep audit flagged this as a real risk):
  // the name match alone is deliberately loose (normalizeCandidateName is
  // case/whitespace-only), so two different people sharing a common name
  // could get flagged as the same rejected candidate. hashByFileName carries
  // each uploaded file's own resume_content_hash (computed for free by
  // check-existing, unrelated to whether it was itself a same-project
  // duplicate) — when it exactly matches the rejected screening's own hash,
  // this is the same document, not just the same name, so confidence is
  // upgraded to "name_and_resume". A file-name-based secondary signal was
  // considered and rejected: that approach was already tried and retired
  // 2026-07-15 for producing false positives on generic filenames like
  // "Resume (16).pdf" — see decisions-log.md.
  function findRejectionMatches(
    scored: CandidateResult[],
    baseline: RejectionHistoryEntry[],
    hashByFileName: Map<string, string> = new Map()
  ): Map<string, RejectionHistoryEntry> {
    const byNormalizedName = new Map(baseline.map((r) => [normalizeCandidateName(r.candidateName), r]));
    const matches = new Map<string, RejectionHistoryEntry>();
    for (const r of scored) {
      const hit = byNormalizedName.get(normalizeCandidateName(r.candidateName));
      if (!hit) continue;
      const uploadedHash = hashByFileName.get(r.fileName);
      const confidence: RejectionHistoryEntry["confidence"] =
        hit.contentHash != null && uploadedHash != null && hit.contentHash === uploadedHash
          ? "name_and_resume"
          : "name_only";
      matches.set(r.fileName, { ...hit, confidence });
    }
    return matches;
  }

  // Blacklist, 2026-07-31 (Vlad's ask) — identical shape/reasoning to
  // findRejectionMatches above, just matched against blacklistBaseline.
  function findBlacklistMatches(
    scored: CandidateResult[],
    baseline: BlacklistEntry[],
    hashByFileName: Map<string, string> = new Map()
  ): Map<string, BlacklistEntry> {
    const byNormalizedName = new Map(baseline.map((b) => [normalizeCandidateName(b.candidateName), b]));
    const matches = new Map<string, BlacklistEntry>();
    for (const r of scored) {
      const hit = byNormalizedName.get(normalizeCandidateName(r.candidateName));
      if (!hit) continue;
      const uploadedHash = hashByFileName.get(r.fileName);
      const confidence: BlacklistEntry["confidence"] =
        hit.contentHash != null && uploadedHash != null && hit.contentHash === uploadedHash
          ? "name_and_resume"
          : "name_only";
      matches.set(r.fileName, { ...hit, confidence });
    }
    return matches;
  }

  // A recruiter overriding a "duplicate" card — forces a real score for
  // that one file and folds it into the normal results list.
  async function handleForceRescore(file: File) {
    // Grab this file's resume_content_hash (already computed by the earlier
    // check-existing call, before it's dropped from existingMatches below) so
    // a rejection-history match found after re-scoring can still be
    // corroborated against the actual document, not just the candidate name.
    const priorHash = existingMatches.find((m) => m.file === file)?.match.resumeContentHash;
    const hashByFileName = priorHash ? new Map([[file.name, priorHash]]) : new Map<string, string>();

    setExistingMatches((prev) => prev.filter((m) => m.file !== file));
    try {
      const { results: scored, errors } = await scoreFiles([file]);
      const merged = [...results, ...scored].sort((a, b) => b.score - a.score);
      setResults(merged);
      setNameMatches(findNameMatches(merged, existingCandidates));
      setRejectionMatches(findRejectionMatches(merged, rejectionHistoryBaseline, hashByFileName));
      setBlacklistMatches(findBlacklistMatches(merged, blacklistBaseline, hashByFileName));
      if (errors.length > 0) setFileErrors((prev) => [...prev, ...errors]);
      if (scored.length > 0) onScreeningsSaved();
    } catch (err) {
      setFileErrors((prev) => [...prev, { fileName: file.name, error: err instanceof Error ? err.message : "Re-screen failed" }]);
    }
  }

  function handleReset() {
    setScreenView("form");
    setResults([]);
    setFileErrors([]);
    setFiles([]);
    setExistingMatches([]);
    setExistingCandidates([]);
    setNameMatches(new Map());
    setRejectionHistoryBaseline([]);
    setRejectionMatches(new Map());
    // currentBatchId is deliberately NOT cleared here — see its declaration
    // above for why (2026-07-28 fix).
    try {
      window.sessionStorage.removeItem(batchStorageKey(project.id));
    } catch {
      // non-fatal
    }
  }

  if (screenView === "results") {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Screening results</h3>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {results.length} candidate{results.length !== 1 ? "s" : ""} ranked by fit
              {existingMatches.length > 0 && ` · ${existingMatches.length} already screened, skipped`}
              {fileErrors.length > 0 && ` · ${fileErrors.length} file${fileErrors.length !== 1 ? "s" : ""} failed`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Durable, bookmarkable/shareable link to this exact batch —
                Vlad's ask, 2026-07-28. Only present once at least one new
                candidate was actually scored (see currentBatchId above). */}
            {currentBatchId && (
              <Link
                href={`/projects/${project.id}/batches/${currentBatchId}`}
                onClick={() => handleCopyBatchLink(currentBatchId)}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {batchLinkCopied ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Link copied
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Link to this batch
                  </>
                )}
              </Link>
            )}
            <button type="button" onClick={handleReset}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
              Screen more
            </button>
          </div>
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
          {results.map((result, i) => {
            // Cross-project fit eligibility, widened 2026-07-27 (Vlad: a
            // candidate scored 54 against FDE's 50 threshold — a real pass —
            // and was never checked against Data Architect for Banking,
            // where they'd have scored 80. The original design only ever
            // asked "did THIS project reject you" (score < threshold); it
            // never asked "did you only barely clear the bar, when
            // something much better might exist elsewhere." FIT_CHECK_MARGIN
            // widens eligibility to also cover marginal passes — a
            // candidate scoring up to 15 points above threshold is still
            // checked, only a comfortably-clearing score (threshold + 15 or
            // more) is assumed to not need it. Below-threshold candidates
            // (the original case) are still fully covered, since anything
            // under threshold is also under threshold + 15.
            //
            // Suppressed entirely, 2026-07-27, when a cross-project NAME
            // match already fired (Vlad: "don't try to screen again for
            // that already screened project... don't show looking for a
            // better fit — just show that it was already screened"). If we
            // already positively know this exact candidate was screened for
            // a specific other project (crossProjectNameMatchScreeningId,
            // set in lib/screenings.ts), there's no point spending a Claude
            // call guessing which OTHER project might fit better — we
            // already know exactly where they exist. ResultCard shows the
            // "Also screened in [project]" mention instead (unconditional
            // on crossProjectNameMatchScreeningId, independent of this flag).
            const eligibleForFitCheck =
              result.score < project.scoreThreshold + FIT_CHECK_MARGIN
              && result.crossProjectNameMatchScreeningId == null;
            return (
            <ResultCard
              key={result.fileName}
              result={result}
              rank={i + 1}
              jdAnalysis={project.jdAnalysis}
              onStatusChange={handleStatusChange}
              onArchiveReasonChange={handleArchiveReasonChange}
              onBlacklistChange={handleBlacklistChange}
              stage={result.id != null ? stagesMap[result.id] ?? null : null}
              onStageChange={onStageChange}
              nameMatch={nameMatches.get(result.fileName)}
              roleContext={project.name}
              rejectionHistory={rejectionMatches.get(result.fileName)}
              blacklistMatch={blacklistMatches.get(result.fileName)}
              scoreThreshold={project.scoreThreshold}
              eligibleForFitCheck={eligibleForFitCheck}
              otherActiveCount={otherActiveCount}
              onCheckCrossProjectPromise={eligibleForFitCheck ? () => {
                const run = async () => {
                  const file = files.find((f) => f.name === result.fileName);
                  if (!file) return { promising: false, alreadyIn: [] as AlreadyInProject[] };
                  const fd = new FormData();
                  fd.set("resumeFile", file);
                  fd.set("currentProjectId", String(project.id));
                  fd.set("candidateName", result.candidateName);
                  const res = await fetch("/api/cross-project-fit/gate", { method: "POST", body: fd });
                  if (!res.ok) return { promising: false, alreadyIn: [] as AlreadyInProject[] };
                  const data = await res.json().catch(() => null);
                  return {
                    promising: Boolean(data?.promising),
                    alreadyIn: (data?.alreadyIn ?? []) as AlreadyInProject[],
                  };
                };
                // Chained onto the same shared queue as onFindBetterFit below —
                // gate checks and real checks never run concurrently either.
                const chained = fitQueueRef.current.then(run, run);
                fitQueueRef.current = chained.catch(() => {});
                return chained as Promise<{ promising: boolean; alreadyIn: AlreadyInProject[] }>;
              } : undefined}
              onFindBetterFit={eligibleForFitCheck ? () => {
                const run = async () => {
                  const file = files.find((f) => f.name === result.fileName);
                  if (!file) throw new Error("Original file no longer available — try re-uploading");
                  const fd = new FormData();
                  fd.set("resumeFile", file);
                  fd.set("currentProjectId", String(project.id));
                  fd.set("candidateName", result.candidateName);
                  // Vlad's ask, 2026-07-30: the suggestion is labeled
                  // "stronger fit," so the server needs this project's own
                  // score to actually enforce that — see cross-project-fit's
                  // matching comment on the `best` filter.
                  fd.set("currentScore", String(result.score));
                  const res = await fetch("/api/cross-project-fit", { method: "POST", body: fd });
                  if (!res.ok) {
                    const body = await res.json().catch(() => null);
                    throw new Error(body?.error ?? "Could not check other roles");
                  }
                  const data = await res.json();
                  return {
                    suggestion: (data.suggestion ?? null) as FitSuggestion | null,
                    alreadyIn: (data.alreadyIn ?? []) as AlreadyInProject[],
                  };
                };
                // Chain onto the shared queue so this call waits for anything
                // already in flight, regardless of which card triggered it.
                const chained = fitQueueRef.current.then(run, run);
                fitQueueRef.current = chained.catch(() => {});
                return chained as Promise<{ suggestion: FitSuggestion | null; alreadyIn: AlreadyInProject[] }>;
              } : undefined}
              onTransferToProject={eligibleForFitCheck ? async (suggestion: FitSuggestion) => {
                const file = files.find((f) => f.name === result.fileName);
                if (!file) throw new Error("Original file no longer available — try re-uploading");
                const fd = new FormData();
                fd.set("resultJson", JSON.stringify(suggestion.result));
                fd.set("resumeFile", file);
                fd.set("jobDescription", suggestion.jobDescription);
                fd.set("projectId", String(suggestion.projectId));
                if (isLinkedInMode) fd.set("linkedInMode", "true");
                if (sourceType === "agency" && agencyNameInput.trim()) fd.set("agencyName", agencyNameInput.trim());
                const res = await fetch("/api/screenings/save-one", { method: "POST", body: fd });
                if (!res.ok) {
                  const body = await res.json().catch(() => null);
                  throw new Error(body?.error ?? "Transfer failed");
                }
                // Not touching result.id here — this screening now belongs to
                // suggestion.projectId, a different project, not this one.
                onScreeningsSaved();
              } : undefined}
            />
            );
          })}
          {existingMatches.map(({ match, file }) => (
            <AlreadyScreenedCard
              key={match.fileName}
              fileName={match.fileName}
              existing={match.existing!}
              file={file}
              onForceRescore={handleForceRescore}
              onStatusChange={handleStatusChange}
              onArchiveReasonChange={handleArchiveReasonChange}
              returnTo={currentBatchId ? `/projects/${project.id}/batches/${currentBatchId}` : undefined}
            />
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

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex flex-wrap gap-1.5">
          {/* Colors updated 2026-07-27 (Vlad's ask) — gray/LinkedIn-blue/orange
              everywhere a source is shown; see SourceIcon.tsx's header comment. */}
          <button type="button" onClick={() => setSourceType("applicant")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              sourceType === "applicant"
                ? "bg-zinc-500 text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}>
            <SourceIcon type="applicant" showApplicant size={14} />
            Applicants
          </button>
          <button type="button" onClick={() => setSourceType("linkedin")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              sourceType === "linkedin"
                ? "bg-[#0A66C2] text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}>
            <SourceIcon type="linkedin" size={14} />
            Sourced
          </button>
          <button type="button" onClick={() => setSourceType("agency")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-colors ${
              sourceType === "agency"
                ? "bg-orange-500 text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}>
            <SourceIcon type="agency" size={14} />
            Agency
          </button>
        </div>
        <span className="text-sm text-zinc-400 dark:text-zinc-500">
          {sourceType === "linkedin"
            ? "— adjusts scoring for profile PDFs"
            : sourceType === "agency"
            ? "— label only, scoring unaffected"
            : "— default, no scoring adjustment"}
        </span>
        {sourceType === "agency" && (
          <input
            type="text"
            placeholder="Agency name…"
            value={agencyNameInput}
            onChange={(e) => setAgencyNameInput(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder-zinc-400 focus:border-orange-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
        )}
      </div>

      <ResumeUploader files={files} onFilesChange={setFiles} />

      {formError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {formError}
        </div>
      )}

      {screenView === "loading" && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 py-6 dark:border-zinc-800 dark:bg-zinc-800/40">
          <ScoringLoader className="h-10 w-72" />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {isLinkedInMode ? "Screening profiles…" : "Screening resumes…"}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={handleSubmit}
          disabled={files.length === 0 || screenView === "loading"}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
          {screenView === "loading" ? (
            isLinkedInMode ? "Screening profiles..." : "Screening resumes..."
          ) : isLinkedInMode ? "Screen profiles" : "Screen resumes"}
        </button>
        {screenView === "loading" && (
          <button
            type="button"
            onClick={handleCancel}
            title="Stops waiting on this batch and returns you to the upload form — any candidates that had already finished scoring server-side before you cancel are still saved."
            className="shrink-0 rounded-2xl border border-zinc-200 px-5 py-3.5 text-sm font-semibold text-zinc-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Pipeline tab ───────────────────────────────────────────────────────────

/** Reads one query param from window.location.search — guarded for SSR,
 *  where PipelineTab's lazy useState initializers can run before `window`
 *  exists. See those initializers' own comment for why this reads on mount
 *  rather than reactively. */
function readPipelineUrlParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

function PipelineTab({ screenings: initialScreenings, projectId, stagesMap, onStageChange, onScreeningFieldSaved, onDeleted, expandedId: externalExpandedId, onExpandedChange }: {
  screenings: ScreeningRecord[];
  projectId: number;
  stagesMap: Record<number, TrackerStage>;
  onStageChange: (id: number, stage: TrackerStage) => void;
  /**
   * Patches the parent's own `screenings` state directly by id, mirroring
   * ScreenTab's/TrackerTab's prop of the same name/shape. Fixed 2026-08-03 —
   * real bug Vlad hit: a candidate could need its archive reason picked
   * TWICE before it actually sank to the Archived section. Root cause: this
   * used to be a narrower `onStatusChange?: (id, status) => void` prop, and
   * the parent's handler reconstructed each row from its OWN stale copy of
   * `s` (`{ ...s, status, statusUpdatedAt }`) — which never had `archiveReason`
   * on it, since `handleArchiveReasonChange` below only ever updated this
   * component's LOCAL `screenings` state, never the parent's. The first
   * status change (picking a reason fires both together, see
   * StatusStageControl.tsx) round-tripped through the parent and back down
   * via the `useEffect` that resyncs local state from the `screenings` prop,
   * stomping the just-picked `archiveReason` back to blank — so the card
   * looked like it needed a reason again, and the SECOND pick worked only
   * because by then no accompanying status change fired to trigger another
   * resync. Passing whole field patches instead of a single reconstructed
   * value means the parent always merges onto its own current row instead
   * of overwriting it, so this can't recur for any field this component
   * saves through it (status, archiveReason, blacklist, transfer).
   */
  onScreeningFieldSaved?: (id: number, fields: Partial<ScreeningRecord>) => void;
  /** Propagates a delete up to the parent's own screenings state — this component's `screenings` is a local fork seeded from the initial prop, so without this the parent's tab-count and header-count badges (both derived from its own `screenings.length`) stay stale until a full reload. */
  onDeleted?: (id: number) => void;
  expandedId?: number | null;
  onExpandedChange?: (id: number | null) => void;
}) {
  const [screenings, setScreenings] = useState(initialScreenings);
  // Filters below read their initial value from the URL (2026-08-11, Vlad's
  // ask — pressing Back after following an internal link into this project,
  // e.g. "Also screened in [project]", should land back on the same
  // filtered/sorted/searched view, not a reset one). Lazy useState
  // initializers so this only reads window.location once, on this
  // component's own mount — PipelineTab remounts fresh every time the
  // parent's tab switches to "pipeline" (conditionally rendered), which is
  // exactly when a restored value should be picked back up. The write side
  // (below, useEffect) keeps the URL in sync as these change; the parent
  // page owns the matching sync for tab/candidate — see its own effect.
  const [search, setSearch] = useState(() => readPipelineUrlParam("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | null>(() => {
    const v = readPipelineUrlParam("status");
    const valid: CandidateStatus[] = ["new_applicant", "recruiter_screen", "contacted", "screening", "archived", "transferred"];
    return v && (valid as string[]).includes(v) ? (v as CandidateStatus) : null;
  });
  // Recruiter filter, 2026-07-20 (Vlad's ask): screenings.user_id is now
  // surfaced as recruiterId/recruiterEmail (lib/screenings.ts, mirrors
  // FunnelView's getRecruiterEmailMap pattern), so multi-recruiter projects
  // can be narrowed to "who screened this" the same way status/score already
  // filter. null = all recruiters.
  const [recruiterFilter, setRecruiterFilter] = useState<string | null>(() => readPipelineUrlParam("recruiter"));
  // Flagged filter, 2026-07-20 (Vlad's ask). Orthogonal to status, so a
  // standalone toggle pill rather than an entry in STATUS_PILLS.
  const [flaggedFilter, setFlaggedFilter] = useState(() => readPipelineUrlParam("flagged") === "1");
  // "newest" added 2026-07-29 (Vlad's ask: "add a recent filter to the
  // pipeline which will show the newest screenings") — sorts by
  // ScreeningRecord.createdAt descending, independent of score. Same
  // archived-sinks-to-bottom / Ring-grouping precedence as the score sorts
  // below it (see filteredScreenings' comparator).
  const [sortOrder, setSortOrder] = useState<"default" | "desc" | "asc" | "newest">(() => {
    const v = readPipelineUrlParam("sort");
    const valid = ["default", "desc", "asc", "newest"];
    return valid.includes(v ?? "") ? (v as "default" | "desc" | "asc" | "newest") : "default";
  });
  // Keeps the URL's search/status/recruiter/flagged/sort params in sync with
  // the filters above, the same replaceState-in-place approach the parent
  // page uses for tab/candidate (see that file's own matching comment) —
  // merges onto whatever's already in the URL rather than clobbering it, so
  // this and the parent's tab/candidate sync (and each other's non-filter
  // params) don't stomp on each other.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (search) params.set("search", search); else params.delete("search");
    if (statusFilter) params.set("status", statusFilter); else params.delete("status");
    if (recruiterFilter) params.set("recruiter", recruiterFilter); else params.delete("recruiter");
    if (flaggedFilter) params.set("flagged", "1"); else params.delete("flagged");
    if (sortOrder !== "default") params.set("sort", sortOrder); else params.delete("sort");
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", newUrl);
    }
  }, [search, statusFilter, recruiterFilter, flaggedFilter, sortOrder]);
  const [expandedId, setExpandedIdState] = useState<number | null>(externalExpandedId ?? null);
  function setExpandedId(id: number | null) {
    setExpandedIdState(id);
    onExpandedChange?.(id);
  }
  // Auto-scroll to the expanded card when navigating from Tracker tab (or,
  // 2026-07-20, from a FunnelView deep link). `block: "start"` (was
  // "center") so the recruiter lands on the top of the card — name, score,
  // status — instead of wherever the middle happens to fall on a long
  // expanded card. Needs the matching `scroll-mt-*` on the card element
  // itself (see the `<li data-candidate-id>` below) so "start" doesn't land
  // the card's top edge underneath SiteHeader's sticky bar.
  useEffect(() => {
    if (expandedId == null) return;
    const el = document.querySelector(`[data-candidate-id="${expandedId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expandedId]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Share link, 2026-08-02 (Vlad's ask) — copies this candidate's durable
  // /candidates/[id] page URL, same idea as the existing shareable batch
  // page (/projects/[id]/batches/[batchId]), just per candidate.
  const [copiedLinkId, setCopiedLinkId] = useState<number | null>(null);
  async function handleCopyLink(id: number) {
    await navigator.clipboard.writeText(`${window.location.origin}/candidates/${id}`);
    setCopiedLinkId(id);
    setTimeout(() => setCopiedLinkId((cur) => (cur === id ? null : cur)), 1500);
  }
  // Rescreen, added 2026-07-27 (Vlad's ask) — re-runs scoring for an
  // already-saved candidate in place. rescreenErrorId is cleared on the next
  // attempt (success or failure) rather than ever building up a list, since
  // only the most recent attempt's outcome is worth showing inline.
  const [rescreeningId, setRescreeningId] = useState<number | null>(null);
  const [rescreenErrorId, setRescreenErrorId] = useState<number | null>(null);
  const [pendingFlagId, setPendingFlagId] = useState<number | null>(null);
  const [pendingFlagNote, setPendingFlagNote] = useState("");
  // Editable source, 2026-07-20 (Vlad's ask): clicking the SourceIcon on a
  // Pipeline card opens an inline popover (same pattern as the flag-note
  // popover right above) to set/correct Applicant/LinkedIn/Agency after the
  // fact. pendingSourceAgencyName is seeded from the candidate's current
  // value when the popover opens (see the click handler below), not always
  // starting blank, so correcting a typo doesn't mean retyping the whole name.
  const [pendingSourceId, setPendingSourceId] = useState<number | null>(null);
  const [pendingSourceType, setPendingSourceType] = useState<SourceType>("applicant");
  const [pendingSourceAgencyName, setPendingSourceAgencyName] = useState("");
  // Tracks candidates flipped to "archived" via the status dropdown during
  // THIS session, specifically so the reason picker stays visible in place
  // instead of the card sinking immediately (see isSettledArchived below).
  // Deliberately session-local, not derived from server data — an archived
  // candidate that was already sitting in the DB before this page loaded
  // (with or without a reason) should sink into the Archived section right
  // away, not wait around forever for someone to retroactively pick a
  // reason nobody's going to add. Vlad's ask, 2026-07-16.
  const [justArchivedIds, setJustArchivedIds] = useState<Set<number>>(new Set());
  // "Multiple roles" collapsed-profile toggle, 2026-07-30 (Vlad's ask): a
  // merged cluster with no real fraud signal (plain "previously_seen" cross-
  // project match, or a same-project nameMatchId) no longer renders every
  // member's card by default — only the most recent one shows, with a
  // "Multiple roles · N" chip that expands to reveal the older submission(s)
  // right beneath it, "so it looks like one profile but with multiple
  // submissions." Real fraud clusters (duplicateFlag/known_fraud_pattern)
  // are unaffected — those keep the old always-expanded rose-bannered
  // treatment, since hiding a suspected-fraud duplicate by default would be
  // exactly the wrong instinct. Keyed by matchClusters' cluster.index.
  const [expandedClusters, setExpandedClusters] = useState<Set<number>>(new Set());
  const [notesMap, setNotesMap] = useState<Record<number, { text: string; saveState: "idle" | "saving" | "saved" }>>({});
  const [credibilityMap, setCredibilityMap] = useState<Record<number, CredibilityAssessment>>({});
  // Mirrors credibilityMap exactly — added 2026-07-30, same gap Activity
  // Timeline had before it was extracted: this tab renders its own inline
  // card markup, not ResultCard.tsx, so anything added to ResultCard doesn't
  // automatically appear here too.
  const [fraudRiskMap, setFraudRiskMap] = useState<Record<number, FraudRiskAssessment>>({});
  const [actionsMap, setActionsMap] = useState<Record<number, ScreeningAction[] | "loading">>({});
  // Transfer destination list, Vlad's ask 2026-07-29: projects this
  // recruiter/admin can transfer a candidate INTO, passed down to each
  // card's TransferControl (components/TransferControl.tsx) — a dedicated
  // bottom-of-card button as of the same-day redesign, not a status-
  // dropdown option anymore. GET /api/projects already scopes server-side
  // via teamIdsFilter (recruiter: own team only, admin: everything — see
  // lib/auth.ts) — the client just filters to active projects and excludes
  // the current one. Supersedes the old passive "Moved to X" badge
  // (findBetterFitMatches, removed) now that Transfer is a real action.
  const [transferProjects, setTransferProjects] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const list = (data.projects ?? [])
          .filter((p: { id: number; status: string }) => p.status === "active" && p.id !== projectId)
          .map((p: { id: number; name: string }) => ({ id: p.id, name: p.name }));
        setTransferProjects(list);
      })
      .catch(() => {
        // Non-fatal — Transfer just stays ungated (no picker) without this.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // "Also screened in X — Scored Y", Vlad's ask 2026-07-30: shown on every
  // Pipeline card at all times, not gated by score/eligibility like
  // ResultCard's own already-in mention (see ResultCard.tsx's matching
  // comment). One batched fetch for the whole tab instead of one per
  // candidate — see app/api/projects/[id]/cross-project-matches/route.ts.
  const [crossProjectMatchesMap, setCrossProjectMatchesMap] = useState<Record<number, CrossProjectMatch[]>>({});
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/cross-project-matches`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setCrossProjectMatchesMap(data.matches ?? {});
      })
      .catch(() => {
        // Non-fatal — the "Also screened in" line just doesn't show without this.
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Lazy-load the attribution timeline the first time a card is expanded.
  useEffect(() => {
    if (expandedId == null || actionsMap[expandedId] !== undefined) return;
    const id = expandedId;
    setActionsMap((prev) => ({ ...prev, [id]: "loading" }));
    fetch(`/api/history/${id}/actions`)
      .then((res) => res.json())
      .then((data) => setActionsMap((prev) => ({ ...prev, [id]: data.actions ?? [] })))
      .catch(() => setActionsMap((prev) => ({ ...prev, [id]: [] })));
  }, [expandedId, actionsMap]);

  // Round 64 sweep (Vlad: "activities... must update the visual card right
  // after the change"). The lazy-load effect above only ever fetches once
  // per id — dropping the cached entry here makes its guard see `undefined`
  // again, so it refetches automatically on next render. Without this, a
  // brand new action (status change, flag toggle, note, credibility/fraud
  // check, rescreen, blacklist — the actions lib/screenings.ts's
  // updateScreening() actually logs) wouldn't show in an already-expanded
  // card's Activity Timeline until it was collapsed and reopened.
  function invalidateActions(id: number) {
    setActionsMap((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  useEffect(() => {
    setScreenings(initialScreenings);
    const saved: Record<number, CredibilityAssessment> = {};
    const savedFraudRisk: Record<number, FraudRiskAssessment> = {};
    for (const s of initialScreenings) {
      if (s.credibility) saved[s.id] = s.credibility;
      if (s.fraudRisk) savedFraudRisk[s.id] = s.fraudRisk;
    }
    setCredibilityMap(saved);
    setFraudRiskMap(savedFraudRisk);
  }, [initialScreenings]);

  const handleStageChange = onStageChange;

  // Archival Logic, 2026-07-16 follow-up (Vlad's ask): a candidate only
  // stays out of the Archived section while it's actively waiting on a
  // reason from THIS session's own status change (tracked via
  // justArchivedIds above) — so the reason picker's "Reason" placeholder
  // stays visible and easy to act on right after the click, instead of the
  // card immediately sinking out of view. Any candidate that was already
  // "archived" when the page loaded (auto-archived, archived in a past
  // session, or legacy data from before the reason picker existed) sinks
  // into the Archived section immediately, reason or not — nothing about
  // page load implies "waiting on a reason," and old data shouldn't get
  // stuck in the active list forever just because nobody's going back to
  // fill in a reason for it. Distinct from raw `status === "archived"`,
  // which the status pill filter (STATUS_PILLS below) and the reason
  // picker itself still key off of.
  function isSettledArchived(s: ScreeningRecord | undefined): boolean {
    if (!s || s.status !== "archived") return false;
    if (justArchivedIds.has(s.id) && !s.archiveReason) return false;
    return true;
  }

  const matchClusters = useMemo(() => computeMatchClusters(screenings), [screenings]);

  // Vlad's ask, 2026-07-30 (screenshot: two merged cards both showing
  // "Previously seen" reads as noisy/redundant, stacked right under the
  // "Possible duplicate" cluster banner). Within a merged cluster, only the
  // most recently screened member keeps its own historyAlertType badge —
  // it "sticks with" whichever submission the recruiter is actually
  // looking at, instead of repeating on every older resubmission in the
  // group. Doesn't touch historyAlertType itself (still set on every
  // matching row in the DB, still drives Ring grouping/clusterIsFraud) —
  // purely a display-level dedup for this one badge.
  const suppressedHistoryAlertIds = useMemo(() => {
    const byCluster = new Map<number, ScreeningRecord[]>();
    for (const s of screenings) {
      if (s.historyAlertType == null) continue;
      const cluster = matchClusters.get(s.id);
      if (!cluster) continue;
      const list = byCluster.get(cluster.index) ?? [];
      list.push(s);
      byCluster.set(cluster.index, list);
    }
    const suppressed = new Set<number>();
    for (const members of byCluster.values()) {
      if (members.length <= 1) continue;
      const latest = members.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
      for (const m of members) if (m.id !== latest.id) suppressed.add(m.id);
    }
    return suppressed;
  }, [screenings, matchClusters]);

  // Card merging, 2026-07-20 (Vlad's ask): replaces the old "Ring N" badge +
  // click-to-highlight mechanic entirely. Every matchClusters group (any of
  // duplicateMatchId/historyAlertMatchId/nameMatchId — see
  // lib/matchClusters.ts) now renders as one visually merged card instead of
  // separate cards linked by a clickable Ring chip. Display-only: doesn't
  // touch any data, every member screening stays fully independent
  // underneath (own status, own flag, own everything) — this only changes
  // how they're grouped in the DOM. Fraud-signal clusters (duplicateFlag or
  // a real known_fraud_pattern match) get a red-tinted header instead of the
  // neutral gray one, so a merged card still reads as a fraud flag at a
  // glance rather than looking identical to an ordinary resubmission.
  //
  // Narrowed 2026-07-30 (Vlad's ask): this used to treat ANY historyAlertType
  // as a fraud signal, including "previously_seen" — the same real person
  // submitting for a different role, not fraud at all ("it's the same
  // person under two different projects"). Only duplicateFlag (content-hash
  // match) or an actual known_fraud_pattern match still counts here; a plain
  // previously_seen cluster now falls through to the "Multiple roles"
  // treatment below instead of the rose "Possible duplicate" banner.
  function clusterHasFraudSignal(cluster: MatchCluster | undefined): boolean {
    if (!cluster) return false;
    return cluster.memberIds.some((id) => {
      const m = screenings.find((r) => r.id === id);
      return m?.duplicateFlag || m?.historyAlertType === "known_fraud_pattern";
    });
  }

  // Distinct recruiters present in this project, sorted by email for a
  // stable dropdown order. Falls back to the raw id for anyone missing an
  // email (matches attachRecruiterEmails' own fallback in lib/screenings.ts).
  const recruiterOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of screenings) {
      if (s.recruiterId != null) byId.set(s.recruiterId, s.recruiterEmail ?? s.recruiterId);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [screenings]);

  // Vlad's ask, 2026-07-30: a merged cluster (duplicate/history-alert/name-
  // match) used to be pinned to the very top of its active/archived split
  // via "Ring grouping" — cluster index as the primary sort key, regardless
  // of how old the cluster's members were. A duplicate pair from months ago
  // could sit above every recent candidate. Replaced with item-based
  // grouping: each cluster becomes one "queue item" (its members, most
  // recent first) positioned wherever that MOST RECENT member naturally
  // belongs — "the screening from July 16 should be connected to July 30
  // (the most recent one)," not forced to the top regardless of date/score.
  // Grouping into items before sorting (rather than sorting raw screenings
  // with a cluster tiebreaker) guarantees a cluster's members can never end
  // up interleaved with an unrelated candidate that happens to share the
  // anchor's score/date — they're one unit until flattened at the end.
  function buildQueueItems(list: ScreeningRecord[]): ScreeningRecord[][] {
    const itemsByClusterIndex = new Map<number, ScreeningRecord[]>();
    const items: ScreeningRecord[][] = [];
    for (const s of list) {
      const cluster = matchClusters.get(s.id);
      if (!cluster) { items.push([s]); continue; }
      let item = itemsByClusterIndex.get(cluster.index);
      if (!item) { item = []; itemsByClusterIndex.set(cluster.index, item); items.push(item); }
      item.push(s);
    }
    for (const item of items) item.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }

  const filteredScreenings = buildQueueItems(
    screenings.filter((s) => {
      if (search && !s.candidateName.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (recruiterFilter && s.recruiterId !== recruiterFilter) return false;
      if (flaggedFilter && !s.flagged) return false;
      return true;
    })
  )
    .sort((itemA, itemB) => {
      // Each item's first member is its most recent — the anchor this
      // item's position is decided by.
      const a = itemA[0];
      const b = itemB[0];
      // Archival Logic, 2026-07-15 (Vlad's ask): archived candidates always
      // sink below every active candidate, regardless of score sort, so the
      // main pipeline list only ever contains active candidates and the
      // Archived section (rendered via a divider below, see the render map)
      // reads as a visually separated block further down the page.
      //
      // 2026-07-29 exception: skipped entirely for "newest" — the whole
      // point of that sort (Vlad's ask: surface recent screenings) broke
      // under this rule, since a below-threshold candidate is
      // auto-archived the moment it's saved (lib/screenings.ts) and would
      // otherwise never show up near the top of "Newest" no matter how
      // recently it was screened — exactly the candidates a recruiter
      // reviewing "what just came in" most needs to see. "Newest" sorts
      // strictly by createdAt across active AND archived together;
      // archived cards still read as archived via their own dimmed/
      // desaturated styling below, just no longer forced to the bottom.
      // The isFirstArchived divider below is skipped in this mode too,
      // since it assumes a single contiguous archived block at the end.
      if (sortOrder !== "newest") {
        const aArchived = isSettledArchived(a) ? 1 : 0;
        const bArchived = isSettledArchived(b) ? 1 : 0;
        if (aArchived !== bArchived) return aArchived - bArchived;
      }
      if (sortOrder === "desc") return b.score - a.score;
      if (sortOrder === "asc") return a.score - b.score;
      // Default and "newest" both fall back to plain recency — the anchor
      // is already each item's own most recent member either way.
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .flat();
  const archivedCount = filteredScreenings.filter(isSettledArchived).length;

  function getNotesText(s: ScreeningRecord) {
    return notesMap[s.id]?.text ?? s.notes ?? "";
  }

  async function handleStatusChange(id: number, status: CandidateStatus) {
    const now = new Date().toISOString();
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, status, statusUpdatedAt: now } : s));
    onScreeningFieldSaved?.(id, { status, statusUpdatedAt: now });
    invalidateActions(id);
    if (status === "archived") {
      setJustArchivedIds((prev) => new Set(prev).add(id));
    } else {
      setJustArchivedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    } catch { /* non-fatal */ }
  }

  async function handleArchiveReasonChange(id: number, archiveReason: string) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, archiveReason } : s));
    onScreeningFieldSaved?.(id, { archiveReason });
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archiveReason }) });
    } catch { /* non-fatal */ }
  }

  // Blacklist, 2026-07-31 (Vlad's ask) — mirrors handleArchiveReasonChange above.
  async function handleBlacklistChange(id: number, blacklisted: boolean, blacklistReason: string | null) {
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, blacklisted, blacklistReason: blacklistReason ?? undefined } : s));
    onScreeningFieldSaved?.(id, { blacklisted, blacklistReason: blacklistReason ?? undefined });
    invalidateActions(id);
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blacklisted, blacklistReason }) });
    } catch { /* non-fatal */ }
  }

  // Transfer status action, Vlad's ask 2026-07-29, redesigned same day into
  // a dedicated button (components/TransferControl.tsx) after he tested the
  // original dropdown-driven version and hit a real bug — see that
  // component's own doc comment for the full flow. TransferControl now owns
  // every fetch call itself (precheck/preview/commit); this just merges the
  // final result into local state once it reports success.
  //
  // CHANGED 2026-08-02 (Vlad's ask, see lib/types.ts's CandidateStatus
  // comment): local state now mirrors the archived-not-transferred status
  // the server actually writes (transferScreeningToProject in
  // lib/screenings.ts), instead of optimistically setting "transferred".
  function handleTransferred(id: number, result: { newScreeningId: number; transferredToProjectId: number; transferredToProjectName: string }) {
    const now = new Date().toISOString();
    setScreenings((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: "archived",
              archiveReason: "Transferred",
              statusUpdatedAt: now,
              transferredToProjectId: result.transferredToProjectId,
              transferredToProjectName: result.transferredToProjectName,
              transferredToScreeningId: result.newScreeningId,
            }
          : s
      )
    );
    onScreeningFieldSaved?.(id, {
      status: "archived",
      archiveReason: "Transferred",
      statusUpdatedAt: now,
      transferredToProjectId: result.transferredToProjectId,
      transferredToProjectName: result.transferredToProjectName,
      transferredToScreeningId: result.newScreeningId,
    });
  }

  async function handleToggleFlag(id: number, current: boolean, note?: string) {
    const next = !current;
    setPendingFlagId(null);
    setPendingFlagNote("");
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, flagged: next, flagNote: next ? note : undefined } : s));
    onScreeningFieldSaved?.(id, { flagged: next, flagNote: next ? note : undefined });
    invalidateActions(id);
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flagged: next, flagNote: note }) });
    } catch {
      setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, flagged: current } : s));
      onScreeningFieldSaved?.(id, { flagged: current });
      invalidateActions(id);
    }
  }

  // Saves the source picked in the popover below. Applicant/LinkedIn clear
  // any stored agency name (mutually exclusive, matches ScreenTab's picker);
  // Agency requires a non-empty name or the save is a no-op (button is
  // disabled in that case too — see the popover JSX).
  async function handleSourceChange(id: number, type: SourceType, agencyName: string) {
    const linkedInMode = type === "linkedin";
    const trimmedAgencyName = type === "agency" ? agencyName.trim() : "";
    if (type === "agency" && !trimmedAgencyName) return;
    const previous = screenings.find((s) => s.id === id);
    setPendingSourceId(null);
    setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, linkedInMode, agencyName: trimmedAgencyName || undefined } : s));
    onScreeningFieldSaved?.(id, { linkedInMode, agencyName: trimmedAgencyName || undefined });
    try {
      await fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedInMode, agencyName: trimmedAgencyName }),
      });
    } catch {
      if (previous) {
        setScreenings((prev) => prev.map((s) => s.id === id ? previous : s));
        onScreeningFieldSaved?.(id, previous);
      }
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setScreenings((prev) => prev.filter((s) => s.id !== id));
      setExpandedId(expandedId === id ? null : expandedId);
      onDeleted?.(id);
    } catch { /* show nothing */ }
    finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  // Re-runs scoring for an already-saved candidate against the project's
  // CURRENT job description + calibration library, and updates this same
  // screening row in place (app/api/history/[id]/rescreen/route.ts) — added
  // 2026-07-27 (Vlad's ask). Only the scoring fields come back; status,
  // notes, flags, credibility, etc. are untouched both server- and
  // client-side, so a rescore never disturbs where the recruiter already
  // has this candidate parked.
  async function handleRescreen(id: number) {
    setRescreeningId(id);
    setRescreenErrorId(null);
    try {
      const res = await fetch(`/api/history/${id}/rescreen`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.screening) {
        setScreenings((prev) => prev.map((s) => (s.id === id ? { ...s, ...data.screening } : s)));
        // Propagate to the parent's own `screenings` state too — see
        // onScreeningFieldSaved's doc comment above (round 63 fix). Without
        // this, a rescore only ever updated PipelineTab's own local state:
        // it looked right in the moment, but switching tabs (which unmounts
        // PipelineTab entirely) and back reverted to the old pre-rescreen
        // score/summary, since remounting re-seeds from the parent's still-
        // stale copy. Vlad's ask, 2026-08-03: "after rescreening the card I
        // want it to be updated in the pipeline right away."
        onScreeningFieldSaved?.(id, data.screening);
        invalidateActions(id);
      }
    } catch {
      setRescreenErrorId(id);
    } finally {
      setRescreeningId(null);
    }
  }

  async function saveNotes(id: number, text: string) {
    setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "saving" } }));
    try {
      await fetch(`/api/history/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: text }) });
      setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "saved" } }));
      // Also merge onto `screenings` itself (local + parent), not just
      // notesMap — round 64 sweep (Vlad: "flags, activities, etc. must
      // update the visual card right after the change"). notesMap starts
      // empty on every mount and was the ONLY place a saved note lived;
      // getNotesText() falls back to `s.notes` once notesMap has nothing
      // for this id, so a tab switch (unmounts this component) and back
      // showed the pre-edit note until a full page reload.
      setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, notes: text } : s));
      onScreeningFieldSaved?.(id, { notes: text });
      invalidateActions(id);
      setTimeout(() => setNotesMap((prev) => prev[id]?.saveState === "saved" ? { ...prev, [id]: { text, saveState: "idle" } } : prev), 2000);
    } catch {
      setNotesMap((prev) => ({ ...prev, [id]: { text, saveState: "idle" } }));
    }
  }

  // "Recruiter Screen" was missing here — Vlad flagged it, 2026-07-20. It's
  // a real CandidateStatus (lib/types.ts) that sits between New and
  // Contacted in the actual pipeline order, but this pill list was never
  // updated to include it, so there was no way to filter down to it even
  // though candidates can carry that status.
  const STATUS_PILLS: { label: string; value: CandidateStatus | null }[] = [
    { label: "All", value: null },
    { label: "New", value: "new_applicant" },
    { label: "Recruiter Screen", value: "recruiter_screen" },
    { label: "Contacted", value: "contacted" },
    { label: "Screening", value: "screening" },
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
        <div className="flex flex-wrap items-center gap-1.5">
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
          <button type="button" onClick={() => setFlaggedFilter((v) => !v)}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              flaggedFilter
                ? "bg-amber-500 text-white"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill={flaggedFilter ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" className="shrink-0">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 22V15" strokeLinecap="round" />
            </svg>
            Flagged
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {recruiterOptions.length > 1 && (
              <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                <select
                  value={recruiterFilter ?? ""}
                  onChange={(e) => setRecruiterFilter(e.target.value || null)}
                  className="max-w-[160px] truncate bg-transparent text-xs font-medium text-zinc-500 outline-none dark:text-zinc-400"
                >
                  <option value="">All recruiters</option>
                  {recruiterOptions.map(([id, email]) => (
                    <option key={id} value={id}>{email}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-700 dark:bg-zinc-900">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-zinc-400">
                <path d="M3 6h18M6 12h12M10 18h4" strokeLinecap="round"/>
              </svg>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "default" | "desc" | "asc" | "newest")}
                className="bg-transparent text-xs font-medium text-zinc-500 outline-none dark:text-zinc-400"
              >
                <option value="default">Default</option>
                <option value="newest">Newest</option>
                <option value="desc">Score ↓</option>
                <option value="asc">Score ↑</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      {filteredScreenings.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">No candidates match your filters.</p>
      )}
    <ul className="flex flex-col gap-3">
      {filteredScreenings.map((s, idx) => {
        const expanded = expandedId === s.id;
        // Archival Logic, 2026-07-15: drop a section divider right before the
        // first archived card in the (now archived-sorted-last) list, so the
        // Archived group reads as its own labeled section rather than being
        // mixed into the main pipeline. No divider at all if nothing's
        // archived, or if statusFilter has already narrowed the list to only
        // archived cards (idx 0 would be archived — divider still renders,
        // which is fine, it just labels the single-group list).
        //
        // 2026-07-29: skipped for "newest" sort — archived cards are
        // interleaved by date in that mode (see the .sort() comparator
        // above), so there's no single contiguous block left to divide;
        // each archived card's own dimmed styling carries that meaning
        // instead.
        const isFirstArchived = sortOrder !== "newest" && isSettledArchived(s) && !isSettledArchived(filteredScreenings[idx - 1]);
        // Card merging (continued from the clusterHasFraudSignal comment
        // above): the existing "Ring grouping" sort tiebreaker (see
        // filteredScreenings's .sort() above) already places every member of
        // the same cluster adjacent to each other, so merge position can be
        // read straight off array neighbors — no separate reordering needed.
        // "first"/"middle"/"last" only apply when 2+ members of a cluster are
        // actually adjacent-and-visible right now; a lone visible member (its
        // match filtered out) just renders solo, badges and all.
        const cluster = matchClusters.get(s.id);
        const isMergeable = cluster != null;
        const prevSameCluster = isMergeable && idx > 0 && matchClusters.get(filteredScreenings[idx - 1].id)?.index === cluster!.index;
        const nextSameCluster = isMergeable && idx < filteredScreenings.length - 1 && matchClusters.get(filteredScreenings[idx + 1].id)?.index === cluster!.index;
        const mergePosition: "solo" | "first" | "middle" | "last" =
          !isMergeable || (!prevSameCluster && !nextSameCluster) ? "solo"
          : !prevSameCluster ? "first"
          : nextSameCluster ? "middle"
          : "last";
        let mergeGroupSize = 0;
        if (mergePosition === "first") {
          for (let j = idx; j < filteredScreenings.length && matchClusters.get(filteredScreenings[j].id)?.index === cluster!.index; j++) mergeGroupSize++;
        }
        const clusterIsFraud = clusterHasFraudSignal(cluster);
        const mergeIsFraud = mergePosition === "first" && clusterIsFraud;
        // "Multiple roles" collapsed profile, 2026-07-30 — see
        // expandedClusters' doc comment above. A non-fraud cluster only
        // shows its most recent ("first") member by default; older siblings
        // stay mounted (so expanding is instant, no re-fetch) but visually
        // hidden via `hidden` until the cluster is expanded.
        const isNonFraudCluster = isMergeable && !clusterIsFraud;
        const clusterExpanded = cluster != null && expandedClusters.has(cluster.index);
        const hiddenAsCollapsedSibling = isNonFraudCluster && mergePosition !== "first" && mergePosition !== "solo" && !clusterExpanded;
        // Any middle/last member of a non-fraud cluster toggles between
        // `hidden` and visible as expandedClusters changes — plays the
        // slow reveal animation (see .animate-reveal-down in globals.css)
        // every time it becomes visible, since display:none->block always
        // restarts a CSS animation.
        const isCollapsibleSibling = isNonFraudCluster && mergePosition !== "first" && mergePosition !== "solo";
        // 2026-07-30 follow-up (Vlad's ask): the "Multiple roles" toggle
        // moved from an inline chip into a full-width bar sitting on top of
        // the card, mirroring the "Possible duplicate" banner — so a
        // non-fraud cluster's "first" member ALWAYS has something above it
        // now (collapsed or expanded), same as a fraud cluster does. Only a
        // true "solo" card is fully isolated (normal full rounding).
        const showsAsIsolated = mergePosition === "solo";
        // The collapsed "first" member of a non-fraud cluster has no visible
        // sibling below it (still hidden), so — unlike a fraud cluster's
        // "first" member, which always has a visible sibling beneath it —
        // it's the last visible thing in its stack and needs a rounded
        // bottom. Flips to flat once expanded and an actual sibling appears
        // below it.
        const roundedBottomWhileCollapsed = isNonFraudCluster && mergePosition === "first" && !clusterExpanded;
        return (
          <Fragment key={s.id}>
          {isFirstArchived && (
            <li aria-hidden className="pointer-events-none flex items-center gap-3 px-1 pt-2 select-none">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                Archived ({archivedCount})
              </span>
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </li>
          )}
          {/* Vlad's ask, 2026-07-30: this banner used to show for EVERY
              merged cluster, including plain "Same person" resubmissions
              with no actual duplicate/fraud signal — bothered him as one
              more rose/amber-adjacent warning sitting at the top of the
              list for something that isn't actually a problem. Now gated
              on mergeIsFraud too, so a same-person-no-signal cluster just
              merges visually (rounded corners, stacked cards) with no
              labeled header above it at all — only a real duplicateFlag/
              historyAlertType still gets called out. */}
          {mergePosition === "first" && mergeIsFraud && (
            <li aria-hidden className="flex items-center gap-1.5 rounded-t-2xl border border-b-0 border-rose-200 bg-rose-50/70 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <circle cx="9" cy="9" r="4" /><circle cx="15" cy="15" r="4" />
              </svg>
              Possible duplicate · {mergeGroupSize} submissions
            </li>
          )}
          {/* "Multiple roles" toggle, redesigned 2026-07-30 (Vlad's ask):
              moved out of the inline badge row into a full-width bar sitting
              on top of the card — same footprint as the "Possible duplicate"
              banner above, but neutral-toned (this isn't a fraud signal) and
              itself clickable across its full width. Stays visible whether
              collapsed or expanded, acting as a persistent header for "one
              profile, multiple submissions." */}
          {mergePosition === "first" && isNonFraudCluster && (
            <li>
              <button
                type="button"
                onClick={() => {
                  const idx2 = cluster!.index;
                  setExpandedClusters((prev) => {
                    const next = new Set(prev);
                    if (next.has(idx2)) next.delete(idx2); else next.add(idx2);
                    return next;
                  });
                }}
                title={clusterExpanded ? "Hide older submissions" : "This candidate has other submissions — click to show them"}
                className="flex w-full items-center gap-1.5 rounded-t-2xl border border-b-0 border-zinc-200 bg-zinc-50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Multiple roles · {mergeGroupSize} submissions
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`ml-auto shrink-0 transition-transform ${clusterExpanded ? "rotate-180" : ""}`}>
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </li>
          )}
          <li data-candidate-id={s.id} className={`${hiddenAsCollapsedSibling ? "hidden" : isCollapsibleSibling ? "animate-reveal-down" : ""} ${!showsAsIsolated ? "-mt-3" : ""} scroll-mt-24 bg-white transition-all hover:shadow-md dark:bg-zinc-900 ${
            showsAsIsolated ? "rounded-2xl"
            : roundedBottomWhileCollapsed ? "rounded-t-none rounded-b-2xl"
            : mergePosition === "first" ? "rounded-t-none rounded-b-none"
            : mergePosition === "last" ? "rounded-t-none rounded-b-2xl"
            : "rounded-none"
          } ${
            // Fraud-cluster merged cards get a rose border instead of the
            // default gray, so a merged group still reads as flagged at a
            // glance (replaces the old per-click Ring highlight, which this
            // card-merging feature supersedes entirely).
            mergePosition !== "solo" && clusterIsFraud
              ? "border border-rose-200 dark:border-rose-500/30"
              : "border border-zinc-200 dark:border-zinc-800"
          } ${
            // Card Visuals, 2026-07-15 (Vlad's ask): archived candidates are
            // "toned out" — darker/lower-opacity, desaturated — so the main
            // pipeline visually recedes for them. Archived-only per confirmed
            // scope. Hover restores near-full opacity for readability.
            // 2026-07-15 follow-up: don't dim a card the user has actually
            // opened — reading an expanded card's details through 50%
            // opacity was the actual complaint, so `expanded` clears the
            // toned-out treatment entirely while it's open.
            isSettledArchived(s) && !expanded ? "opacity-50 saturate-[0.6] hover:opacity-90" : ""
          }`}>
            <div role="button" tabIndex={0}
              onClick={() => setExpandedId(expanded ? null : s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpandedId(expanded ? null : s.id); }}
              className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left">
              <ScoreBadge
                score={s.score}
                adjustedScore={credibilityMap[s.id]?.scoreDelta ? s.score + credibilityMap[s.id].scoreDelta! : undefined}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {/* Name row */}
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-zinc-900 dark:text-zinc-50">{s.candidateName}</span>
                  {s.duplicateFlag && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (s.duplicateMatchId != null) setExpandedId(s.duplicateMatchId);
                      }}
                      title={
                        s.duplicateMatchId != null
                          ? `Matches ${screenings.find((c) => c.id === s.duplicateMatchId)?.candidateName ?? "another candidate"} — click to view`
                          : "Duplicate detected"
                      }
                      className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                    >
                      Duplicate detected
                    </button>
                  )}
                  {/* 2026-07-29 (Vlad's ask): "if the candidate shows (moved
                      to project) then remove (previously seen)" — the
                      milder "previously_seen" alert is redundant once the
                      status chip already reads "Transferred to X"; showing
                      both was just noise pointing at largely the same idea.
                      Originally gated on the old "Moved to X" badge
                      (betterFitMatches), then keyed off status ===
                      "transferred" now that Transfer is an explicit action
                      instead of a passive guess. CHANGED 2026-08-02: keyed
                      off transferredToScreeningId directly instead, since a
                      transfer now archives the original screening rather
                      than setting status to "transferred" (see
                      lib/types.ts's CandidateStatus comment) — the pointer
                      column is the reliable signal either way.
                      "known_fraud_pattern" is a distinct, more serious
                      signal (not just "also seen elsewhere") and stays
                      regardless. Also suppressed on every non-latest member
                      of a merged cluster — see suppressedHistoryAlertIds
                      above — and on every member of a non-fraud cluster
                      (isNonFraudCluster can only ever mean a plain
                      "previously_seen" match here, never known_fraud_
                      pattern — see clusterHasFraudSignal), superseded by
                      the "Multiple roles" toggle bar above the card instead. */}
                  {s.historyAlertType && !suppressedHistoryAlertIds.has(s.id) && !isNonFraudCluster && (s.historyAlertType === "known_fraud_pattern" || s.transferredToScreeningId == null) && (
                    <Link
                      href={s.historyAlertMatchProjectId != null ? `/projects/${s.historyAlertMatchProjectId}?tab=pipeline` : "#"}
                      onClick={(e) => e.stopPropagation()}
                      title={
                        s.historyAlertMatchCandidateName && s.historyAlertMatchProjectName
                          ? `Matches ${s.historyAlertMatchCandidateName} in ${s.historyAlertMatchProjectName}`
                          : s.historyAlertType === "known_fraud_pattern"
                          ? "Known fraud pattern — matches a flagged candidate in another project"
                          : "Previously seen in another project"
                      }
                      className={
                        s.historyAlertType === "known_fraud_pattern"
                          ? "shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 transition-colors hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25"
                          : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25"
                      }
                    >
                      {s.historyAlertType === "known_fraud_pattern" ? "Known fraud pattern" : "Previously seen"}
                    </Link>
                  )}
                  {/* Fraud risk check summary, at-a-glance on the collapsed
                      card — Vlad's ask, 2026-08-04: "make sure fraud risk
                      summary shows on the result card in the pipeline if it
                      was ran post-screening." The check itself is always
                      run post-screening (FraudRiskChecker.tsx is manual-only,
                      never fires during batch scoring — see that
                      component's doc comment), and its full summary already
                      rendered correctly once a card was expanded, but there
                      was no signal at all on the collapsed row — a recruiter
                      had to remember to open every card to find out a check
                      had even been run, let alone what it found. Mirrors the
                      Duplicate detected/Known fraud pattern badges right
                      above: only surfaces when there's something worth
                      flagging (moderate/high), same "warn, don't reassure"
                      convention already used for every other collapsed-row
                      badge on this card. No separate onClick — the whole
                      header row already expands the card on click, which is
                      exactly where the full breakdown (FraudRiskChecker)
                      lives. */}
                  {fraudRiskMap[s.id] && fraudRiskMap[s.id].overallRisk !== "low" && (
                    <span
                      title={fraudRiskMap[s.id].summary}
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        fraudRiskMap[s.id].overallRisk === "high"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                      }`}
                    >
                      {fraudRiskMap[s.id].overallRisk === "high" ? "Fraud risk: high" : "Fraud risk: moderate"}
                    </span>
                  )}
                  {s.nameMatchId != null && mergePosition === "solo" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setExpandedId(s.nameMatchId ?? null); }}
                      title={`A different resume file for ${screenings.find((c) => c.id === s.nameMatchId)?.candidateName ?? "this candidate"} already exists in this project — click to view`}
                      className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-500/15 dark:text-zinc-400 dark:hover:bg-zinc-500/25"
                    >
                      Name match
                    </button>
                  )}
                  {/* "Multiple roles" toggle lives as a full-width bar above
                      the card now (2026-07-30) — see the <li> rendered just
                      before this card in the map above. */}
                  <button type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pendingSourceId === s.id) { setPendingSourceId(null); return; }
                      setPendingSourceType(getSourceType(s));
                      setPendingSourceAgencyName(s.agencyName ?? "");
                      setPendingSourceId(s.id);
                    }}
                    title="Click to set source"
                    className="shrink-0 rounded-full transition-opacity hover:opacity-70">
                    <SourceIcon type={getSourceType(s)} agencyName={s.agencyName} contentIsLinkedIn={s.resumeIsLinkedIn} showApplicant />
                  </button>
                  {/* Visible agency name, added 2026-07-27 (Vlad's ask) —
                      matches the same addition on ResultCard.tsx and
                      app/candidates/page.tsx, so all three source-badge
                      surfaces stay in sync (same convention as the LinkedIn
                      badge consistency fix, 2026-07-17). */}
                  {pendingSourceId !== s.id && getSourceType(s) === "agency" && s.agencyName && (
                    <span className="shrink-0 truncate text-[11px] font-medium text-orange-600 dark:text-orange-400">
                      {s.agencyName}
                    </span>
                  )}
                  {pendingSourceId === s.id && (
                    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <div className="mx-0.5 h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" />
                      {getSourceType(s) !== "applicant" && (
                        <button type="button" title="Applicant"
                          onClick={() => handleSourceChange(s.id, "applicant", "")}
                          className="rounded-full p-0.5 opacity-40 transition-opacity hover:opacity-100">
                          <SourceIcon type="applicant" size={13} showApplicant />
                        </button>
                      )}
                      {getSourceType(s) !== "linkedin" && (
                        <button type="button" title="Sourced"
                          onClick={() => handleSourceChange(s.id, "linkedin", "")}
                          className="rounded-full p-0.5 opacity-40 transition-opacity hover:opacity-100">
                          <SourceIcon type="linkedin" size={13} />
                        </button>
                      )}
                      {pendingSourceType === "agency" ? (
                        <input
                          autoFocus
                          type="text"
                          value={pendingSourceAgencyName}
                          onChange={(e) => setPendingSourceAgencyName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSourceChange(s.id, "agency", pendingSourceAgencyName);
                            if (e.key === "Escape") setPendingSourceId(null);
                          }}
                          onBlur={() => {
                            if (pendingSourceAgencyName.trim()) handleSourceChange(s.id, "agency", pendingSourceAgencyName);
                            else setPendingSourceId(null);
                          }}
                          placeholder="Agency name…"
                          className="w-28 rounded-full border border-orange-300 bg-white px-2 py-0.5 text-[11px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-orange-500 dark:border-orange-500/40 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                      ) : (
                        <button type="button" title="Agency"
                          onClick={() => setPendingSourceType("agency")}
                          className={`rounded-full p-0.5 transition-opacity ${getSourceType(s) === "agency" ? "ring-2 ring-orange-400" : "opacity-40 hover:opacity-100"}`}>
                          <SourceIcon type="agency" agencyName={s.agencyName} size={13} />
                        </button>
                      )}
                    </div>
                  )}
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
                  <StatusStageControl
                    status={s.status}
                    stage={stagesMap[s.id] ?? null}
                    onStatusChange={(status) => handleStatusChange(s.id, status)}
                    onStageChange={(stage) => handleStageChange(s.id, stage)}
                    archiveReason={s.archiveReason}
                    onArchiveReasonChange={(reason) => handleArchiveReasonChange(s.id, reason)}
                    blacklisted={s.blacklisted}
                    blacklistReason={s.blacklistReason}
                    onBlacklistChange={(next, reason) => handleBlacklistChange(s.id, next, reason)}
                    transferredToProjectName={s.transferredToProjectName}
                    transferredToScreeningId={s.transferredToScreeningId}
                  />
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
                    `/interview/${s.id}/document?mime=${encodeURIComponent(s.resumeMimeType)}&name=${encodeURIComponent(s.fileName)}`,
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

                {/* ── Also screened in ──────────────────────────────────── */}
                {/* Standing badge, Vlad's ask 2026-07-30 — plain lines, shown
                    at the top of the expanded card regardless of score. See
                    crossProjectMatchesMap's fetch effect above. */}
                {crossProjectMatchesMap[s.id] && crossProjectMatchesMap[s.id].length > 0 && (
                  <div className="flex flex-col gap-1">
                    {crossProjectMatchesMap[s.id].map((m) => (
                      <p key={m.screeningId} className="text-xs text-zinc-500 dark:text-zinc-400">
                        Also screened in{" "}
                        <Link
                          // returnTo, 2026-08-11 (Vlad's ask) — without this,
                          // /candidates/[id]'s own Back button has no idea
                          // this click came from a DIFFERENT project's
                          // Pipeline card, so it falls back to ITS OWN
                          // project's Screen tab (the project THIS matched
                          // screening belongs to — Forward Deployed Engineer
                          // in Vlad's repro — not the CPQ pipeline card the
                          // recruiter actually clicked from). Passing the
                          // current, already-in-sync URL (tab/filters/
                          // scroll — see this page's own replaceState sync
                          // effects above) as returnTo makes tier 1 of that
                          // page's three-tier Back logic fire instead,
                          // landing the recruiter back on the exact card
                          // they left, not a different project entirely.
                          href={`/candidates/${m.screeningId}${
                            typeof window !== "undefined"
                              ? `?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
                              : ""
                          }`}
                          className="font-medium text-violet-600 underline decoration-dotted underline-offset-2 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                        >
                          {m.projectName}
                        </Link>
                        {" "}— Scored {m.score}
                      </p>
                    ))}
                  </div>
                )}

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
                        <span className="font-medium text-zinc-500 dark:text-zinc-400">Cross-ref trajectory: </span>
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

                {/* ── Cross-reference check ─────────────────────────────── */}
                <CrossReferenceChecker
                  screeningId={s.id}
                  currentAssessment={credibilityMap[s.id]}
                  onComplete={async (assessment) => {
                    try {
                      const res = await fetch(`/api/history/${s.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ credibility: assessment }),
                      });
                      if (!res.ok) return false;
                      setCredibilityMap((prev) => ({ ...prev, [s.id]: assessment }));
                      onScreeningFieldSaved?.(s.id, { credibility: assessment });
                      invalidateActions(s.id);
                      return true;
                    } catch {
                      return false;
                    }
                  }}
                />

                {/* ── Fraud risk check ──────────────────────────────────── */}
                {/* Same score >= 75 gate as ResultCard.tsx's canShowFraudRisk
                    — added 2026-07-30, this tab was missing it entirely
                    (same class of gap Activity Timeline had before). */}
                {(s.score >= 75 || fraudRiskMap[s.id] !== undefined) && (
                  <FraudRiskChecker
                    screeningId={s.id}
                    currentAssessment={fraudRiskMap[s.id]}
                    onComplete={async (assessment) => {
                      try {
                        const res = await fetch(`/api/history/${s.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ fraudRisk: assessment }),
                        });
                        if (!res.ok) return false;
                        setFraudRiskMap((prev) => ({ ...prev, [s.id]: assessment }));
                        onScreeningFieldSaved?.(s.id, { fraudRisk: assessment });
                        invalidateActions(s.id);
                        return true;
                      } catch {
                        return false;
                      }
                    }}
                  />
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

                {/* ── Attribution timeline ──────────────────────────────── */}
                {/* Extracted 2026-07-29 into components/ActivityTimeline.tsx
                    so the batch-results page and candidate full page (both
                    render ResultCard.tsx, neither showed activity before)
                    get the exact same component, not a second copy. */}
                <ActivityTimeline actions={actionsMap[s.id]} candidateName={s.candidateName} />

                {/* Calibration feedback */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    Calibrate
                  </span>
                  <CalibrationButtons screeningId={s.id} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button type="button"
                      onClick={() => {
                        const sw = window.screen.availWidth;
                        const sh = window.screen.availHeight;
                        const halfW = Math.floor(sw / 2);
                        window.open(`/interview/${s.id}/document?mime=${encodeURIComponent(s.resumeMimeType)}&name=${encodeURIComponent(s.fileName)}`, `iv_doc_${s.id}`, `width=${sw - halfW},height=${sh},left=0,top=0,menubar=no,toolbar=no,location=no,status=no`);
                      }}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-violet-50 px-3.5 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      View resume
                    </button>
                    {/* Rescreen, added 2026-07-27 (Vlad: "add a rescreen
                        button on actual pipeline cards somewhere at the
                        bottom") — re-runs scoring for this ALREADY-SAVED
                        candidate against the project's current job
                        description + calibration library and updates this
                        same screening record in place (see
                        app/api/history/[id]/rescreen/route.ts). Distinct
                        from AlreadyScreenedCard's "Re-screen anyway", which
                        only ever handles a pre-save duplicate upload and
                        creates a NEW screening row — this one is for a
                        recruiter who wants a stale score refreshed (JD
                        changed, more calibration examples since) without
                        losing the candidate's stage/notes/history. Status is
                        deliberately left untouched by the route itself. */}
                    <button type="button"
                      disabled={rescreeningId === s.id}
                      onClick={() => handleRescreen(s.id)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      {rescreeningId === s.id ? (
                        <ScoringLoader className="h-5 w-16" strokeWidth={8} />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {rescreeningId === s.id ? "Rescreening…" : "Rescreen"}
                    </button>
                    {rescreenErrorId === s.id && (
                      <span className="text-xs text-rose-600 dark:text-rose-400">Rescreen failed — try again.</span>
                    )}
                    {/* Transfer, redesigned 2026-07-29 into its own bottom-
                        of-card button (components/TransferControl.tsx)
                        after the original status-dropdown-driven version
                        was tested and hit a real bug — see that
                        component's doc comment. Stays rendered even once
                        already transferred (Vlad's ask: "mention it
                        somewhere" rather than the control just vanishing
                        with no trace) — TransferControl itself swaps to a
                        small read-only "Transferred to X" mention in that
                        case via the alreadyTransferred prop.  Hidden only
                        if there's nowhere to transfer INTO yet
                        (transferProjects still loading, or this is the
                        only active project this recruiter/admin can see). */}
                    {transferProjects.length > 0 && (
                      <TransferControl
                        screeningId={s.id}
                        transferProjects={transferProjects}
                        alreadyTransferred={
                          // Was gated on `s.status === "transferred"` — a
                          // transfer now archives the original screening
                          // instead (2026-08-02), so status alone can no
                          // longer tell "already transferred" apart from any
                          // other archived candidate. The pointer column is
                          // set only by a real transfer, so it's the
                          // reliable signal for both old and new rows.
                          s.transferredToScreeningId != null
                            ? { projectName: s.transferredToProjectName, screeningId: s.transferredToScreeningId }
                            : null
                        }
                        onTransferred={(result) => handleTransferred(s.id, result)}
                      />
                    )}
                    {/* Share link, 2026-08-02 (Vlad's ask) — copies a direct
                        link to this candidate's own /candidates/[id] page,
                        same idea as the existing durable/shareable batch-
                        results page. */}
                    <button type="button" onClick={() => handleCopyLink(s.id)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                      {copiedLinkId === s.id ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="11" height="11" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Share link
                        </>
                      )}
                    </button>
                  </div>
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
          </Fragment>
        );
      })}
    </ul>
    </div>
  );
}

// ── Archive Fits tab ─────────────────────────────────────────────────────────
//
// Archive Fits, 2026-07-30 (Vlad's ask) — the review queue for archived
// candidates a "Check archive for fits" pass (Settings tab) matched against
// THIS project's JD. Per Vlad's spec: score from the past screening, static
// (non-interactive) status, a resume-view link, a way to open the full card,
// and two equal-height buttons — Screen for this project / Skip.

function ArchiveFitCard({ projectId, candidate, onDecided, onScreened }: {
  projectId: number;
  candidate: ArchiveFitCandidate;
  onDecided: (archiveFitId: number) => void;
  onScreened: () => void;
}) {
  const [deciding, setDeciding] = useState<"screen" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "screen" | "skip") {
    setDeciding(decision);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/archive-fits/${candidate.screeningId}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      onDecided(candidate.id);
      if (decision === "screen") onScreened();
    } catch {
      setError("Network error — please try again");
    } finally {
      setDeciding(null);
    }
  }

  return (
    <li className="flex items-stretch gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-zinc-800 dark:text-zinc-100">{candidate.candidateName}</p>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Archived
          </span>
        </div>
        {candidate.suggestedRoleFit && (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Suggested fit: <span className="font-medium text-violet-700 dark:text-violet-400">{candidate.suggestedRoleFit}</span>
          </p>
        )}
        {/* Stage 2 evidence, 2026-08-17 (Vlad's ask) — real checklist items
            this candidate's own strengths/concerns already back up, not just
            Stage 1's generic suggested-role-fit title. Only rendered when
            there's actual evidence (empty array = no checklist configured,
            or genuinely nothing matched) — same "only surface a signal"
            convention used across this app's other badges. */}
        {candidate.matchedChecklistItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Evidence:</span>
            {candidate.matchedChecklistItems.map((item) => (
              <span
                key={item.id}
                title={item.label}
                className={`max-w-[220px] truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  item.category === "decrease"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400"
                }`}
              >
                {item.label}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Scored {candidate.score} on original role
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <a href={`/api/history/${candidate.screeningId}/resume`} target="_blank" rel="noopener noreferrer"
            className="text-violet-600 underline underline-offset-2 hover:text-violet-700 dark:text-violet-400">
            View resume
          </a>
          <Link
            // returnTo, 2026-08-11 — lower-stakes than the same-tab cases
            // (target="_blank" opens a fresh tab, so there's no "wrong
            // page" surprise the way there was for CPQ→FDE), but this new
            // tab's own Back button would otherwise still fall back to
            // whatever project this Archive Fits candidate's OWN screening
            // belongs to rather than back to this Archive Fits queue — same
            // fix for consistency.
            href={`/candidates/${candidate.screeningId}${
              typeof window !== "undefined"
                ? `?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
                : ""
            }`}
            target="_blank"
            className="text-violet-600 underline underline-offset-2 hover:text-violet-700 dark:text-violet-400">
            Open card
          </Link>
        </div>
        {error && <p className="text-xs text-rose-500 dark:text-rose-400">{error}</p>}
      </div>
      <div className="flex w-40 shrink-0 flex-col gap-2">
        <button type="button" onClick={() => decide("screen")} disabled={deciding !== null}
          className="flex-1 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
          {deciding === "screen" ? "Screening..." : "Screen for this project"}
        </button>
        <button type="button" onClick={() => decide("skip")} disabled={deciding !== null}
          className="flex-1 rounded-xl border border-zinc-200 px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {deciding === "skip" ? "Skipping..." : "Skip"}
        </button>
      </div>
    </li>
  );
}

function ArchiveFitsTab({ projectId, candidates, onDecided, onScreened }: {
  projectId: number;
  candidates: ArchiveFitCandidate[];
  onDecided: (archiveFitId: number) => void;
  onScreened: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No pending archive fits to review.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((c) => (
        <ArchiveFitCard key={c.id} projectId={projectId} candidate={c} onDecided={onDecided} onScreened={onScreened} />
      ))}
    </ul>
  );
}

// ── Settings tab ───────────────────────────────────────────────────────────

function SettingsTab({ project, onNameSaved, onStatusToggled, onDeleted, onThresholdSaved, onFitExclusionSaved, onArchiveFitsChecked }: {
  project: Project;
  onNameSaved: (name: string) => void;
  onStatusToggled: (status: "active" | "archived") => void;
  onDeleted: () => void;
  onThresholdSaved: (threshold: number) => void;
  onFitExclusionSaved: (excludeFromFitSuggestions: boolean) => void;
  /** Refreshes the parent's archiveFits list after a check finds matches, so the tab appears without a manual reload. */
  onArchiveFitsChecked: () => void;
}) {
  const router = useRouter();
  const [nameValue, setNameValue] = useState(project.name);
  const [savingName, setSavingName] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [threshold, setThreshold] = useState(project.scoreThreshold ?? 45);
  const [savingThreshold, setSavingThreshold] = useState(false);
  // Cross-Project Fit Suggestion opt-out — Vlad's ask, 2026-07-30. See
  // Project.excludeFromFitSuggestions (lib/types.ts) for the deferred-
  // wiring note; requires supabase-migration-exclude-from-fit-suggestions.sql.
  const [excludeFromFit, setExcludeFromFit] = useState(project.excludeFromFitSuggestions ?? false);
  const [savingFitExclusion, setSavingFitExclusion] = useState(false);
  // Archive Fits, 2026-07-30 (Vlad's ask) — on-demand check only, triggered
  // here or at role creation, never automatic/background. See
  // app/api/projects/[id]/archive-fits/check/route.ts.
  const [checkingArchive, setCheckingArchive] = useState(false);
  const [archiveCheckResult, setArchiveCheckResult] = useState<string | null>(null);
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

  async function saveThreshold() {
    setSavingThreshold(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreThreshold: threshold }),
      });
      onThresholdSaved(threshold);
    } catch { /* non-fatal */ }
    finally { setSavingThreshold(false); }
  }

  async function saveFitExclusion(next: boolean) {
    setExcludeFromFit(next);
    setSavingFitExclusion(true);
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeFromFitSuggestions: next }),
      });
      onFitExclusionSaved(next);
    } catch { /* non-fatal */ }
    finally { setSavingFitExclusion(false); }
  }

  async function checkArchiveFits() {
    setCheckingArchive(true);
    setArchiveCheckResult(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/archive-fits/check`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchiveCheckResult(data.error ?? "Check failed");
        return;
      }
      setArchiveCheckResult(
        data.matched > 0
          ? `Found ${data.matched} possible fit${data.matched === 1 ? "" : "s"} — see the Archive Fits tab.`
          : "No new matches found."
      );
      if (data.matched > 0) onArchiveFitsChecked();
    } catch {
      setArchiveCheckResult("Network error — please try again");
    } finally {
      setCheckingArchive(false);
    }
  }

  async function toggleStatus() {
    setTogglingStatus(true);
    setStatusError(null);
    const next = project.status === "active" ? "archived" : "active";
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error ?? "Failed to update status");
        return;
      }
      onStatusToggled(next);
      router.refresh();
    } catch {
      setStatusError("Network error — please try again");
    } finally {
      setTogglingStatus(false);
    }
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

      {/* Score threshold */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Score threshold</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Candidates below this score are not saved to the pipeline.
            </p>
          </div>
          <span className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">
            {threshold}
          </span>
        </div>
        <input
          type="range" min={0} max={100} step={5}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>0 — save everything</span>
          <span>100 — save nothing</span>
        </div>
        <button
          type="button"
          onClick={saveThreshold}
          disabled={savingThreshold || threshold === (project.scoreThreshold ?? 45)}
          className="self-end rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingThreshold ? "Saving…" : "Save threshold"}
        </button>
      </div>

      {/* Cross-Project Fit Suggestion opt-out — Vlad's ask, 2026-07-30:
          "not try to find a better fit for this role" — when on, this
          project is never checked/suggested when a candidate scores below
          threshold on some OTHER project (app/api/cross-project-fit). */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Exclude from fit suggestions</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Keep this role out of "better fit" suggestions for candidates screened elsewhere.
          </p>
        </div>
        <button type="button" onClick={() => saveFitExclusion(!excludeFromFit)} disabled={savingFitExclusion}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${excludeFromFit ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-600"}`}>
          <span className={`inline-block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white transition-transform ${excludeFromFit ? "translate-x-4" : ""}`} />
        </button>
      </div>

      {/* Archive Fits — Vlad's ask, 2026-07-30: reuse archived candidates
          instead of losing track of them. Checks every archived candidate
          across this recruiter's other roles that has a suggested role fit
          attached, against THIS role's JD; matches show up on the Archive
          Fits tab (only visible once there's at least one match). */}
      <div className="flex items-center justify-between rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Check archive for fits</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {archiveCheckResult ?? "Look for archived candidates who'd be a better fit for this role."}
          </p>
        </div>
        {checkingArchive ? (
          <ScoringLoader className="h-7 w-44" />
        ) : (
          <button type="button" onClick={checkArchiveFits} disabled={checkingArchive}
            className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            Check now
          </button>
        )}
      </div>

      {/* Status */}
      <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
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
        {statusError && (
          <p className="text-xs text-rose-500 dark:text-rose-400">{statusError}</p>
        )}
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

// `rowBg`, added 2026-08-03 (Vlad's ask: "Change the background color for
// each stage row so it's easier to tell them apart") — until now only the
// narrow label column on the left carried a stage tint; the much larger chip
// area next to it was always plain white/zinc regardless of stage, so two
// adjacent rows only differed by that thin strip. `rowBg` washes the whole
// chip area in the same hue, but at a much lower opacity than the label's
// own `bg` (a whisper, not a wash) — deliberately faint for two reasons: (1)
// this file's own dragover state already uses a soft violet tint for the
// same area, and a stage tint needed to read as clearly weaker so dragover
// still stands out; (2) the per-chip status colors added earlier this same
// round (rose/gray/emerald/amber for Reject/On Hold/Scheduled/Not scheduled)
// sit ON TOP of this background, and needed to stay the dominant, legible
// signal — a strong row wash would visually compete with them, particularly
// In-Person (amber label) against a "Not scheduled" chip (also amber).
const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; border: string; rowBg: string }> = {
  TA:         { bg: "bg-blue-50 dark:bg-blue-500/10",    text: "text-blue-700 dark:text-blue-400",    dot: "bg-blue-400",    border: "border-blue-200 dark:border-blue-500/30",    rowBg: "bg-blue-50/50 dark:bg-blue-500/5" },
  L1:         { bg: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-400",  border: "border-violet-200 dark:border-violet-500/30", rowBg: "bg-violet-50/50 dark:bg-violet-500/5" },
  // Was indigo — 2026-08-03 (Vlad: "L1 and L2 look too similar"). Indigo
  // sits directly next to L1's violet on the color wheel, so at the row
  // wash's low opacity the two were nearly indistinguishable. Cyan is far
  // enough from both violet (L1) and blue (TA) to read as clearly distinct.
  L2:         { bg: "bg-cyan-50 dark:bg-cyan-500/10",     text: "text-cyan-700 dark:text-cyan-400",     dot: "bg-cyan-400",    border: "border-cyan-200 dark:border-cyan-500/30",     rowBg: "bg-cyan-50/50 dark:bg-cyan-500/5" },
  "In-Person":{ bg: "bg-amber-50 dark:bg-amber-500/10",   text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-400",   border: "border-amber-200 dark:border-amber-500/30",   rowBg: "bg-amber-50/30 dark:bg-amber-500/5" },
  Offer:      { bg: "bg-emerald-50 dark:bg-emerald-500/10",text: "text-emerald-700 dark:text-emerald-400",dot: "bg-emerald-400",border: "border-emerald-200 dark:border-emerald-500/30", rowBg: "bg-emerald-50/50 dark:bg-emerald-500/5" },
  Reject:     { bg: "bg-rose-50 dark:bg-rose-500/10",     text: "text-rose-700 dark:text-rose-400",     dot: "bg-rose-400",    border: "border-rose-200 dark:border-rose-500/30",     rowBg: "bg-rose-50/50 dark:bg-rose-500/5" },
};

function DrawerBody({
  selected,
  trackerEntry,
  onTrackerSave,
  onViewResult,
  onScreeningFieldSaved,
  photoUrl,
  onPhotoUpload,
  projectName,
}: {
  selected: ScreeningRecord;
  trackerEntry: FullTrackerData;
  onTrackerSave: (fields: Partial<FullTrackerData>) => void;
  onViewResult: (id: number) => void;
  onScreeningFieldSaved: (id: number, fields: Partial<ScreeningRecord>) => void;
  photoUrl?: string;
  onPhotoUpload: (file: File) => void;
  /** Auto-fills the Role field when nothing's been saved yet — still freely editable. */
  projectName: string;
}) {
  const [leverUrl, setLeverUrl] = useState(selected.leverUrl ?? "");
  const [company, setCompany] = useState(trackerEntry.company ?? "");
  const [role, setRole] = useState(trackerEntry.role ?? projectName);
  const [editingRole, setEditingRole] = useState(false);
  const [expectedLevel, setExpectedLevel] = useState(trackerEntry.expectedLevel ?? "");
  // Manually entered in this drawer — 2026-07-15. Not yet read back from the
  // shared getFullTrackerEntries select (see lib/screenings.ts comment); will
  // appear blank on reload until that follow-up wiring lands post-migration.
  const [location, setLocation] = useState(trackerEntry.location ?? "");
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
    setRole(trackerEntry.role ?? projectName);
    setEditingRole(false);
    setExpectedLevel(trackerEntry.expectedLevel ?? "");
    setLocation(trackerEntry.location ?? "");
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

  const initials = selected.candidateName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    // No longer its own scroll container, 2026-08-02 — the parent now wraps
    // this together with the "Move to stage" block and RejectionCard in one
    // shared scrollable region (see the call site's comment). Still owns its
    // own flex-col layout/spacing/padding, just doesn't scroll on its own.
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* Profile photo */}
      <label className="group relative mx-auto block h-24 w-24 cursor-pointer">
        <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
          {photoUrl ? (
            <img src={photoUrl} alt={selected.candidateName} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-zinc-400 dark:text-zinc-500">
              {initials}
            </span>
          )}
        </div>
        {/* Camera overlay on hover */}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhotoUpload(f); e.target.value = ""; }}
        />
      </label>

      {/* Role — shown right under the photo; defaults to the project name until
          edited. Click-to-edit per Vlad's request, 2026-07-15: static text +
          edit button instead of an always-open input. */}
      <div className="-mt-1 flex justify-center">
        {editingRole ? (
          <input
            type="text"
            autoFocus
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onBlur={(e) => { saveTrackerField({ role: e.target.value }, "role"); setEditingRole(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder="FDE_AI Builder"
            className={`mx-auto max-w-[220px] text-center ${inputCls}`}
          />
        ) : (
          <button type="button" onClick={() => setEditingRole(true)}
            className="group inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-violet-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-violet-400">
            {role || projectName}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="opacity-0 transition-opacity group-hover:opacity-60">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {saving === "role" && <span className="ml-1.5 self-center text-[10px] text-zinc-400">Saving…</span>}
        {saving !== "role" && saved === "role" && <span className="ml-1.5 self-center text-[10px] text-emerald-500">Saved</span>}
      </div>

      {/* View result link */}
      <button type="button" onClick={() => onViewResult(selected.id)}
        className="flex items-center gap-1.5 self-start text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        View full screening result
      </button>

      {/* Interview scheduling — combined indicator + date picker */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Blink removed 2026-08-03 (Vlad's ask, same round as the
                Tracker board chip colors: "remove the blinking... use
                transparent colors so it doesn't hurt the eye") — was an
                animate-ping overlay shown while unscheduled. */}
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
            </span>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {interviewDate ? "Interview scheduled" : "Schedule interview"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="date"
              value={interviewDate}
              onChange={(e) => setInterviewDate(e.target.value)}
              onBlur={(e) => {
                const newDate = e.target.value;
                const isScheduled = !!newDate;
                setScheduled(isScheduled);
                saveTrackerField({ interviewDate: newDate, scheduled: isScheduled }, "interviewDate");
              }}
              className="cursor-pointer bg-transparent text-xs font-medium text-emerald-700 outline-none [color-scheme:light] dark:text-emerald-400 dark:[color-scheme:dark]"
            />
            {/* Clear, 2026-07-31 (Vlad's ask) — the native date input's own
                clear affordance (the little "x" some browsers show) isn't
                consistent across browsers and doesn't touch `scheduled`
                anyway. This resets both fields together in one click, same
                shape as every other saveTrackerField call here. */}
            {interviewDate && (
              <button
                type="button"
                onClick={() => {
                  setInterviewDate("");
                  setScheduled(false);
                  saveTrackerField({ interviewDate: "", scheduled: false }, "interviewDate");
                }}
                title="Clear interview date"
                className="rounded-full p-1 text-emerald-600 opacity-60 transition-opacity hover:opacity-100 dark:text-emerald-400"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
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

      {/* Company + Exp. level */}
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

      {/* Location — manually entered, 2026-07-15 */}
      <div>
        <FieldLabel label="Location" fkey="location" />
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
          onBlur={(e) => saveTrackerField({ location: e.target.value }, "location")}
          placeholder="New York, NY" className={inputCls} />
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

function TrackerTab({ screenings, stagesMap, onStageChange, trackerData, onTrackerDataChange, onViewResult, onScreeningFieldSaved, projectName }: {
  screenings: ScreeningRecord[];
  stagesMap: Record<number, TrackerStage>;
  onStageChange: (id: number, stage: TrackerStage) => void;
  trackerData: Record<number, FullTrackerData>;
  onTrackerDataChange: (id: number, fields: Partial<FullTrackerData>) => void;
  onViewResult: (id: number) => void;
  onScreeningFieldSaved: (id: number, fields: Partial<ScreeningRecord>) => void;
  projectName: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ScreeningRecord | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  // Confirm/cancel gate for the drawer's "Move to stage" chip row — Vlad's
  // ask, 2026-07-30: this was the one stage/status control left in the app
  // that still committed instantly on click, unlike every other one
  // (StatusStageControl.tsx's chips, both status and stage). Cleared
  // whenever a different candidate is selected, below.
  const [pendingDrawerStage, setPendingDrawerStage] = useState<TrackerStage | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>(() =>
    Object.fromEntries(screenings.filter((s) => s.photoUrl).map((s) => [s.id, `/api/history/${s.id}/photo`]))
  );
  // Reject column collapse, 2026-08-15 (Vlad's ask: "just looks a lot when
  // we keep adding them there") — plain count + expand toggle, NOT the
  // "Multiple roles" identity-clustering pattern used elsewhere in this app
  // (computeMatchClusters groups the same real person applying to multiple
  // roles, which doesn't apply here — rejected candidates aren't duplicates
  // of each other). Threshold and default collapsed state are a judgment
  // call, not something Vlad specified a number for.
  const REJECT_COLLAPSE_THRESHOLD = 6;
  const [showAllRejected, setShowAllRejected] = useState(false);

  async function handlePhotoUpload(screeningId: number, file: File) {
    const form = new FormData();
    form.append("photo", file);
    const res = await fetch(`/api/history/${screeningId}/photo`, { method: "POST", body: form });
    if (res.ok) {
      const proxyUrl = `/api/history/${screeningId}/photo`;
      setPhotoUrls((prev) => ({ ...prev, [screeningId]: proxyUrl }));
      const { photoUrl } = await res.json(); // storage path, saved to DB by the route
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

  // Clear any unconfirmed stage pick when the drawer switches to a
  // different candidate (or closes) — same reasoning as DrawerBody's own
  // per-candidate reset effect.
  useEffect(() => {
    setPendingDrawerStage(null);
  }, [selected?.id]);

  // "screening" status = actively in the Tracker (TA/L1/L2/In-Person/Offer
  // arc) — was "interview" before that status was removed 2026-07-15.
  const trackerScreenings = screenings.filter((s) => s.status === "screening");

  const filtered = trackerScreenings.filter((s) =>
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
    const rows = trackerScreenings.map((s) => {
      const td = trackerData[s.id] ?? {};
      return {
        "Name": s.candidateName,
        "Stage": stagesMap[s.id] ?? "New",
        "Scheduled": td.scheduled ? "Yes" : "No",
        "Company": td.company ?? "",
        "Role": td.role ?? projectName,
        "Exp. Level": td.expectedLevel ?? "",
        "Location": td.location ?? "",
        "Steps Completed": td.stepsCompleted ?? "",
        "Comments": td.comments ?? "",
        "Immigration": td.immigration ?? "",
        "Interview Date": td.interviewDate ?? "",
             "On Hold": td.onHold ? (td.onHoldReason ? `Yes — ${td.onHoldReason}` : "Yes") : "No",
        "Rejection Reason": td.rejectReason ?? "",
        "Lever URL": s.leverUrl ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    // Column widths
    ws["!cols"] = [
      { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 18 },
      { wch: 18 }, { wch: 32 }, { wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 36 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tracker");
    XLSX.writeFile(wb, "tracker.xlsx");
  }

  if (trackerScreenings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" strokeLinecap="round"/>
            <rect x="9" y="3" width="6" height="4" rx="1" strokeLinecap="round"/>
            <path d="M9 12h6M9 16h4" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No one in the tracker yet</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Move candidates to Screening status in the Pipeline tab to track them here.</p>
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
            const allCandidates = grouped[key] ?? [];
            // Reject-only collapse — see showAllRejected's declaration above
            // for why this isn't the "Multiple roles" pattern.
            const isCollapsedReject = key === "Reject" && !showAllRejected && allCandidates.length > REJECT_COLLAPSE_THRESHOLD;
            const candidates = isCollapsedReject ? allCandidates.slice(0, REJECT_COLLAPSE_THRESHOLD) : allCandidates;
            const hiddenRejectedCount = isCollapsedReject ? allCandidates.length - candidates.length : 0;
            const c = isUnplaced
              ? { bg: "bg-zinc-50 dark:bg-zinc-900/50", text: "text-zinc-400 dark:text-zinc-500", dot: "bg-zinc-300", border: "border-zinc-200 dark:border-zinc-700", rowBg: "bg-zinc-50/60 dark:bg-zinc-900/30" }
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
                  <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-600">{allCandidates.length} {allCandidates.length === 1 ? "person" : "people"}</span>
                </div>

                {/* Chips */}
                <div className={`flex flex-1 flex-wrap items-start gap-2 px-4 py-3 transition-colors ${
                  isOver ? "bg-violet-50/60 dark:bg-violet-500/5" : c.rowBg
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
                    const td = trackerData[s.id];
                    // Whole-chip status color, 2026-08-03 (Vlad's ask: "Make
                    // the whole user chip Green (if scheduled), Yellow (if
                    // not scheduled), Red (if rejected)... Use transparent
                    // colors so it doesn't hurt the eye"). Only meaningful
                    // once a candidate is actually placed in a real stage —
                    // "New"/unplaced candidates keep the neutral zinc look
                    // they always had, same as before this change. Priority
                    // (a chip only ever shows ONE dominant tone): Reject is
                    // terminal so it always wins; On Hold is an exceptional
                    // state worth flagging even over a scheduled interview;
                    // otherwise scheduled/not-scheduled as before. All tones
                    // use low-opacity/soft fills (`*-50`/`*-500/10`, matching
                    // this file's existing STAGE_COLORS palette) rather than
                    // solid color, per "use transparent colors."
                    const tone = isUnplaced
                      ? { bg: "bg-white dark:bg-zinc-800", border: "border-zinc-200 dark:border-zinc-700", hover: "hover:border-zinc-300 dark:hover:border-zinc-600" }
                      : key === "Reject"
                      ? { bg: "bg-rose-50/70 dark:bg-rose-500/10", border: "border-rose-200 dark:border-rose-500/25", hover: "hover:border-rose-300 dark:hover:border-rose-500/40" }
                      : td?.onHold
                      ? { bg: "bg-zinc-100/80 dark:bg-zinc-700/25", border: "border-zinc-300 dark:border-zinc-600/50", hover: "hover:border-zinc-400 dark:hover:border-zinc-500" }
                      : td?.scheduled
                      ? { bg: "bg-emerald-50/70 dark:bg-emerald-500/10", border: "border-emerald-200 dark:border-emerald-500/25", hover: "hover:border-emerald-300 dark:hover:border-emerald-500/40" }
                      : { bg: "bg-amber-50/60 dark:bg-amber-500/10", border: "border-amber-200 dark:border-amber-500/25", hover: "hover:border-amber-300 dark:hover:border-amber-500/40" };
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
                          title={!isUnplaced ? (key === "Reject" ? "Rejected" : td?.onHold ? "On hold" : td?.scheduled ? "Scheduled" : "Not scheduled") : undefined}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all select-none ${tone.bg} ${tone.border} ${
                            isActive ? `shadow-md ring-2 ring-violet-300 dark:ring-violet-500/40` : `${tone.hover} hover:shadow-sm`
                          }`}>
                          <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg">
                            {photoUrls[s.id] ? (
                              <img src={photoUrls[s.id]} alt={s.candidateName} className="h-full w-full object-cover" />
                            ) : (
                              <span className={`flex h-full w-full items-center justify-center text-xs font-bold ${
                                s.score >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                                : s.score >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                : "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                              }`}>{s.score}</span>
                            )}
                          </span>
                          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" className="shrink-0 text-zinc-300 dark:text-zinc-600">
                            <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
                            <circle cx="2" cy="7" r="1.5"/><circle cx="6" cy="7" r="1.5"/>
                            <circle cx="2" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/>
                          </svg>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{s.candidateName}</span>
                          {td?.interviewDate && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                              {new Date(td.interviewDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          )}
                          {!isUnplaced && td?.onHold && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Hold</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                  {isCollapsedReject && (
                    <button
                      type="button"
                      onClick={() => setShowAllRejected(true)}
                      className="flex items-center gap-1.5 self-center rounded-xl border border-dashed border-rose-200 px-3 py-2 text-xs font-semibold text-rose-500 transition-colors hover:border-rose-300 hover:bg-rose-50/60 dark:border-rose-500/25 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    >
                      +{hiddenRejectedCount} more rejected — show all
                    </button>
                  )}
                  {key === "Reject" && showAllRejected && allCandidates.length > REJECT_COLLAPSE_THRESHOLD && (
                    <button
                      type="button"
                      onClick={() => setShowAllRejected(false)}
                      className="flex items-center gap-1.5 self-center rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800"
                    >
                      Show less
                    </button>
                  )}
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

            {/* Single scrollable region for everything below the header,
                2026-08-02 — fixes a real bug Vlad reported: the "Move to
                stage" block and RejectionCard used to render OUTSIDE
                DrawerBody's own scroll container (which was the only
                scrollable region in the drawer), so once RejectionCard's
                fraud-claims form grew tall enough to push the drawer's total
                content past the viewport height, the overflow had nowhere
                to scroll to — it just clipped, with no way to reach the
                Save button. Now everything from here down (stage picker,
                RejectionCard, DrawerBody's own fields) shares one scroll
                container; DrawerBody's own wrapper no longer scrolls
                independently (see its own className, changed to match). */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {/* Move stage — confirm/cancel gated, 2026-07-30 (Vlad's ask):
                this used to commit the moment a chip was clicked, unlike
                every other status/stage control. Clicking a chip now only
                stages it as pendingDrawerStage; the actual onStageChange
                call happens on Confirm. Re-clicking the candidate's actual
                current stage clears the pending pick (nothing to confirm).
                Redesigned 2026-08-02 (Vlad, two asks):
                (1) "add those confirmation button exactly under the status
                that wants to be switched to" — the Confirm/Cancel used to
                render as one generic bar below the WHOLE chip row,
                regardless of which chip was picked. Now each chip carries
                its own inline Confirm/Cancel, rendered immediately next to
                it (in the same flex-wrap flow, so it appears directly under/
                beside that specific chip, not a separate detached block).
                (2) "remove the confirmation button from reject status since
                the reason has to be mentioned regardless" — Reject skips
                the pending/confirm step entirely and commits immediately on
                click; RejectionCard's own mandatory reason + Save already
                serves as the real confirmation for this one stage. */}
            <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Move to stage</p>
              <div className="flex flex-wrap items-start gap-1.5">
                {TRACKER_STAGES.map((st) => {
                  const sc = STAGE_COLORS[st];
                  const active = (pendingDrawerStage ?? drawerStage) === st;
                  const isReject = st === "Reject";
                  return (
                    // Vertical stack, 2026-08-02 (Vlad: "show it under the
                    // actual status chip") — was a horizontal pair (chip,
                    // then Confirm/Cancel beside it); now Confirm/Cancel
                    // renders directly BELOW the specific chip it belongs to.
                    <span key={st} className="flex flex-col items-start gap-1">
                      <button type="button"
                        onClick={() => {
                          // Minor correctness fix, 2026-08-02: don't re-fire
                          // onStageChange (a real PATCH call) when Reject is
                          // clicked while it's already the active stage —
                          // matches every other stage's own no-op-when-
                          // already-active behavior below.
                          if (isReject) { if (st !== drawerStage) onStageChange(selected.id, "Reject"); return; }
                          setPendingDrawerStage(st === drawerStage ? null : st);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                          active
                            ? `${sc.bg} ${sc.text} ${sc.border} shadow-sm`
                            : isReject
                            ? "border-zinc-200 text-zinc-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                            : "border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                        }`}>
                        {st}
                      </button>
                      {pendingDrawerStage === st && !isReject && (
                        <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 py-1 pl-1.5 pr-1 dark:border-violet-500/30 dark:bg-violet-500/10">
                          <button type="button"
                            onClick={() => { onStageChange(selected.id, pendingDrawerStage); setPendingDrawerStage(null); }}
                            title="Confirm"
                            className="flex shrink-0 items-center justify-center text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <button type="button"
                            onClick={() => setPendingDrawerStage(null)}
                            title="Cancel"
                            className="flex shrink-0 items-center justify-center text-zinc-400 hover:text-rose-600 dark:text-zinc-500 dark:hover:text-rose-400">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Rejection card — right beneath the "Move to stage" chip row per
                Vlad's ask, 2026-07-29. See components/RejectionCard.tsx.
                Simplified 2026-08-02: Reject now commits immediately on
                click (no pending/confirm step, see the chip row above), so
                this only ever needs to check the real drawerStage — the
                `pendingDrawerStage` fallback that used to matter here (back
                when Reject also needed its own Confirm click) is gone. */}
            {drawerStage === "Reject" && (
              <RejectionCard
                // Forces a fresh mount per candidate — RejectionCard owns its
                // own local state (reason choice, fraud claims) rather than
                // syncing via a useEffect like DrawerBody's fields do, so
                // without this key, switching from one Reject-stage candidate
                // to another would carry over the previous candidate's
                // half-filled form.
                key={selected.id}
                screeningId={selected.id}
                initialReason={trackerData[selected.id]?.rejectReason ?? ""}
                onSaveReason={(reason) => onTrackerDataChange(selected.id, { rejectReason: reason })}
              />
            )}

            {/* Scrollable content */}
            <DrawerBody
              selected={selected}
              trackerEntry={trackerData[selected.id] ?? {}}
              onTrackerSave={(fields) => onTrackerDataChange(selected.id, fields)}
              onViewResult={(id) => { setSelected(null); onViewResult(id); }}
              onScreeningFieldSaved={onScreeningFieldSaved}
              photoUrl={photoUrls[selected.id]}
              onPhotoUpload={(file) => handlePhotoUpload(selected.id, file)}
              projectName={projectName}
            />
            </div>
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
  // Archive Fits, 2026-07-30 — tab only shows when this is non-empty (Vlad's
  // ask: hide it entirely rather than showing an empty tab), except while
  // it's the active tab, so it doesn't vanish out from under the recruiter
  // mid-review as they clear the last couple of rows.
  const [archiveFits, setArchiveFits] = useState<ArchiveFitCandidate[]>([]);

  // Derived for PipelineTab
  const stagesMap: Record<number, TrackerStage> = {};
  for (const [sid, td] of Object.entries(trackerData)) {
    if (td.stage) stagesMap[Number(sid)] = td.stage;
  }

  // "screening" status = actively in the Tracker (TA/L1/L2/In-Person/Offer
  // arc) — was "interview" before that status was removed 2026-07-15.
  const trackerCount = screenings.filter((s) => s.status === "screening").length;

  const TABS: { key: Tab; label: string }[] = [
    { key: "filters", label: "Filters" },
    { key: "screen", label: "Screen" },
    { key: "pipeline", label: `Pipeline${screenings.length > 0 ? ` (${screenings.length})` : ""}` },
    { key: "tracker", label: `Tracker${trackerCount > 0 ? ` (${trackerCount})` : ""}` },
    ...(archiveFits.length > 0 || tab === "archiveFits"
      ? [{ key: "archiveFits" as Tab, label: `Archive Fits (${archiveFits.length})` }]
      : []),
    { key: "settings", label: "Settings" },
  ];

  function loadArchiveFits() {
    fetch(`/api/projects/${id}/archive-fits`)
      .then((r) => r.json())
      .then((d) => setArchiveFits(d.candidates ?? []))
      .catch(() => {});
  }

  function handleStageChange(id: number, stage: TrackerStage) {
    // Clear the interview date/scheduled flag on a real stage move, 2026-08-03
    // (Vlad's ask) — an interview date set for the stage a candidate is
    // LEAVING shouldn't keep showing (Scheduled/green) once they've moved to
    // a new stage that hasn't had its own interview scheduled yet. Re-picking
    // the SAME stage a candidate is already in (a no-op click, e.g. the
    // Tracker board's own re-click-to-cancel-pending-move pattern) leaves
    // both fields untouched — nothing actually moved, so nothing should
    // reset. `stagesMap` is this function's own component-scope lookup of
    // each candidate's current stage, already computed above.
    const changingStage = stagesMap[id] !== stage;
    handleTrackerDataChange(id, {
      stage,
      ...(changingStage ? { interviewDate: "", scheduled: false } : {}),
    });
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
      fetch(`/api/projects/${id}/archive-fits`).then((r) => r.json()).catch(() => ({ candidates: [] })),
    ])
      .then(([projectData, historyData, archiveFitsData]) => {
        setArchiveFits(archiveFitsData.candidates ?? []);
        if (projectData.error) { setNotFound(true); return; }
        setProject(projectData.project);
        const allScreenings: ScreeningRecord[] = historyData.screenings ?? [];
        setScreenings(allScreenings);
        // "screening" status = actively in the Tracker (TA/L1/L2/In-Person/Offer
        // arc) — was "interview" before that status was removed 2026-07-15.
        const trackerIds = allScreenings.filter((s) => s.status === "screening").map((s) => s.id);
        if (trackerIds.length > 0) {
          fetch(`/api/tracker?ids=${trackerIds.join(",")}`)
            .then((r) => r.json())
            .then((d) => setTrackerData(d.entries ?? {}))
            .catch(() => {});
        }

        // Deep-link support (2026-07-20, Vlad's ask — FunnelView candidate
        // names link here). Also fixes a pre-existing gap: the "click to jump
        // to matching candidate" duplicate/history-alert links already built
        // `?tab=pipeline` URLs (ResultCard.tsx), but nothing on this page ever
        // read that param — they landed on Filters every time. Read via
        // window.location.search (not useSearchParams()) to avoid Next.js's
        // Suspense-boundary requirement for that hook; this only needs a
        // one-time read right after data loads, not reactive URL tracking.
        const urlParams = new URLSearchParams(window.location.search);
        const candidateParam = urlParams.get("candidate");
        const tabParam = urlParams.get("tab");
        const validTabs: Tab[] = ["filters", "screen", "pipeline", "tracker", "settings", "archiveFits"];
        if (candidateParam) {
          const candidateId = Number(candidateParam);
          if (!Number.isNaN(candidateId) && allScreenings.some((s) => s.id === candidateId)) {
            setTab("pipeline");
            setExpandedId(candidateId);
          }
        } else if (tabParam && (validTabs as string[]).includes(tabParam)) {
          setTab(tabParam as Tab);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Write tab/candidate state back into the URL (2026-08-11, Vlad's ask —
  // pressing browser Back after following an internal link into this page
  // (e.g. "Also screened in [project]" on ResultCard, a FunnelView deep
  // link, Tracker's onViewResult) landed on whatever tab/candidate the URL
  // happened to have at that ORIGINAL link, not whatever tab the recruiter
  // had actually switched to locally since — switching tabs here (the
  // button below, or onViewResult) only ever called setTab()/setExpandedId,
  // never touched the URL, so there was nothing for Back to restore.
  // history.replaceState (not router.replace/pushState) so every tab/filter
  // change updates the CURRENT history entry in place instead of stacking
  // up new ones — that would make Back need repeated presses just to leave
  // the page. The entry that exists right before navigating away is always
  // this page's latest state, so Back after that lands here exactly as it
  // was left. Guarded on `loading` so this can't fire before the read
  // effect above has applied a fresh deep link's own tab/candidate params.
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    if (tab !== "filters") params.set("tab", tab); else params.delete("tab");
    if (expandedId != null) params.set("candidate", String(expandedId)); else params.delete("candidate");
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (newUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", newUrl);
    }
  }, [tab, expandedId, loading]);

  // Scroll position, same ask — restore where the recruiter was scrolled
  // to, not just the right tab/candidate. Tied to this history entry's own
  // `state` object (via replaceState) rather than a separate sessionStorage
  // key, so it can never go stale or collide across different candidates/
  // filter combinations — it's inherently scoped to the exact entry the
  // params above already keep in sync. `scrollRestoration = "manual"`
  // stops the browser's own automatic restore from fighting this: it fires
  // on its own timing, before this page's async-loaded content has
  // necessarily rendered at its real height.
  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return;
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = prev; };
  }, []);

  useEffect(() => {
    if (loading) return;
    const savedY = (window.history.state as { scrollY?: number } | null)?.scrollY;
    if (typeof savedY === "number") {
      // One rAF so this runs after the just-loaded content has actually
      // laid out — restoring immediately on the same tick `loading` flips
      // can land short if the page isn't tall enough yet.
      requestAnimationFrame(() => window.scrollTo(0, savedY));
    }
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        window.history.replaceState(
          { ...(window.history.state ?? {}), scrollY: window.scrollY },
          "",
          window.location.href
        );
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [loading]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
        <SiteHeader active="/projects" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-2 px-6 py-10">
          <ScoringLoader className="h-10 w-72" />
        </main>
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
        <SiteHeader active="/projects" />
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
          <p className="text-zinc-500 dark:text-zinc-400">Role not found.</p>
          <Link href="/projects" className="text-sm text-violet-600 underline underline-offset-2 dark:text-violet-400">Back to Projects</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/projects" />

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-1">
          <Link href="/projects" className="mb-1 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M5 12l7 7M5 12l7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Projects
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{project.name}</h2>
            {project.status === "archived" && (
              <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">Archived</span>
            )}
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {screenings.length} candidate{screenings.length !== 1 ? "s" : ""} screened · Created {formatDate(project.createdAt)}
          </p>
        </div>

        {/* Tabs — narrow-screen fix, 2026-07-30: 5 tabs (2 with live counts
            appended, e.g. "Pipeline (42)") never wrapped and never scrolled,
            just silently overflowed the page on a phone-width viewport.
            `overflow-x-auto` + `shrink-0 whitespace-nowrap` on each button
            turns that into a horizontally scrollable row instead — same
            fallback pattern as SiteHeader's own nav fix right above it.
            Explicit `overflow-y-hidden` alongside it — Vlad caught a visible
            vertical scroll affordance on this row that turned out to be a
            real CSS quirk: setting only overflow-x non-visible makes the
            browser compute overflow-y as `auto` too (CSS2.1 §11.1.1), so
            any tiny rounding overflow in row height was enough to show a
            vertical scrollbar nobody wanted. */}
        <div className="mb-6 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => { setTab(t.key); setExpandedId(null); }}
              className={`-mb-px shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
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
            checklist={project.checklist}
            onChecklistUpdated={(newChecklist) => setProject((p) => p ? { ...p, checklist: newChecklist } : p)}
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
          <ScreenTab
            project={project}
            onScreeningsSaved={loadScreenings}
            onScreeningFieldSaved={(id, fields) => setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, ...fields } : s))}
            stagesMap={stagesMap}
            onStageChange={handleStageChange}
          />
        )}
        {tab === "pipeline" && (
          <PipelineTab
            screenings={screenings}
            projectId={project.id}
            stagesMap={stagesMap}
            onStageChange={handleStageChange}
            onScreeningFieldSaved={(id, fields) => setScreenings((prev) => prev.map((s) => s.id === id ? { ...s, ...fields } : s))}
            onDeleted={(id) => setScreenings((prev) => prev.filter((s) => s.id !== id))}
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
            projectName={project.name}
          />
        )}
        {tab === "archiveFits" && (
          <ArchiveFitsTab
            projectId={project.id}
            candidates={archiveFits}
            onDecided={(archiveFitId) => setArchiveFits((prev) => prev.filter((c) => c.id !== archiveFitId))}
            onScreened={loadScreenings}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            project={project}
            onNameSaved={(name) => setProject((p) => p ? { ...p, name } : p)}
            onStatusToggled={(status) => setProject((p) => p ? { ...p, status } : p)}
            onDeleted={() => window.location.href = "/projects"}
            onThresholdSaved={(scoreThreshold) => setProject((p) => p ? { ...p, scoreThreshold } : p)}
            onFitExclusionSaved={(excludeFromFitSuggestions) => setProject((p) => p ? { ...p, excludeFromFitSuggestions } : p)}
            onArchiveFitsChecked={loadArchiveFits}
          />
        )}
      </main>
      {/* Vlad's ask, 2026-07-30: "add a go to the top" right after screening
          results come back — this tab can run just as long as Pipeline once
          a batch of resumes scores, but only ever had the floating back-to-
          top button on the Pipeline tab. Same component, same behavior
          (stays hidden until scrolled past its own threshold), just no
          longer gated to one tab. */}
      {(tab === "pipeline" || tab === "screen") && <ScrollToTopButton />}
    </div>
  );
}
