"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import type { JDAnalysis, ProjectSummary } from "@/lib/types";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";

interface TeamMember {
  userId: string;
  email: string | null;
}

interface TeamInfo {
  id: number;
  name: string;
  members: TeamMember[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "active" | "closed" | "archived" }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
      {status === "archived" ? "Archived" : "Closed"}
    </span>
  );
}

// ── Project card ───────────────────────────────────────────────────────────

function ProjectCard({ project }: { project: ProjectSummary }) {
  const hasAnalysis = project.jdAnalysis != null;
  return (
    <Link href={`/projects/${project.id}`}
      className="group flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-violet-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-700/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate font-semibold text-zinc-900 transition-colors group-hover:text-violet-600 dark:text-zinc-50 dark:group-hover:text-violet-400">{project.name}</h3>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(project.createdAt)}</p>
        </div>
        <StatusBadge status={project.status} />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{project.screeningCount}</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{project.screeningCount === 1 ? "candidate" : "candidates"} screened</span>
        </div>
        {project.inTrackerCount > 0 && (
          <>
            <div className="h-8 w-px bg-zinc-100 dark:bg-zinc-800" />
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">{project.inTrackerCount}</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">in pipeline</span>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {hasAnalysis ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Filters saved
            </span>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">No filters yet</span>
          )}
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-violet-500 transition-transform group-hover:translate-x-0.5 dark:text-violet-400">
          View
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </Link>
  );
}

// ── New Role modal ─────────────────────────────────────────────────────────

type NewRoleStep = "input" | "analyzing" | "naming" | "saving";

function NewRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [step, setStep] = useState<NewRoleStep>("input");
  const [jd, setJd] = useState("");
  const [analysis, setAnalysis] = useState<JDAnalysis | null>(null);
  const [roleName, setRoleName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function extractFile(file: File) {
    setExtracting(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/extract-jd-text", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to extract text");
      setJd(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setExtracting(false);
      // reset so same file can be re-uploaded
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) extractFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (extracting) return;
    const file = e.dataTransfer.files?.[0];
    if (file) extractFile(file);
  }

  // auto-focus textarea on open
  useEffect(() => { textareaRef.current?.focus(); }, []);

  // auto-focus name input after analysis
  useEffect(() => {
    if (step === "naming") setTimeout(() => nameRef.current?.focus(), 50);
  }, [step]);

  // derive role name from first non-empty JD line
  function deriveRoleName(text: string) {
    return text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  }

  async function handleAnalyze() {
    if (!jd.trim()) return;
    setError(null);
    setStep("analyzing");
    try {
      const res = await fetch("/api/analyze-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: jd }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Analysis failed");
      const data = await res.json();
      setAnalysis(data.analysis);
      setRoleName(deriveRoleName(jd));
      setStep("naming");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("input");
    }
  }

  async function handleSave() {
    if (!roleName.trim() || !analysis) return;
    setStep("saving");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: roleName.trim(), jobDescription: jd, jdAnalysis: analysis }),
      });
      if (!res.ok) throw new Error("Failed to create role");
      const data = await res.json();
      onCreated(data.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("naming");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 flex w-full max-w-xl flex-col gap-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New role</h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {step === "input" && "Paste the job description to get started."}
              {step === "analyzing" && "Analyzing the role..."}
              {step === "naming" && "Analysis complete. Give the role a name."}
              {step === "saving" && "Creating your role..."}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Step: input */}
        {(step === "input" || step === "analyzing") && (
          <div className="flex flex-col gap-4">
            <div
              className="relative"
              onDragOver={(e) => { e.preventDefault(); if (!extracting) setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={handleDrop}
            >
              <textarea ref={textareaRef} value={jd} onChange={(e) => setJd(e.target.value)}
                placeholder="Paste job description here, or drag & drop a PDF/Word/text file..."
                rows={10}
                className={`w-full resize-none rounded-2xl border px-4 py-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/60 dark:focus:bg-zinc-900 ${
                  isDragging
                    ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"
                }`} />
              {isDragging && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-violet-400 bg-violet-50/90 text-sm font-medium text-violet-600 dark:border-violet-500 dark:bg-zinc-900/90 dark:text-violet-400">
                  Drop file to extract text
                </div>
              )}
              {/* File upload */}
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={handleFileUpload} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={extracting}
                title="Upload a PDF, Word, or text file — or drag & drop it onto the box"
                className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 shadow-sm transition-colors hover:border-violet-300 hover:text-violet-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-violet-500 dark:hover:text-violet-400"
              >
                {extracting ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-violet-500" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
                {extracting ? "Reading…" : "Upload file"}
              </button>
            </div>
            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
            <button type="button" onClick={handleAnalyze}
              disabled={!jd.trim() || step === "analyzing"}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
              {step === "analyzing" ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Analyzing...
                </>
              ) : "Analyze JD"}
            </button>
          </div>
        )}

        {/* Step: naming */}
        {(step === "naming" || step === "saving") && (
          <div className="flex flex-col gap-4">
            {/* Quick analysis preview */}
            {analysis && (
              <div className="flex flex-col gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/80 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 dark:text-violet-400">Must-have skills</span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.mustHaveSkills.slice(0, 6).map((s) => (
                      <span key={s} className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-700/50 dark:bg-violet-500/10 dark:text-violet-300">{s}</span>
                    ))}
                    {analysis.mustHaveSkills.length > 6 && (
                      <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">+{analysis.mustHaveSkills.length - 6} more</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-700/50">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Seniority</span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">{analysis.narrow.seniority.join(", ")}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Experience</span>
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">{analysis.narrow.yearsExperience}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Role name</label>
              <input ref={nameRef} type="text" value={roleName} onChange={(e) => setRoleName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="e.g. Senior Software Engineer"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
            </div>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep("input"); setAnalysis(null); }}
                className="flex-1 rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Back
              </button>
              <button type="button" onClick={handleSave}
                disabled={!roleName.trim() || step === "saving"}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">
                {step === "saving" ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Creating...
                  </>
                ) : "Create role"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team grouping ──────────────────────────────────────────────────────────

/** Groups projects by team, preserving first-seen team order; untagged projects go last under "Unassigned." */
function groupByTeam(items: ProjectSummary[]): { key: string; label: string; items: ProjectSummary[] }[] {
  const groups = new Map<string, { key: string; label: string; items: ProjectSummary[] }>();
  for (const p of items) {
    const key = p.teamId != null ? String(p.teamId) : "unassigned";
    const label = p.teamId != null ? p.teamName ?? `Team ${p.teamId}` : "Unassigned";
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key)!.items.push(p);
  }
  return [...groups.values()];
}

function TeamMemberChips({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1.5">
      {members.map((m) => {
        const label = m.email ?? m.userId;
        return (
          <span
            key={m.userId}
            title={label}
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-white dark:ring-zinc-950 ${avatarColor(label)}`}
          >
            {avatarInitial(label)}
          </span>
        );
      })}
    </span>
  );
}

function TeamGroupedGrid({ items, dimmed, teamsById }: { items: ProjectSummary[]; dimmed?: boolean; teamsById: Map<number, TeamInfo> }) {
  const groups = groupByTeam(items);
  // Single-team view (the common case) skips the header — nothing to disambiguate yet.
  if (groups.length <= 1) {
    return (
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${dimmed ? "opacity-60" : ""}`}>
        {items.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => {
        const teamId = g.key === "unassigned" ? null : Number(g.key);
        const members = teamId != null ? teamsById.get(teamId)?.members ?? [] : [];
        return (
          <div key={g.key} className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {g.label}
                <span className="font-normal normal-case text-zinc-300 dark:text-zinc-600">· {g.items.length}</span>
              </h4>
              <TeamMemberChips members={members} />
            </div>
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${dimmed ? "opacity-60" : ""}`}>
              {g.items.map((p) => <ProjectCard key={p.id} project={p} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [teamsById, setTeamsById] = useState<Map<number, TeamInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showNewRole, setShowNewRole] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/teams").then((r) => r.json()),
    ])
      .then(([projectsData, teamsData]) => {
        setProjects(projectsData.projects ?? []);
        const teams: TeamInfo[] = teamsData.teams ?? [];
        setTeamsById(new Map(teams.map((t) => [t.id, t])));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleRoleCreated(id: number) {
    window.location.href = `/projects/${id}`;
  }

  const active = projects.filter((p) => p.status === "active");
  const archived = projects.filter((p) => p.status !== "active");

  return (
    <div className="flex flex-1 flex-col bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-black">
      <SiteHeader active="/projects" />

      {showNewRole && (
        <NewRoleModal onClose={() => setShowNewRole(false)} onCreated={handleRoleCreated} />
      )}

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-violet-600" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-500/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
                <rect x="2" y="7" width="20" height="14" rx="3" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" strokeLinecap="round" />
                <line x1="12" y1="12" x2="12" y2="16" strokeLinecap="round" />
                <line x1="10" y1="14" x2="14" y2="14" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-zinc-700 dark:text-zinc-200">No roles yet</p>
              <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">Create your first role to get started.</p>
            </div>
            <button type="button" onClick={() => setShowNewRole(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition-all hover:shadow-lg hover:shadow-violet-500/25">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              New role
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Active roles</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{active.length} role{active.length !== 1 ? "s" : ""} in progress</p>
              </div>
              <button type="button" onClick={() => setShowNewRole(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition-all hover:shadow-lg hover:shadow-violet-500/25">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                New role
              </button>
            </div>

            {active.length > 0 && <TeamGroupedGrid items={active} teamsById={teamsById} />}

            {active.length === 0 && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">No active roles. All roles have been archived.</p>
            )}

            {archived.length > 0 && (
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Archived</h3>
                <TeamGroupedGrid items={archived} dimmed teamsById={teamsById} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
