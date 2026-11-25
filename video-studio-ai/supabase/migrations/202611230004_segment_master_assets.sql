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
