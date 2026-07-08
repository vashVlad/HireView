"use client";

import { useRef, useState } from "react";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ResumeUploaderProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
}

export function ResumeUploader({ files, onFilesChange }: ResumeUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | File[]) {
    const accepted = Array.from(incoming).filter((file) =>
      /\.(pdf|docx)$/i.test(file.name)
    );
    const existingNames = new Set(files.map((file) => file.name));
    const merged = [...files, ...accepted.filter((file) => !existingNames.has(file.name))];
    onFilesChange(merged);
  }

  function removeFile(name: string) {
    onFilesChange(files.filter((file) => file.name !== name));
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDragging
            ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
            : "border-zinc-200 hover:border-violet-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-violet-600 dark:hover:bg-zinc-900"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-100 text-violet-600 transition-transform group-hover:scale-105 dark:bg-violet-500/10 dark:text-violet-400">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Drop resumes here, or click to browse
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">PDF or Word — drop as many as you like</p>
      </label>

      {files.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            {files.length} resume{files.length !== 1 ? "s" : ""}{" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">queued to screen</span>
          </span>
          <button
            type="button"
            onClick={() => onFilesChange([])}
            className="text-xs text-zinc-400 transition-colors hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400"
          >
            Clear all
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={file.name}
              className="animate-fade-in-up flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {file.name.split(".").pop()}
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    {file.name}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    {formatFileSize(file.size)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeFile(file.name)}
                className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                aria-label={`Remove ${file.name}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
