-- Idle media assets for kiosk and idle pages
create table if not exists public.idle_media (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  mime_type text,
  file_size_bytes bigint,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.idle_media enable row level security;

drop policy if exists "Idle media is publicly readable" on public.idle_media;
create policy "Idle media is publicly readable"
  on public.idle_media
  for select
  using (true);
