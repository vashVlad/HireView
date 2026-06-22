import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "JD Analyzer" },
  { href: "/screener", label: "Resume Screener" },
  { href: "/history", label: "History" },
] as const;

export function SiteHeader({ active }: { active: (typeof NAV_ITEMS)[number]["href"] }) {
  return (
    <header className="border-b border-zinc-200/70 dark:border-zinc-800/70">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-md shadow-violet-500/30">
            H
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              HireView
            </h1>
          </div>
        </div>
        <nav className="flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-900">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active === item.href
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
