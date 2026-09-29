-- Volt — Studio copy rotation: one row per premium-design download.
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- WHY A LOG, NOT A COUNTER. The rule this enforces is "the same copy never ships twice on the same
-- design + size + brand". The obvious shape — one JSON document per workspace holding "which copy
-- has been used where" — is a read-modify-write: two people downloading in the same minute each
-- read the old document and the second write silently erases the first. An append-only log cannot
-- lose a download, and it doubles as the audit trail ("who published this, and when").
--
-- copy_hash is computed in the browser from the design's copy fields (url excluded — that's the
-- brand's address, not copy). variant_id is set when the copy came from the rotation library
-- (e.g. 'funding.b.07') and null when someone typed their own or it came from an article autofill.

create extension if not exists "pgcrypto";

create table if not exists public.studio_copy_use (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  brand_key   text not null,                          -- Brand Kit id: 'sme', Serv's id, …
  family      text not null,                          -- 'funding', 'providers', …
  dir         text not null,                          -- 'a' | 'b' | …
  size        text not null,                          -- landscape | square | portrait | story | motion-<size>
  copy_hash   text not null,
  variant_id  text,                                   -- library variant, or null for custom/autofilled copy
  source      text not null default 'single',         -- single | story | carousel | motion
  override    boolean not null default false,         -- owner deliberately re-published a used copy
  regrace     boolean not null default false,         -- same person re-downloaded within the grace hour
  recycled    boolean not null default false,         -- every library copy was used on this size; oldest came back
  user_id     uuid,
  user_email  text,
  created_at  timestamptz not null default now()
);

create index if not exists studio_copy_use_design_idx
  on public.studio_copy_use (org_id, brand_key, family, dir, size, created_at desc);
create index if not exists studio_copy_use_org_idx
  on public.studio_copy_use (org_id, created_at desc);

-- Already ran an earlier version of this file? This adds the one column it was missing.
alter table public.studio_copy_use add column if not exists recycled boolean not null default false;

-- Only the API (service role) reads or writes this table; no browser ever talks to it directly.
alter table public.studio_copy_use enable row level security;
