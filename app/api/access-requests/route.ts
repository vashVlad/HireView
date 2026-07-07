import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

/** POST /api/access-requests — public, no auth required */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email: string = body?.email?.trim() ?? "";
  const name: string = body?.name?.trim() ?? "";
  const message: string = body?.message?.trim() ?? "";

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  const { error: dbError } = await supabase.from("access_requests").insert({
    email,
    name: name || null,
    message: message || null,
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
          subject: `New access request from ${name || email}`,
          html: `
            <div style="font-family:sans-serif;max-width:480px">
              <h2 style="color:#7c3aed">New Access Request</h2>
              <p><strong>Email:</strong> ${email}</p>
              ${name ? `<p><strong>Name:</strong> ${name}</p>` : ""}
              ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
              <p style="margin-top:24px">
                <a href="https://hire-view.vercel.app/admin/users" style="background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">
                  Review in HireView →
                </a>
              </p>
            </div>
          `,
        }),
      });
    } catch (err) {
      // Non-fatal — request is already saved to DB
      console.error("Resend email failed:", err);
    }
  }

  return NextResponse.json({ success: true });
}

/** GET /api/access-requests — admin only, returns pending requests */
export async function GET() {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("access_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}
