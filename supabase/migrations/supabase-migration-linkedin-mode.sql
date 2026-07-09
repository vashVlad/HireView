-- Migration: add linkedin_mode to screenings
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE public.screenings
  ADD COLUMN IF NOT EXISTS linkedin_mode boolean NOT NULL DEFAULT false;
