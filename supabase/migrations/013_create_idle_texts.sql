-- Editable idle-mode text content (announcements and trivia)
create table if not exists public.idle_texts (
  id uuid primary key default gen_random_uuid(),
  text_type text not null check (text_type in ('announcement', 'trivia')),
  title text not null,
  body text not null,
  announcement_type text check (announcement_type in ('info', 'warning', 'event')),
  date_label text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.idle_texts enable row level security;

drop policy if exists "Idle texts are publicly readable" on public.idle_texts;
create policy "Idle texts are publicly readable"
  on public.idle_texts
  for select
  using (true);
