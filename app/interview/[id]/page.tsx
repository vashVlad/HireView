"use client";

import { use, useEffect, useRef, useState } from "react";

interface InterviewData {
  candidateName: string;
  projectName: string | null;
  notes: string;
}

export default function InterviewNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<InterviewData | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`/api/history/${id}`)
      .then((r) => r.json())
      .then(async (d) => {
        const s = d.screening;
        if (!s) return;
        let projectName: string | null = null;
        if (s.projectId) {
          const pr = await fetch(`/api/projects/${s.projectId}`).then((r) => r.json()).catch(() => null);
          projectName = pr?.project?.name ?? null;
        }
        setData({ candidateName: s.candidateName, projectName, notes: s.notes ?? "" });
        setNotes(s.notes ?? "");
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    fetch(`/api/history/${id}/interview-questions`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []))
      .catch(() => {})
      .finally(() => setQuestionsLoading(false));
  }, [id]);

  function handleNotesChange(value: string) {
    setNotes(value);
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState("saving");
      fetch(`/api/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 800);
  }

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-zinc-950">

      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        {data ? (
          <>
            <p className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
              {data.candidateName}
            </p>
            {data.projectName && (
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{data.projectName}</p>
            )}
          </>
        ) : (
          <div className="h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

        {/* Interview questions */}
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Interview questions
          </p>
          {questionsLoading ? (
            <div className="flex flex-col gap-2.5">
              {[80, 95, 70].map((w, i) => (
                <div key={i} className="flex gap-2.5 items-start">
                  <div className="mt-1 h-3 w-3 shrink-0 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                  <div className="h-3.5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" style={{ width: `${w}%` }} />
                </div>
              ))}
              <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">Generating questions…</p>
            </div>
          ) : questions.length > 0 ? (
            <ol className="flex flex-col gap-3">
              {questions.map((q, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="mt-0.5 w-4 shrink-0 text-[11px] font-bold tabular-nums text-zinc-400 dark:text-zinc-500">
                    {i + 1}.
                  </span>
                  <span className="leading-snug">{q}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">No questions available.</p>
          )}
        </div>

        {/* Notes */}
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Notes
            </p>
            {saveState === "saving" && <span className="text-[11px] text-zinc-400">Saving…</span>}
            {saveState === "saved"  && <span className="text-[11px] text-emerald-500">Saved</span>}
          </div>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder="Type notes during the interview…"
            rows={14}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-900"
          />

          {/* Save & Close */}
          <button
            type="button"
            onClick={() => {
              // If there's a pending debounced save, flush it immediately then close
              if (saveTimer.current) clearTimeout(saveTimer.current);
              fetch(`/api/history/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notes }),
              }).finally(() => window.close());
            }}
            className="mt-3 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Save &amp; Close
          </button>
        </div>

      </div>
    </div>
  );
}
