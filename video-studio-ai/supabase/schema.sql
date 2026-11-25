-- VIDEO STUDIO AI: tablas y almacenamiento privado
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  asset_type text not null default 'image',
  created_at timestamptz not null default now()
);

-- Migraciones seguras para instalaciones que ya tenían tablas previas.
alter table public.projects
  add column if not exists description text;

-- La app actual guarda el nombre y la descripción; si quedó una columna
-- prompt obligatoria de una versión anterior, no debe bloquear la creación.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'prompt'
  ) then
    alter table public.projects alter column prompt drop not null;
  end if;
end $$;

alter table public.project_assets
  add column if not exists mime_type text;
alter table public.project_assets
  add column if not exists asset_type text not null default 'image';

create index if not exists project_assets_project_created_idx
  on public.project_assets (project_id, created_at desc);

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
      select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()
    )
  );
drop policy if exists "owner deletes own assets" on public.project_assets;
create policy "owner deletes own assets" on public.project_assets
  for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('video-assets', 'video-assets', false)
on conflict (id) do nothing;

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
drop policy if exists "owner deletes own video assets" on storage.objects;
create policy "owner deletes own video assets" on storage.objects
  for delete to authenticated using (
    bucket_id = 'video-assets' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Manifiestos de producción: persistencia privada en la nube.
create table if not exists public.production_manifests (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  target_seconds integer not null check (target_seconds > 0),
  total_segments integer not null check (total_segments > 0),
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_manifests_project_updated_idx
  on public.production_manifests (project_id, updated_at desc);

alter table public.production_manifests enable row level security;
drop policy if exists "owner reads own production manifests" on public.production_manifests;
create policy "owner reads own production manifests" on public.production_manifests
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "owner inserts own production manifests" on public.production_manifests;
create policy "owner inserts own production manifests" on public.production_manifests
  for insert to authenticated with check (
    auth.uid() = user_id and exists (
      select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()
    )
  );
drop policy if exists "owner updates own production manifests" on public.production_manifests;
create policy "owner updates own production manifests" on public.production_manifests
  for update to authenticated using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()
    )
  );
drop policy if exists "owner deletes own production manifests" on public.production_manifests;
create policy "owner deletes own production manifests" on public.production_manifests
  for delete to authenticated using (auth.uid() = user_id);
