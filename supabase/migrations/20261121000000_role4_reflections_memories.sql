-- Add the repository tables that the Role 4 client already reads and writes.
-- This migration is additive and safe to apply to databases where lifecycle
-- persistence migrations have already run.

create table if not exists public.support_reflections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  intervention_id text,
  module_id text,
  reflection_id text,
  timestamp timestamptz,
  version integer not null default 1 check (version = 1),
  reflection_version integer not null default 1 check (reflection_version = 1),
  outcome_summary jsonb,
  insights jsonb not null default '[]'::jsonb,
  summary text not null,
  key_insights text[] not null default '{}',
  follow_up_suggestions text[] not null default '{}',
  confidence jsonb not null default '"low"'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  evidence_outcome_ids text[] not null default '{}',
  privacy text not null default 'private',
  source text not null default 'system_inference',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_memories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  memory_id text,
  module_id text,
  category text,
  type text not null,
  key text not null,
  value jsonb not null,
  evidence_count integer,
  supporting_reflection_ids text[] not null default '{}',
  confidence jsonb not null default '"moderate"'::jsonb,
  confidence_level text,
  first_observed_at timestamptz,
  last_updated_at timestamptz,
  version integer not null default 1 check (version = 1),
  status text not null default 'active',
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  privacy text not null default 'private',
  source text not null default 'system_inference',
  evidence_ids text[] not null default '{}',
  expires_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_reflections_user_id_created_at_idx
  on public.support_reflections (user_id, created_at desc);
create index if not exists support_reflections_user_id_module_id_created_at_idx
  on public.support_reflections (user_id, module_id, created_at desc);
create index if not exists support_memories_user_id_created_at_idx
  on public.support_memories (user_id, created_at desc);
create index if not exists support_memories_user_id_module_id_created_at_idx
  on public.support_memories (user_id, module_id, created_at desc);

alter table public.support_reflections enable row level security;
alter table public.support_memories enable row level security;

grant select, insert, update, delete on public.support_reflections to authenticated;
grant select, insert, update, delete on public.support_memories to authenticated;

drop policy if exists "Users can manage their support reflections" on public.support_reflections;
create policy "Users can manage their support reflections"
  on public.support_reflections for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their support memories" on public.support_memories;
create policy "Users can manage their support memories"
  on public.support_memories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
