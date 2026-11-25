-- VIDEO STUDIO AI: index private project image references for the Kaggle worker.
-- Existing project_assets rows and video-assets storage objects remain unchanged.
-- The worker reads project_assets by project_id + user_id and downloads only image/* files.
create index if not exists project_assets_project_user_mime_idx
  on public.project_assets (project_id, user_id, mime_type);

comment on index public.project_assets_project_user_mime_idx is
  'VIDEO STUDIO AI: accelerates secure lookup of project image references for Kaggle video jobs.';

-- The authenticated owner can read their own image metadata in the library UI/API.
drop policy if exists "Users can read their own project assets" on public.project_assets;
create policy "Users can read their own project assets"
  on public.project_assets for select to authenticated
  using (auth.uid() = user_id);

grant select on public.project_assets to authenticated;
