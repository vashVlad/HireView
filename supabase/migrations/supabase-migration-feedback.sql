-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: feedback table
-- Run this in Supabase Dashboard → SQL Editor
--
-- Backs the "Send feedback" form in the SiteHeader account dropdown — a
-- lightweight in-app way for recruiters to flag bugs/asks to Vlad without
-- leaving HireView. Mirrors access_requests' shape (see
-- supabase-migration-access-requests.sql): service-role-only table, RLS
-- disabled, all access via the API route, best-effort email notification
-- on submit via Resend.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.feedback (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid,
  email       text,
  message     text not null,
  page        text
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

-- RLS: disable entirely (service role key handles all access via API routes)
alter table public.feedback disable row level security;
