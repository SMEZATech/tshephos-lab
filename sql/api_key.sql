-- Volt — Personal API keys, for MCP (and any future token-based) access.
-- Run once in Supabase → SQL Editor. Safe to re-run (everything is IF NOT EXISTS).
--
-- WHY THIS EXISTS: every other Volt endpoint authenticates with a Supabase session (a browser
-- sign-in), but an MCP client (Claude Desktop, Claude Code, …) can't do that browser OAuth dance —
-- it just sends a static header on every call. This table lets api/_routes/mcp.js accept a
-- long-lived personal key instead, without weakening the session-based auth every other route
-- still uses. Only the SHA-256 hash is ever stored; the raw key is shown once, at creation, and
-- is not retrievable again — losing it means minting a new one (which revokes the old).
--
-- One active (non-revoked) key per org at a time by CONVENTION — mcp.js revokes the previous key
-- before minting a new one — not a database constraint, since a revoked row stays around as a
-- record of what existed and when it was retired.

create extension if not exists "pgcrypto";

create table if not exists public.api_key (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  user_id       uuid,
  key_hash      text not null,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- The MCP route's only lookup: hash in, row out.
create unique index if not exists api_key_hash_idx on public.api_key (key_hash);
-- The key-management panel's only lookup: this org's most recent key.
create index if not exists api_key_org_idx on public.api_key (org_id, created_at desc);

-- Same posture as every other Volt table: reached only via the service role from serverless
-- functions, with every query explicitly scoped by org_id in application code. RLS is enabled
-- anyway with no permissive policy, so if a key is ever exposed to a browser this table still
-- isn't readable by it.
alter table public.api_key enable row level security;
