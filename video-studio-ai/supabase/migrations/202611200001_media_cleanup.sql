-- VIDEO STUDIO AI: allow owners to delete their own queue entries and stored media.
-- Run once in Supabase SQL Editor. All operations remain scoped to auth.uid().

grant delete on public.video_jobs to authenticated;
drop policy if exists "Users can delete their own inactive video jobs" on public.video_jobs;
create policy "Users can delete their own inactive video jobs"
  on public.video_jobs for delete to authenticated
  using (
    auth.uid() = user_id
    and status not in ('processing','assembling')
  );

alter table public.project_assets enable row level security;
grant delete on public.project_assets to authenticated;
drop policy if exists "Users can delete their own project assets" on public.project_assets;
create policy "Users can delete their own project assets"
  on public.project_assets for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own video assets" on storage.objects;
create policy "Users can delete their own video assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'video-assets'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "Users can delete their own rendered videos" on storage.objects;
create policy "Users can delete their own rendered videos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'video-renders'
    and split_part(name, '/', 1) = auth.uid()::text
  );


-- Add an explicit cancelling state so the UI does not offer deletion until
-- the Kaggle worker has interrupted Wan 2.2 and acknowledged the stop.
alter table public.video_jobs drop constraint if exists video_jobs_status_check;
alter table public.video_jobs add constraint video_jobs_status_check
  check (status in ('queued','processing','assembling','cancelling','completed','failed','cancelled'));

-- Secure cancellation endpoint: a signed-in owner may cancel only their own job.
-- The GPU worker observes status='cancelled' and interrupts the active ComfyUI task.
create or replace function public.cancel_video_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare current_status text;
begin
  select status into current_status
    from public.video_jobs
   where id = p_job_id and user_id = auth.uid()
   for update;
  if current_status is null then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;
  if current_status = 'queued' then
    update public.video_jobs
       set status = 'cancelled',
           error_message = 'Trabajo cancelado antes de iniciar.',
           updated_at = now()
     where id = p_job_id and user_id = auth.uid();
    return 'cancelled';
  elsif current_status in ('processing','assembling') then
    update public.video_jobs
       set status = 'cancelling',
           error_message = 'Detención solicitada. Esperando confirmación del trabajador Kaggle.',
           updated_at = now()
     where id = p_job_id and user_id = auth.uid();
    return 'cancelling';
  end if;
  return current_status;
end;
$$;
revoke all on function public.cancel_video_job(uuid) from public, anon;
grant execute on function public.cancel_video_job(uuid) to authenticated;
