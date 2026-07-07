-- Migration: access_requests table
-- Run this in Supabase Dashboard → SQL Editor

create table if not exists public.access_requests (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  name        text,
  email       text not null,
  message     text,
  status      text not null default 'pending'   -- 'pending' | 'approved' | 'dismissed'
);

create index if not exists access_requests_status_idx
  on public.access_requests (status);

-- RLS: disable entirely (service role key handles all access via API routes)
alter table public.access_requests disable row level security;
