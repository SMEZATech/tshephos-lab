-- Volt — Instagram publishing queue.
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- WHY A TABLE AND NOT A CRON PARAMETER: a scheduled story has to survive the browser being closed,
-- the laptop sleeping and the deploy rolling. The row IS the schedule; api/_routes/instagram.js
-- claims one atomically (PATCH ... WHERE status='pending') before publishing, which is what stops
-- two overlapping drains publishing the same story twice.

create extension if not exists "pgcrypto";

create table if not exists public.ig_queue (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  kind         text not null default 'story',      -- story | post | reel
  image_url    text,
  video_url    text,
  caption      text,
  run_at       timestamptz not null,
  status       text not null default 'pending',    -- pending | publishing | done | error | cancelled
  attempts     integer not null default 0,
  ig_media_id  text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The drain's only query: due + pending, oldest first.
create index if not exists ig_queue_due_idx on public.ig_queue (status, run_at);
-- The Schedule page's queue list.
create index if not exists ig_queue_org_idx on public.ig_queue (org_id, run_at desc);

-- Volt reaches Supabase only through the service role from its own serverless functions, and each
-- query is explicitly scoped by org_id. RLS is enabled anyway with no permissive policy, so if a
-- key is ever exposed to a browser this table is not readable by it.
alter table public.ig_queue enable row level security;

-- Instagram credentials live in org_secret alongside every other org secret, encrypted with
-- SECRETS_MASTER_KEY. The table already exists; this only guarantees one row per provider per org
-- so a re-connect updates instead of quietly stacking a second token.
create unique index if not exists org_secret_org_provider_idx on public.org_secret (org_id, provider);
