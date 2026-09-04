-- Volt — core schema (org, membership, projects, the Brain, billing/usage).
-- Run once in a NEW Supabase project's SQL Editor, BEFORE api_key.sql / ig_queue.sql /
-- fb_queue.sql / tiktok_queue.sql. Safe to re-run (everything is IF NOT EXISTS).
--
-- WHY THIS FILE EXISTS: these nine tables have been live in Volt's own Supabase project for
-- months, created ad hoc as features shipped — there was never a single committed schema for
-- them, only the four narrower sql/*.sql files (api_key, ig_queue, fb_queue, tiktok_queue).
-- Reverse-engineered from every sbWrite/sbRest/db() call across api/*.js and api/_routes/*.js
-- so a brand-new Supabase project (e.g. Vantly's) starts with a working copy instead of 404ing
-- on "relation does not exist" the moment anyone signs in.
--
-- Two real gaps in the code's own comments are fixed HERE, in the fresh copy, without touching
-- whatever Volt's live project has today:
--   1. post_metric's recordMetric() upserts with Prefer: resolution=merge-duplicates but no
--      on_conflict target — PostgREST needs a real unique constraint on (org_id, external_id)
--      for that to actually merge instead of erroring or silently duplicating rows.
--   2. org_secret's instagram.js/tiktok.js both do PATCH-then-INSERT specifically because (per
--      their own comment) "that needs a unique constraint on (org_id, provider) which this table
--      may not have" — given here as the natural composite primary key.

create extension if not exists "pgcrypto";

-- ---- org + membership -------------------------------------------------------------------
create table if not exists public.org (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,          -- the domain key (orgKeyFor) or a fallback label — NOT unique:
                                      -- workspaceInfo() expects duplicates to happen and reports them
  plan       text not null default 'free',   -- free | starter | pro | unlimited — see PLANS in _guard.js
  created_at timestamptz not null default now()
);
create index if not exists org_name_idx on public.org (name, created_at asc);

create table if not exists public.member (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.org(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',  -- 'owner' for the founding user, else 'member'
  created_at timestamptz not null default now()
);
create unique index if not exists member_org_user_idx on public.member (org_id, user_id);
create index if not exists member_user_idx on public.member (user_id);

-- ---- saved projects (brand kits, drafts, looks — everything Studio/Email/Copy/Video save) ----
create table if not exists public.project (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.org(id) on delete cascade,
  type       text not null,           -- 'brandkit' | 'orgsettings' | a tool's own draft type
  title      text not null default '',
  data       jsonb not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_org_type_idx on public.project (org_id, type);

-- ---- the Brain: what got generated, what happened to it, real post performance ----
create table if not exists public.content_item (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.org(id) on delete cascade,
  tool       text,
  brand_id   text,                    -- a brand's id inside project.data.brands[] — not a real FK
  input      jsonb not null default '{}',
  output     jsonb not null default '{}',
  model      text,
  provider   text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists content_item_org_idx on public.content_item (org_id);

create table if not exists public.content_event (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.org(id) on delete cascade,
  content_id uuid references public.content_item(id) on delete set null,  -- nullable: the
                                      -- client_error beacon logs events with no real content item
  event      text not null,          -- 'client_error' is special-cased; otherwise tool-specific
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists content_event_org_idx on public.content_event (org_id);
create index if not exists content_event_org_event_idx on public.content_event (org_id, event, created_at desc);

create table if not exists public.post_metric (
  org_id        uuid not null references public.org(id) on delete cascade,
  platform      text,
  external_id   text not null,       -- the platform's own post id — the natural dedup key
  posted_text   text,
  likes         integer not null default 0,
  comments      integer not null default 0,
  shares        integer not null default 0,
  impressions   integer not null default 0,
  engagement    numeric not null default 0,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  primary key (org_id, external_id)   -- required: recordMetric() upserts with
                                       -- Prefer: resolution=merge-duplicates and no on_conflict
                                       -- param, which only works against a real unique/PK target
);
create index if not exists post_metric_org_engagement_idx on public.post_metric (org_id, engagement desc);

-- ---- billing / metering (built, currently unenforced — see PLANS.free.aiLimit=-1 in _guard.js) ----
create table if not exists public.usage_event (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.org(id) on delete cascade,
  -- NO user_id column on purpose — a real column here once made every insert 400 silently
  -- (PostgREST rejects an unknown column) and usage metering sat at zero for a while unnoticed.
  -- Org-scoped attribution is all billing needs; don't add one without matching code.
  kind       text not null default 'ai',
  units      integer not null default 1,
  tool       text,
  provider   text,
  model      text,
  created_at timestamptz not null default now()
);
create index if not exists usage_event_org_created_idx on public.usage_event (org_id, created_at);

-- Optional fast path for monthUsage() — it calls this RPC first and falls back to a row-scan on
-- any failure (including the function not existing), so this is a performance nicety, not a
-- requirement. Sums this month's units for one org.
create or replace function public.org_month_usage(p_org uuid)
returns bigint
language sql
stable
as $$
  select coalesce(sum(units), 0)
  from public.usage_event
  where org_id = p_org
    and created_at >= date_trunc('month', now());
$$;

-- ---- encrypted per-org provider secrets (Instagram/TikTok tokens, etc.) ----
-- (org_secret, org)-scoped credential storage. instagram.js/tiktok.js both do a manual
-- PATCH-then-INSERT specifically because their own comment says this table "may not have" a
-- unique constraint on (org_id, provider) — given here as the natural composite primary key, so
-- a future refactor can use a real upsert instead of that two-step dance.
create table if not exists public.org_secret (
  org_id     uuid not null references public.org(id) on delete cascade,
  provider   text not null,           -- 'instagram' | 'tiktok' | future providers
  ciphertext text not null,           -- AES-256-GCM, base64 — see encryptSecret()/decryptSecret() in _guard.js
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

-- ---- Volt Brain's computed summary (do-more / do-less / hooks-that-land) ----
-- Deliberately has NO id column — brain.js's own comment: asking PostgREST for one back made the
-- upsert 400. Keyed on (org_id, kind) instead, which is also the on_conflict target its
-- Prefer: resolution=merge-duplicates upsert needs.
create table if not exists public.org_insight (
  org_id      uuid not null references public.org(id) on delete cascade,
  kind        text not null default 'summary',
  data        jsonb not null default '{}',
  window_days integer default 120,
  updated_at  timestamptz not null default now(),
  primary key (org_id, kind)
);

-- ---- RLS: same posture as every other Volt table. Reached only via the service role from
-- serverless functions, with every query explicitly org-scoped in application code (see db() in
-- _guard.js). RLS is enabled anyway with no permissive policy, so none of this is readable by an
-- anon/authenticated key even if one ever leaked to a browser. ----
alter table public.org enable row level security;
alter table public.member enable row level security;
alter table public.project enable row level security;
alter table public.content_item enable row level security;
alter table public.content_event enable row level security;
alter table public.post_metric enable row level security;
alter table public.usage_event enable row level security;
alter table public.org_secret enable row level security;
alter table public.org_insight enable row level security;
