-- GAMEZAAR Studio: store each creator's complete game configuration for isolated APK builds.
create table if not exists public.game_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  game_type text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_projects_user_updated_idx
  on public.game_projects (user_id, updated_at desc);

alter table public.game_projects enable row level security;

drop policy if exists "Users can read their own game projects" on public.game_projects;
create policy "Users can read their own game projects"
  on public.game_projects for select
  using (auth.uid() = user_id);

-- Project writes are performed by the authenticated Edge Function using
-- the server-side service-role key. Never expose that key in the browser.
create index if not exists export_jobs_project_id_idx
  on public.export_jobs (project_id);
