-- Volt — Facebook Page publishing queue.
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- A near-exact mirror of ig_queue.sql. Kept as its OWN table rather than adding a `platform`
-- column to ig_queue: Instagram and Facebook publish through genuinely different Graph endpoints
-- and payload shapes (media container + poll vs. direct feed/photos POST), and a shared table would
-- have needed columns that mean nothing for one platform or the other. Two small, honest tables beat
-- one table with a `platform` column and half its fields always null.

create extension if not exists "pgcrypto";

create table if not exists public.fb_queue (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  kind         text not null default 'post',       -- post (text/link) | photo (image + caption)
  message      text,                                 -- feed text, or the photo's caption
  image_url    text,                                  -- photo posts only
  run_at       timestamptz not null,
  status       text not null default 'pending',      -- pending | publishing | done | error | cancelled
  attempts     integer not null default 0,
  fb_post_id   text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists fb_queue_due_idx on public.fb_queue (status, run_at);
create index if not exists fb_queue_org_idx on public.fb_queue (org_id, run_at desc);

alter table public.fb_queue enable row level security;
