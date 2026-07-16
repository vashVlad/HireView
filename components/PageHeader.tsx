import { ReactNode } from "react";

/**
 * Shared page-header block, 2026-07-15 — extracted from the admin/users
 * redesign (Vlad's "make it look more special" pass) so every top-level
 * page renders its title the same way instead of each page hand-rolling
 * its own `<h1>`. Design tokens this locks in: h-11 w-11 rounded-2xl
 * violet->indigo icon tile, text-xl font-bold title, text-sm zinc-500
 * subtitle, mb-8 spacing before page content starts.
 *
 * `icon` takes the inner <path>/<circle> elements only (not a full <svg>)
 * so callers don't have to repeat the width/height/stroke wrapper — each
 * call site just inlines its own icon paths (see any page using this for
 * the pattern); no shared icon set exists yet.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {icon}
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
