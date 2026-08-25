import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, teamIdsFilter } from "@/lib/auth";
import { searchCandidatesByText, highlightQueryOverlap } from "@/lib/candidateSearch";
import { getScreeningsByIds } from "@/lib/screenings";
import type { ScreeningRecord } from "@/lib/types";

/**
 * Global talent search, 2026-08-17 (roadmap 2.5.9). POST { query, projectId?
 * } -> ranked candidates. GET is deliberately not supported — a search query
 * can contain arbitrary free text, POST body avoids URL-length/encoding
 * edge cases the rest of this app's GET-with-query-params routes don't have
 * to worry about (their filters are short enums/ids).
 *
 * Team-scoped from the start (teamIdsFilter, same as app/api/history/route.ts)
 * — unlike a couple of routes found missing this check in the 2026-07-16
 * audit (see app/api/screen-resumes/route.ts's own comment on that
 * incident), this is a brand new route, so it's applied from day one rather
 * than needing a later fix.
 *
 * Not live-tested — depends on match_screenings_by_embedding (Postgres
 * function, supabase-migration-candidate-embeddings.sql) and a real
 * VOYAGE_API_KEY, neither of which exist yet outside this code. See
 * lib/candidateSearch.ts's header comment.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const teamIds = await teamIdsFilter(user);
  if (teamIds != null && teamIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const projectId = typeof body?.projectId === "number" ? body.projectId : undefined;

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // Real error handling, 2026-08-25 — this route (already flagged in its
  // own header comment as "not live-tested") had zero try/catch:
  // searchCandidatesByText() and getScreeningsByIds() both throw raw on a
  // Supabase/pgvector error, and given the RPC dependency this route's own
  // comment already calls out as unconfirmed, a failure here is genuinely
  // likely on first real use — without this, it would have surfaced as
  // Next.js's bodyless default 500 instead of a diagnosable message.
  try {
    const matches = await searchCandidatesByText(query, {
      teamIds: teamIds ?? undefined,
      projectId,
      limit: 30,
    });
    if (matches.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const similarityById = new Map(matches.map((m) => [m.screeningId, m.similarity]));
    const records = await getScreeningsByIds(matches.map((m) => m.screeningId));

    // getScreeningsByIds doesn't preserve the RPC's similarity-ranked order
    // (it's an unordered .in() lookup) — re-sort here so the response order
    // actually reflects search relevance, not whatever order the DB happened
    // to return rows in.
    const results = records
      .map((record: ScreeningRecord) => ({
        ...record,
        similarity: similarityById.get(record.id) ?? 0,
        matchedTerms: highlightQueryOverlap(
          query,
          [record.summary, ...(record.strengths ?? []), ...(record.concerns ?? [])].join(" ")
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Candidate search failed:", err);
    return NextResponse.json({ error: "Search failed — see server logs for the real cause" }, { status: 500 });
  }
}
