"use client";

import { useEffect, useState } from "react";

/**
 * Bottom-right floating "back to top" button, 2026-07-15 (Vlad's ask) — for
 * the Candidates page and the Pipeline tab, both of which can run to
 * hundreds of cards with no pagination. Only appears once the page has
 * actually scrolled past a screen or so (`threshold`), so it doesn't clutter
 * short lists. Uses `window.scrollTo` because both host pages scroll at the
 * document level, not inside an internal `overflow-y-auto` container (see
 * memory/session-log.md for the one place that pattern doesn't hold — the
 * candidate detail drawer, which is unrelated to this).
 */
export function ScrollToTopButton({ threshold = 480 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > threshold);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      title="Back to top"
      className={`fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/40 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
