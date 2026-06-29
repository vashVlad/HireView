import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "Resume Screener", badge: null },
  { href: "/jd-analyzer", label: "JD Analyzer", badge: "Beta" },
  { href: "/history", label: "History", badge: null },
  { href: "/tracker", label: "Tracker", badge: null },
] as const;

type NavHref = (typeof NAV_ITEMS)[number]["href"];

export function SiteHeader({ active }: { active: NavHref }) {
  return (
    <header className="border-b border-zinc-200/70 dark:border-zinc-800/70">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-md shadow-violet-500/30">
            H
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            HireView
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
            {NAV_ITEMS.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  {item.label}
                  {item.badge && (
                    <span className="rounded-full bg-violet-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
