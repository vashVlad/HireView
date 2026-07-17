"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";
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
  // Feedback form — swaps the dropdown menu items for an inline textarea
  // instead of navigating away, so submitting feedback never interrupts
  // whatever the recruiter was doing. Added 2026-07-16.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "sending" | "sent">("idle");
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

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

  // Reset the feedback form whenever the account menu closes, so reopening
  // it always starts from the normal menu items, not mid-draft.
  useEffect(() => {
    if (!menuOpen) {
      setFeedbackOpen(false);
      setFeedbackText("");
      setFeedbackState("idle");
    }
  }, [menuOpen]);

  async function handleSignOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleSendFeedback() {
    const text = feedbackText.trim();
    if (!text || feedbackState === "sending") return;
    setFeedbackState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, page: pathname }),
      });
      if (!res.ok) throw new Error();
      setFeedbackState("sent");
      setFeedbackText("");
      setTimeout(() => {
        setFeedbackState("idle");
        setFeedbackOpen(false);
        setMenuOpen(false);
      }, 1500);
    } catch {
      setFeedbackState("idle");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/85 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/85">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/projects" className="flex items-center gap-3">
          <Logo size={34} />
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            HireView
          </h1>
        </Link>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 rounded-full border border-zinc-200/70 bg-zinc-100/80 p-1 dark:border-zinc-800/60 dark:bg-zinc-900/80">
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

          {/* User menu — colored-initial avatar, same avatarColor()/
              avatarInitial() pattern already used for team chips and the
              Activity timeline, instead of a generic outline icon. A small
              violet corner dot marks admins, same badge style already used
              on the pending-requests indicator below. */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Account menu"
              className={`relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-2 ring-white transition-transform hover:scale-105 dark:ring-zinc-950 ${
                email ? avatarColor(email) : "bg-zinc-400 dark:bg-zinc-600"
              }`}
            >
              {email ? (
                avatarInitial(email)
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              )}
              {isAdmin && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-violet-500 ring-2 ring-white dark:ring-zinc-950">
                  <span className="h-1 w-1 rounded-full bg-white" />
                </span>
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-10 z-50 min-w-[220px] rounded-2xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {email && (
                  <div className="mb-2 flex items-center gap-2 px-2 py-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{email}</span>
                  </div>
                )}

                {feedbackOpen ? (
                  <div className="flex flex-col gap-2 px-2 py-1.5">
                    {feedbackState === "sent" ? (
                      <p className="py-2 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        Thanks — sent!
                      </p>
                    ) : (
                      <>
                        <textarea
                          autoFocus
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          placeholder="Bug, idea, anything..."
                          rows={3}
                          className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:text-zinc-900 focus:ring-2 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/50 dark:focus:bg-zinc-800/50 dark:focus:text-zinc-100"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSendFeedback}
                            disabled={!feedbackText.trim() || feedbackState === "sending"}
                            className="flex-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {feedbackState === "sending" ? "Sending…" : "Send"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setFeedbackOpen(false); setFeedbackText(""); }}
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setFeedbackOpen(true)}
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Send feedback
                    </button>
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
