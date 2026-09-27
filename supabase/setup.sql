-- =====================================================================
-- SadakYatra Website — Database setup (Supabase)
-- Kaise chalana hai: Supabase Dashboard → SQL Editor → New query →
-- ye poori file paste karo → Run. Sirf EK BAAR chalana hai.
-- =====================================================================

-- 1) Admin users — sirf inhi logon ko admin panel mein edit ki permission
create table if not exists public.web_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- Check: kya abhi login wala user admin hai?
create or replace function public.web_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.web_admins where user_id = auth.uid());
$$;

-- 2) Fare rates — per km rate, multiplier, minimum fare etc.
create table if not exists public.web_fare_rates (
  key text primary key,
  label text not null,
  value numeric not null check (value >= 0),
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- 3) Routes — kahan se kahan, kitne km
create table if not exists public.web_fare_routes (
  id bigint generated always as identity primary key,
  from_city text not null,
  to_city text not null,
  distance_km int not null check (distance_km > 0 and distance_km < 3000),
  active boolean not null default true,
  verified boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (from_city, to_city)
);

-- updated_at apne aap update ho
create or replace function public.web_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists web_fare_rates_touch on public.web_fare_rates;
create trigger web_fare_rates_touch before update on public.web_fare_rates
  for each row execute function public.web_touch_updated_at();

drop trigger if exists web_fare_routes_touch on public.web_fare_routes;
create trigger web_fare_routes_touch before update on public.web_fare_routes
  for each row execute function public.web_touch_updated_at();

-- 4) Security (Row Level Security)
--    Website: sirf PADH sakti hai. Admin: padh + badal sakta hai.
alter table public.web_admins      enable row level security;
alter table public.web_fare_rates  enable row level security;
alter table public.web_fare_routes enable row level security;

drop policy if exists "admins see own row" on public.web_admins;
create policy "admins see own row" on public.web_admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "public read rates" on public.web_fare_rates;
create policy "public read rates" on public.web_fare_rates
  for select to anon, authenticated using (true);

drop policy if exists "admin write rates" on public.web_fare_rates;
create policy "admin write rates" on public.web_fare_rates
  for all to authenticated using (public.web_is_admin()) with check (public.web_is_admin());

drop policy if exists "public read active routes" on public.web_fare_routes;
create policy "public read active routes" on public.web_fare_routes
  for select to anon using (active);

drop policy if exists "admin read all routes" on public.web_fare_routes;
create policy "admin read all routes" on public.web_fare_routes
  for select to authenticated using (active or public.web_is_admin());

drop policy if exists "admin write routes" on public.web_fare_routes;
create policy "admin write routes" on public.web_fare_routes
  for all to authenticated using (public.web_is_admin()) with check (public.web_is_admin());

-- 5) Shuruaati data (Google Sheet se, 26 Sep 2026)
insert into public.web_fare_rates (key, label, value, sort) values
  ('sedanPerKm',          'Sedan — per km (₹)',            23,   1),
  ('suvPerKm',            'SUV — per km (₹)',              27,   2),
  ('roundTripMultiplier', 'Round trip multiplier (×)',     1.75, 3),
  ('localSedanFare',      'Local ride — Sedan (₹)',        1500, 4),
  ('localSuvFare',        'Local ride — SUV (₹)',          2000, 5),
  ('minimumFare',         'Minimum fare (₹)',              1500, 6)
on conflict (key) do nothing;

-- Sirf Muzaffarpur wali routes. Distances abhi "verified = false" hain —
-- admin panel mein check karke tick karna.
insert into public.web_fare_routes (from_city, to_city, distance_km) values
  ('Muzaffarpur', 'Hajipur (Vaishali)', 35),
  ('Muzaffarpur', 'Sheohar', 55),
  ('Muzaffarpur', 'Samastipur', 55),
  ('Muzaffarpur', 'Sitamarhi', 65),
  ('Muzaffarpur', 'Darbhanga', 65),
  ('Muzaffarpur', 'Motihari (East Champaran)', 75),
  ('Muzaffarpur', 'Patna', 75),
  ('Muzaffarpur', 'Chhapra (Saran)', 95),
  ('Muzaffarpur', 'Madhubani', 110),
  ('Muzaffarpur', 'Begusarai', 115),
  ('Muzaffarpur', 'Arrah (Bhojpur)', 135),
  ('Muzaffarpur', 'Khagaria', 140),
  ('Muzaffarpur', 'Siwan', 145),
  ('Muzaffarpur', 'Bettiah (West Champaran)', 150),
  ('Muzaffarpur', 'Jehanabad', 155),
  ('Muzaffarpur', 'Saharsa', 160),
  ('Muzaffarpur', 'Gopalganj', 165),
  ('Muzaffarpur', 'Lakhisarai', 165),
  ('Muzaffarpur', 'Madhepura', 175),
  ('Muzaffarpur', 'Munger', 180),
  ('Muzaffarpur', 'Sheikhpura', 185),
  ('Muzaffarpur', 'Bihar Sharif (Nalanda)', 190),
  ('Muzaffarpur', 'Supaul', 190),
  ('Muzaffarpur', 'Gaya', 205),
  ('Muzaffarpur', 'Buxar', 210),
  ('Muzaffarpur', 'Nawada', 220),
  ('Muzaffarpur', 'Sasaram (Rohtas)', 220),
  ('Muzaffarpur', 'Bhagalpur', 225),
  ('Muzaffarpur', 'Aurangabad', 230),
  ('Muzaffarpur', 'Jamui', 230),
  ('Muzaffarpur', 'Purnia', 245),
  ('Muzaffarpur', 'Banka', 250),
  ('Muzaffarpur', 'Bhabua (Kaimur)', 250),
  ('Muzaffarpur', 'Araria', 255),
  ('Muzaffarpur', 'Katihar', 275),
  ('Muzaffarpur', 'Kishanganj', 320),
  ('Muzaffarpur', 'Raxaul', 140),
  ('Muzaffarpur', 'Patna Airport', 80),
  ('Muzaffarpur', 'Darbhanga Airport', 68)
on conflict (from_city, to_city) do nothing;

-- =====================================================================
-- 6) KHUD KO ADMIN BANAO (upar wala Run karne ke BAAD, alag se):
--    a) Supabase → Authentication → Users → "Add user" → apna email + password
--       ("Auto Confirm User" tick karna)
--    b) Neeche wali line mein apna email daal ke Run karo:
--
-- insert into public.web_admins (user_id, email)
-- select id, email from auth.users where email = 'APNA-EMAIL@gmail.com';
-- =====================================================================
