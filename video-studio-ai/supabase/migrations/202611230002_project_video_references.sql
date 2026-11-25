-- VIDEO STUDIO AI: allow saved project videos to be used as private visual references.
-- Existing project_assets rows and storage objects remain unchanged.
create index if not exists project_assets_project_user_created_idx
  on public.project_assets (project_id, user_id, created_at);

comment on index public.project_assets_project_user_created_idx is
  'VIDEO STUDIO AI: stable chronological retrieval of image and video references for scene continuity.';

update storage.buckets
set allowed_mime_types = (
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
