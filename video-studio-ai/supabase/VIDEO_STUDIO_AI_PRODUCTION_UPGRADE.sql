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
