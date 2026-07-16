"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";
import { ThemeToggle } from "./ThemeToggle";
import { Logo } from "./Logo";

const NAV_ITEMS = [
  { href: "/projects", label: "Projects" },
  { href: "/candidates", label: "All Candidates" },
] as const;

const ADMIN_NAV_ITEMS = [
  { href: "/analytics", label: "Analytics" },
  { href: "/funnelview", label: "FunnelView" },
  { href: "/admin/users", label: "Team" },
] as const;

export type NavHref =
  | (typeof NAV_ITEMS)[number]["href"]
  | (typeof ADMIN_NAV_ITEMS)[number]["href"];

export function SiteHeader({ active }: { active: NavHref }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      const admin = user?.app_metadata?.role === "admin";
      setIsAdmin(admin);
      setEmail(user?.email ?? null);

      if (admin) {
        try {
          const res = await fetch("/api/access-requests");
          if (res.ok) {
            const data = await res.json();
            setPendingRequests((data.requests ?? []).length);
          }
        } catch {
          // non-fatal
        }
      }
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSignOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-zinc-200/70 dark:border-zinc-800/70">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/projects" className="flex items-center gap-3">
          <Logo size={36} />
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            HireView
          </h1>
        </Link>
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
                </Link>
              );
            })}

            {isAdmin && (
              <>
                <span className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-700" />
                {ADMIN_NAV_ITEMS.map((item) => {
                  const isActive = active === item.href;
                  const showBadge = item.href === "/admin/users" && pendingRequests > 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                          : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {item.label}
                      {showBadge && (
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                        </span>
                      )}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>
          <ThemeToggle />

          {/* User menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              aria-label="Account menu"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-10 z-50 min-w-[200px] rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {email && (
                  <div className="mb-2 flex items-center gap-2 px-2 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{email}</span>
                  </div>
                )}
                <Link
                  href="/auth/set-password"
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  onClick={() => setMenuOpen(false)}
                >
                  Change password
                </Link>
                <button
                  onClick={handleSignOut}
                  className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
