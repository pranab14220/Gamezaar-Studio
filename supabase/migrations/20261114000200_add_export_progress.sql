-- Real stage-based progress for on-site GAMEZAAR Android exports.
alter table public.export_jobs
  add column if not exists progress_percent integer not null default 0
    check (progress_percent between 0 and 100),
  add column if not exists progress_step text not null default 'Queued';
