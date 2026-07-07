"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "recruiter";
  createdAt: string;
  lastSignIn: string | null;
  confirmed: boolean;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"recruiter" | "admin">("recruiter");
  const [inviteTempPassword, setInviteTempPassword] = useState("HireView2025!");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to load users");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, tempPassword: inviteTempPassword || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setInviteError(data.error ?? "Failed to invite user");
    } else {
      setInviteSuccess(`Account created for ${inviteEmail} — they can sign in with the temporary password right away.`);
      setInviteEmail("");
      setInviteTempPassword("HireView2025!");
      fetchUsers();
    }
    setInviting(false);
  }

  async function handleRoleChange(userId: string, role: "admin" | "recruiter") {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    fetchUsers();
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Remove ${email}? This cannot be undone.`)) return;
    await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    fetchUsers();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/admin/users" />
      <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">User Management</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Invite recruiters and manage access. Admin role required.
        </p>
      </div>

      {/* Invite form */}
      <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Invite a team member
        </h2>
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-3" style={{ minWidth: "220px", flex: 1 }}>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@brillio.com"
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Temporary password</label>
              <input
                type="text"
                value={inviteTempPassword}
                onChange={(e) => setInviteTempPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          </div>
          <div className="flex flex-col justify-between gap-3" style={{ alignSelf: "stretch" }}>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "recruiter" | "admin")}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="recruiter">Recruiter</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>
        </form>
        {inviteError && (
          <p className="mt-2 text-sm text-rose-500">{inviteError}</p>
        )}
        {inviteSuccess && (
          <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{inviteSuccess}</p>
        )}
      </div>

      {/* User table */}
      <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Team members{users.length > 0 && ` (${users.length})`}
          </h2>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-zinc-400">Loading…</div>
        ) : error ? (
          <div className="px-6 py-8 text-center text-sm text-rose-500">{error}</div>
        ) : users.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-zinc-400">No users yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {u.email}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {u.confirmed ? "Active" : "Invite pending"} ·{" "}
                    {u.lastSignIn
                      ? `Last sign-in ${new Date(u.lastSignIn).toLocaleDateString()}`
                      : "Never signed in"}
                  </p>
                </div>
                <select
                  value={u.role}
                  onChange={(e) =>
                    handleRoleChange(u.id, e.target.value as "admin" | "recruiter")
                  }
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <option value="recruiter">Recruiter</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => handleDelete(u.id, u.email ?? "")}
                  className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
    </div>
  );
}
