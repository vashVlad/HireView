import { NextRequest, NextResponse } from "next/server";
import { getSessionSupabaseClient } from "@/lib/supabase-server";

/**
 * Required by Supabase Auth for the email confirmation / magic-link flow.
 * Exchanges the one-time code for a session and redirects to the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type"); // "invite" | "recovery" | etc.
  const next = searchParams.get("next") ?? "/projects";

  if (code) {
    const supabase = await getSessionSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Invited users land on /projects — admin sets a temp password at invite time.
      // They can change it later via Settings → Change password.
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
