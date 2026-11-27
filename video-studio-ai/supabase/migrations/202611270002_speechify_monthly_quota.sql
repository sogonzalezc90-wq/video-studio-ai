-- VIDEO STUDIO AI: monthly hard stop for Speechify Free TTS.
-- Speechify Free includes 500,000 characters/month; the app reserves only up to 450,000.
create table if not exists public.vsa_speechify_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  characters integer not null default 0 check (characters >= 0),
  primary key (user_id, usage_month)
);

alter table public.vsa_speechify_monthly_usage enable row level security;
revoke all on public.vsa_speechify_monthly_usage from public, anon, authenticated;

create or replace function public.reserve_vsa_speechify_characters(p_characters integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $vsa$
declare
  month_start date := date_trunc('month', timezone('utc', now()))::date;
  reserved_total integer;
begin
  if auth.uid() is null then
    raise exception 'authenticated_user_required' using errcode = '42501';
  end if;
  if p_characters is null or p_characters < 1 or p_characters > 21000 then
    raise exception 'invalid_character_reservation' using errcode = '22023';
  end if;

  insert into public.vsa_speechify_monthly_usage(user_id, usage_month, characters)
  values (auth.uid(), month_start, 0)
  on conflict (user_id, usage_month) do nothing;

  update public.vsa_speechify_monthly_usage
  set characters = characters + p_characters
  where user_id = auth.uid()
    and usage_month = month_start
    and characters + p_characters <= 450000
  returning characters into reserved_total;

  return coalesce(reserved_total, 0);
end;
$vsa$;

revoke all on function public.reserve_vsa_speechify_characters(integer) from public, anon;
grant execute on function public.reserve_vsa_speechify_characters(integer) to authenticated;
