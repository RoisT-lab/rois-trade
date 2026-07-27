begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-media',
  'profile-media',
  true,
  36700160,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit),
  allowed_mime_types = excluded.allowed_mime_types;

commit;

select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'profile-media';
