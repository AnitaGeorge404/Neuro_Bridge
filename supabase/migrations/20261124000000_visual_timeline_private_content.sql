-- User-authored timeline labels are operational content, not adaptive memory.
create table if not exists public.visual_timeline_private_content (
  user_id uuid not null references auth.users(id) on delete cascade,
  timeline_date date not null,
  blocks jsonb not null default '[]'::jsonb,
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, timeline_date)
);

alter table public.visual_timeline_private_content enable row level security;

create policy "Users manage their private timeline content"
  on public.visual_timeline_private_content
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
