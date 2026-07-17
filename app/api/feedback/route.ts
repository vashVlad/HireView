import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

/**
 * POST /api/feedback — requires a session. Backs the "Send feedback" form
 * in the SiteHeader account dropdown. Saves to the `feedback` table
 * (supabase-migration-feedback.sql) and best-effort emails Vlad via Resend
 * — same non-blocking pattern as /api/access-requests, so an email hiccup
 * never loses the submission itself.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const message: string = body?.message?.trim() ?? "";
  const page: string = body?.page?.trim() ?? "";

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { error: dbError } = await supabase.from("feedback").insert({
    user_id: user.id,
    email: user.email ?? null,
    message,
    page: page || null,
  });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Email notification via Resend (optional — only fires if RESEND_API_KEY is set)
  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "HireView <onboarding@resend.dev>",
          to: ["vladvashchuk2005@gmail.com"],
          subject: `New feedback from ${user.email ?? "a recruiter"}`,
          html: `
            <div style="font-family:sans-serif;max-width:480px">
              <h2 style="color:#7c3aed">New Feedback</h2>
              <p><strong>From:</strong> ${user.email ?? "unknown"}</p>
              ${page ? `<p><strong>Page:</strong> ${page}</p>` : ""}
              <p><strong>Message:</strong> ${message}</p>
            </div>
          `,
        }),
      });
    } catch (err) {
      // Non-fatal — feedback is already saved to DB
      console.error("Resend email failed:", err);
    }
  }

  return NextResponse.json({ success: true });
}
