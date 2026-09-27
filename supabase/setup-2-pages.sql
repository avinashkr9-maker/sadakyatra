-- =====================================================================
-- SadakYatra — Part 2: Pages & Sections (WordPress jaisa editing)
-- Pehle setup.sql chal chuka hona chahiye.
-- Supabase → SQL Editor → New query → ye poori file paste → Run. EK BAAR.
-- =====================================================================

-- 1) Pages — har page ki SEO info + schema/style + scripts
create table if not exists public.web_pages (
  slug text primary key,
  title text not null default '',
  meta jsonb not null default '{}'::jsonb,
  head_html text not null default '',
  script_html text not null default '',
  updated_at timestamptz not null default now()
);

-- 2) Sections — har page ke blocks (hero, FAQ, reviews...), order ke saath
create table if not exists public.web_sections (
  id bigint generated always as identity primary key,
  page_slug text not null references public.web_pages(slug) on delete cascade,
  position int not null default 0,
  label text not null default 'Section',
  html text not null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists web_sections_page_idx on public.web_sections (page_slug, position);

-- 3) Version history — har save se pehle purana version yahan copy hota hai
create table if not exists public.web_section_revisions (
  id bigint generated always as identity primary key,
  section_id bigint not null references public.web_sections(id) on delete cascade,
  label text,
  html text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists web_section_revisions_idx on public.web_section_revisions (section_id, created_at desc);

create or replace function public.web_sections_keep_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.html is distinct from new.html then
    insert into public.web_section_revisions (section_id, label, html) values (old.id, old.label, old.html);
    -- sirf aakhri 20 versions rakho
    delete from public.web_section_revisions
     where section_id = old.id
       and id not in (select id from public.web_section_revisions where section_id = old.id order by created_at desc, id desc limit 20);
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists web_sections_revision on public.web_sections;
create trigger web_sections_revision before update on public.web_sections
  for each row execute function public.web_sections_keep_revision();

drop trigger if exists web_pages_touch on public.web_pages;
create trigger web_pages_touch before update on public.web_pages
  for each row execute function public.web_touch_updated_at();

-- 4) Security
alter table public.web_pages             enable row level security;
alter table public.web_sections          enable row level security;
alter table public.web_section_revisions enable row level security;

drop policy if exists "public read pages" on public.web_pages;
create policy "public read pages" on public.web_pages
  for select to anon, authenticated using (true);
drop policy if exists "admin write pages" on public.web_pages;
create policy "admin write pages" on public.web_pages
  for all to authenticated using (public.web_is_admin()) with check (public.web_is_admin());

drop policy if exists "public read visible sections" on public.web_sections;
create policy "public read visible sections" on public.web_sections
  for select to anon using (not hidden);
drop policy if exists "admin read sections" on public.web_sections;
create policy "admin read sections" on public.web_sections
  for select to authenticated using (not hidden or public.web_is_admin());
drop policy if exists "admin write sections" on public.web_sections;
create policy "admin write sections" on public.web_sections
  for all to authenticated using (public.web_is_admin()) with check (public.web_is_admin());

drop policy if exists "admin revisions" on public.web_section_revisions;
create policy "admin revisions" on public.web_section_revisions
  for all to authenticated using (public.web_is_admin()) with check (public.web_is_admin());

-- 5) Photos ke liye storage (bucket: site-media, public)
insert into storage.buckets (id, name, public)
values ('site-media', 'site-media', true)
on conflict (id) do nothing;

drop policy if exists "site-media public read" on storage.objects;
create policy "site-media public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'site-media');
drop policy if exists "site-media admin upload" on storage.objects;
create policy "site-media admin upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'site-media' and public.web_is_admin());
drop policy if exists "site-media admin update" on storage.objects;
create policy "site-media admin update" on storage.objects
  for update to authenticated using (bucket_id = 'site-media' and public.web_is_admin());
drop policy if exists "site-media admin delete" on storage.objects;
create policy "site-media admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'site-media' and public.web_is_admin());

-- Pages ka data admin panel ke "Pages" tab se ek click mein import hoga.
