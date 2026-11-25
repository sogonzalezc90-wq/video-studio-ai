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
