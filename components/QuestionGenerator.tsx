"use client";

import { useState } from "react";

export function QuestionGenerator({ screeningId }: { screeningId: number }) {
  const [experience, setExperience] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!experience.trim() || loading) return;
    setLoading(true);
    setQuestion(null);
    try {
      const res = await fetch("/api/generate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screeningId, experience: experience.trim() }),
      });
      const data = await res.json();
      setQuestion(data.question ?? null);
    } catch {
      setQuestion("Could not generate a question — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex gap-2">
        <input
          type="text"
          value={experience}
          onChange={(e) => {
            setExperience(e.target.value);
            setQuestion(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="e.g. their role at Salesforce, the Python work, leading the data team"
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-500"
        />
        <button
          type="button"
          onClick={generate}
          disabled={!experience.trim() || loading}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-40 dark:bg-violet-500 dark:hover:bg-violet-600"
        >
          {loading ? "…" : "Generate"}
        </button>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: question ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {question && (
            <div className="flex items-start gap-2.5 rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-3 dark:border-violet-500/30 dark:bg-violet-500/10">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="mt-0.5 shrink-0 text-violet-500 dark:text-violet-400"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-sm leading-relaxed text-violet-900 dark:text-violet-200">
                {question}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
