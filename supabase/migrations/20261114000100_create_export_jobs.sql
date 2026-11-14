-- GAMEZAAR Studio: isolated export-job database foundation
create extension if not exists pgcrypto;

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  status text not null default 'queued'
    check (status in ('queued','building','completed','failed')),
  github_run_id bigint,
  apk_storage_path text,
  aab_storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists export_jobs_user_created_idx
  on public.export_jobs (user_id, created_at desc);

alter table public.export_jobs enable row level security;

drop policy if exists "Users can read their own export jobs" on public.export_jobs;
create policy "Users can read their own export jobs"
  on public.export_jobs for select
  using (auth.uid() = user_id);

-- Inserts and updates are performed only by the authenticated Edge Function
-- using the server-side service-role key. Never expose that key in the browser.

 
-- Private bucket for completed Android exports. Files are accessed only
-- through authenticated server-side signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('gamezaar-exports', 'gamezaar-exports', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = 104857600;
