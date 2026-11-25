-- VIDEO STUDIO AI: durable queue between Cloudflare Pages and the Kaggle GPU worker.
-- Apply in Supabase SQL Editor before enabling the API routes.
create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid,
  prompt text not null check (char_length(trim(prompt)) >= 30),
  duration_seconds integer not null check (duration_seconds between 15 and 1200),
  segment_seconds integer not null default 30 check (segment_seconds in (15, 30)),
  total_segments integer not null check (total_segments between 1 and 80),
  status text not null default 'queued'
    check (status in ('queued','processing','assembling','cancelling','completed','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  completed_segments integer not null default 0 check (completed_segments between 0 and total_segments),
  payload jsonb not null default '{}'::jsonb,
  output_path text,
  error_message text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the status contract compatible with the current UI, API and Kaggle worker.
alter table public.video_jobs drop constraint if exists video_jobs_status_check;
alter table public.video_jobs add constraint video_jobs_status_check
  check (status in ('queued','processing','assembling','cancelling','completed','failed','cancelled'));

create index if not exists video_jobs_user_created_idx
  on public.video_jobs (user_id, created_at desc);
create index if not exists video_jobs_queue_idx
  on public.video_jobs (status, created_at)
  where status = 'queued';

alter table public.video_jobs enable row level security;

drop policy if exists "Users can read their own video jobs" on public.video_jobs;
create policy "Users can read their own video jobs"
  on public.video_jobs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own video jobs" on public.video_jobs;
create policy "Users can create their own video jobs"
  on public.video_jobs for insert to authenticated
  with check (auth.uid() = user_id);

-- Only the trusted GPU worker (service_role key, stored as a Kaggle secret)
-- may claim queued jobs. Never expose this key to browser code.
create or replace function public.claim_next_video_job()
returns setof public.video_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  -- Reclaim a job abandoned by a disconnected Kaggle session after 15 minutes.
  -- SKIP LOCKED prevents two GPU workers from claiming the same row concurrently.
  return query
  with candidate as (
    select id
    from public.video_jobs
    where attempts < 3
      and (
        status = 'queued'
        or (status = 'processing' and heartbeat_at < now() - interval '15 minutes')
        or (status = 'assembling' and heartbeat_at < now() - interval '15 minutes')
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update public.video_jobs j
     set status = 'processing',
         attempts = attempts + 1,
         claimed_at = now(),
         heartbeat_at = now(),
         updated_at = now(),
         error_message = null
    from candidate
   where j.id = candidate.id
  returning j.*;
end;
$$;

revoke all on function public.claim_next_video_job() from public, anon, authenticated;
grant execute on function public.claim_next_video_job() to service_role;

grant select, insert, delete on public.video_jobs to authenticated;

drop policy if exists "Users can delete their own inactive video jobs" on public.video_jobs;
create policy "Users can delete their own inactive video jobs"
  on public.video_jobs for delete to authenticated
  using (auth.uid() = user_id and status not in ('queued','processing','assembling','cancelling'));
grant all on public.video_jobs to service_role;


-- Private bucket for completed renders. Only the trusted service_role worker uploads.
insert into storage.buckets (id, name, public, file_size_limit)
values ('video-renders', 'video-renders', false, 5368709120)
on conflict (id) do update set public = false;

drop policy if exists "Users can read their own rendered videos" on storage.objects;
create policy "Users can read their own rendered videos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'video-renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Users can delete their own rendered videos" on storage.objects;
create policy "Users can delete their own rendered videos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'video-renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Mark exhausted abandoned jobs as failed rather than leaving them pending forever.
create or replace function public.fail_exhausted_video_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_failed integer;
  changed_cancelled integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  update public.video_jobs
     set status = 'failed',
         error_message = coalesce(error_message, 'El worker se desconectó y se agotaron los reintentos.'),
         updated_at = now()
   where attempts >= 3
     and status in ('processing','assembling')
     and heartbeat_at < now() - interval '15 minutes';
  get diagnostics changed_failed = row_count;

  -- If Kaggle disappeared after a cancellation request, finish that cancellation
  -- after the same stale-worker window instead of leaving the row stuck forever.
  update public.video_jobs
     set status = 'cancelled',
         error_message = coalesce(error_message, 'Cancelación confirmada tras desconexión del worker.'),
         updated_at = now()
   where status = 'cancelling'
     and heartbeat_at < now() - interval '15 minutes';
  get diagnostics changed_cancelled = row_count;

  return changed_failed + changed_cancelled;
end;
$$;
revoke all on function public.fail_exhausted_video_jobs() from public, anon, authenticated;
grant execute on function public.fail_exhausted_video_jobs() to service_role;

-- Owner-scoped cancellation RPC. Queued jobs cancel immediately; active jobs
-- enter "cancelling" so the GPU worker can interrupt safely and acknowledge.
create or replace function public.cancel_video_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $vsa$
declare
  job_owner uuid;
  current_status text;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'authenticated_user_required' using errcode = '42501';
  end if;

  select user_id, status
    into job_owner, current_status
    from public.video_jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception 'video_job_not_found' using errcode = 'P0002';
  end if;
  if job_owner <> auth.uid() then
    raise exception 'video_job_not_owned' using errcode = '42501';
  end if;

  if current_status = 'queued' then
    next_status := 'cancelled';
    update public.video_jobs
       set status = 'cancelled',
           error_message = 'Cancelado por el usuario antes de iniciar.',
           updated_at = now()
     where id = p_job_id;
  elsif current_status in ('processing', 'assembling') then
    next_status := 'cancelling';
    update public.video_jobs
       set status = 'cancelling',
           updated_at = now()
     where id = p_job_id;
  else
    next_status := current_status;
  end if;

  return next_status;
end;
$vsa$;

revoke all on function public.cancel_video_job(uuid) from public, anon;
grant execute on function public.cancel_video_job(uuid) to authenticated;
