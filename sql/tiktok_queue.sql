-- Volt — TikTok publishing queue.
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- A near-exact mirror of ig_queue.sql / fb_queue.sql — same atomic-claim pattern, same reasoning:
-- the row IS the schedule, and api/_routes/tiktok.js claims one (PATCH ... WHERE status='pending')
-- before publishing so two overlapping drains can't post the same video twice.
--
-- "done" here means TikTok ACCEPTED the video (issued a publish_id), not that it finished
-- processing — TikTok's own pipeline can outlast a single 5-minute drain window. tt_publish_id is
-- kept so a later status check (action=pollstatus) can look it up.

create extension if not exists "pgcrypto";

create table if not exists public.tiktok_queue (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  video_url      text not null,
  caption        text,
  run_at         timestamptz not null,
  status         text not null default 'pending',    -- pending | publishing | done | error | cancelled
  attempts       integer not null default 0,
  tt_publish_id  text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists tiktok_queue_due_idx on public.tiktok_queue (status, run_at);
create index if not exists tiktok_queue_org_idx on public.tiktok_queue (org_id, run_at desc);

alter table public.tiktok_queue enable row level security;
