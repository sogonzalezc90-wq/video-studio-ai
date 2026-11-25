-- VIDEO STUDIO AI — Supabase production upgrade (complete, additive)
-- Run once in Supabase SQL Editor. Does not delete existing projects or assets.

-- Repair the two legacy project-schema differences used by the current web app.
-- Older installations may have a required projects.prompt column and no description column.
alter table public.projects
  add column if not exists description text;

do $vsa$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='projects'
      and column_name='prompt'
  ) then
    alter table public.projects alter column prompt drop not null;
  end if;
end
$vsa$;

-- Keep existing media rows intact while adding the fields required by the library.
alter table public.project_assets
  add column if not exists mime_type text;
alter table public.project_assets
  add column if not exists asset_type text not null default 'image';

-- VIDEO STUDIO AI: conservative daily admission control for optional Workers AI image/speech calls.
-- This does not change existing assets, projects, jobs, or manifests.
create table if not exists public.vsa_ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  image_count integer not null default 0 check (image_count >= 0),
  speech_count integer not null default 0 check (speech_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.vsa_ai_daily_usage enable row level security;
revoke all on public.vsa_ai_daily_usage from public, anon, authenticated;

create or replace function public.reserve_vsa_ai_quota(p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $vsa$
declare
  reserved_count integer;
begin
  if auth.uid() is null then
    raise exception 'authenticated_user_required' using errcode = '42501';
  end if;

  if p_kind = 'image' then
    insert into public.vsa_ai_daily_usage(user_id, usage_date, image_count)
    values (auth.uid(), (now() at time zone 'utc')::date, 1)
    on conflict (user_id, usage_date) do update
      set image_count = vsa_ai_daily_usage.image_count + 1
      where vsa_ai_daily_usage.image_count < 30
    returning image_count into reserved_count;
  elsif p_kind = 'speech' then
    insert into public.vsa_ai_daily_usage(user_id, usage_date, speech_count)
    values (auth.uid(), (now() at time zone 'utc')::date, 1)
    on conflict (user_id, usage_date) do update
      set speech_count = vsa_ai_daily_usage.speech_count + 1
      where vsa_ai_daily_usage.speech_count < 1
    returning speech_count into reserved_count;
  else
    raise exception 'invalid_quota_kind' using errcode = '22023';
  end if;

  return coalesce(reserved_count, 0);
end;
$vsa$;

revoke all on function public.reserve_vsa_ai_quota(text) from public, anon;
grant execute on function public.reserve_vsa_ai_quota(text) to authenticated;


-- VIDEO STUDIO AI: indexes and private storage MIME support for segment master/reference media.
-- Safe to apply on an existing project; it does not delete or rewrite stored objects.
create index if not exists project_assets_owner_project_created_idx
  on public.project_assets (user_id, project_id, created_at desc);

comment on index public.project_assets_owner_project_created_idx is
  'Efficient owner-scoped retrieval of project reference images, videos and generated segment masters.';

update storage.buckets
set public = false,
    file_size_limit = greatest(coalesce(file_size_limit, 0), 536870912),
    allowed_mime_types = (
      select array_agg(distinct allowed_mime)
      from unnest(
        coalesce(allowed_mime_types, ARRAY[]::text[])
        || ARRAY[
          'image/png',
          'image/jpeg',
          'image/webp',
          'video/mp4',
          'video/webm',
          'video/quicktime'
        ]::text[]
      ) as allowed(allowed_mime)
    )
where id = 'video-assets';

update storage.buckets
set public = false,
    file_size_limit = greatest(coalesce(file_size_limit, 0), 5368709120)
where id = 'video-renders';

-- Repair access rules for existing installations. Having tables present is not
-- sufficient: RLS without owner policies makes the app appear empty and blocks
-- project creation even when authentication succeeds.
alter table public.projects enable row level security;
alter table public.project_assets enable row level security;

drop policy if exists "owner reads own projects" on public.projects;
create policy "owner reads own projects" on public.projects
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owner inserts own projects" on public.projects;
create policy "owner inserts own projects" on public.projects
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "owner updates own projects" on public.projects;
create policy "owner updates own projects" on public.projects
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner deletes own projects" on public.projects;
create policy "owner deletes own projects" on public.projects
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "owner reads own assets" on public.project_assets;
create policy "owner reads own assets" on public.project_assets
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owner inserts own assets" on public.project_assets;
create policy "owner inserts own assets" on public.project_assets
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );
drop policy if exists "owner deletes own assets" on public.project_assets;
create policy "owner deletes own assets" on public.project_assets
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.project_assets to authenticated;

insert into storage.buckets (id, name, public)
values ('video-assets', 'video-assets', false)
on conflict (id) do update set public = false;

drop policy if exists "owner reads own video assets" on storage.objects;
create policy "owner reads own video assets" on storage.objects
  for select to authenticated using (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "owner uploads own video assets" on storage.objects;
create policy "owner uploads own video assets" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "owner updates own video assets" on storage.objects;
create policy "owner updates own video assets" on storage.objects
  for update to authenticated using (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "owner deletes own video assets" on storage.objects;
create policy "owner deletes own video assets" on storage.objects
  for delete to authenticated using (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );


-- Project lifecycle hardening (2026-11-25).
-- Do not expose project or asset metadata to anonymous API clients.
revoke all privileges on table public.projects, public.project_assets from public, anon;
revoke all privileges on table public.projects, public.project_assets from authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, delete on table public.project_assets to authenticated;

-- Keep one owner-scoped delete policy for project assets.
drop policy if exists "Users can delete their own project assets" on public.project_assets;
