import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

/** GET /api/admin/users — list all auth users (admin only) */
export async function GET() {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = data.users.map((u) => ({
    id: u.id,
    email: u.email,
    role: (u.app_metadata?.role as string) ?? "recruiter",
    createdAt: u.created_at,
    lastSignIn: u.last_sign_in_at,
    confirmed: !!u.email_confirmed_at,
  }));

  return NextResponse.json({ users });
}

/** POST /api/admin/users — invite a new user by email */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = body?.email?.trim();
  const role: "admin" | "recruiter" = body?.role === "admin" ? "admin" : "recruiter";
  const tempPassword: string | undefined = body?.tempPassword?.trim() || undefined;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!tempPassword || tempPassword.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  // createUser skips the invite email entirely — no rate limits, user is active immediately
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      role,
    },
  });
}

/** PATCH /api/admin/users — update a user's role */
export async function PATCH(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const targetId = body?.userId;
  const role: "admin" | "recruiter" = body?.role === "admin" ? "admin" : "recruiter";

  if (!targetId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.admin.updateUserById(targetId, {
    app_metadata: { role },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/users — remove a user */
export async function DELETE(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const targetId = body?.userId;

  if (!targetId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Prevent self-deletion
  if (targetId === user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.admin.deleteUser(targetId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
