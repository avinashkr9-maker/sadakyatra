-- Admin approval before dispatch, broadcast offers, and push tokens for every user.
-- Run after auth_schema.sql. Safe to re-run.

-- Booking statuses:
--   PENDING_APPROVAL -> (ON_HOLD | REJECTED | APPROVED)
--   APPROVED (searching for a driver) -> CONFIRMED (driver assigned) | DRIVER_NOT_FOUND
--   CONFIRMED -> ONGOING (trip started) -> COMPLETED; CANCELLED from any open state.
-- Driver arriving / arrived is tracked in bookings.driver_status.
alter table public.bookings drop constraint if exists bookings_status_check;
update public.bookings set status = 'PENDING_APPROVAL' where status = 'PENDING';
alter table public.bookings alter column status set default 'PENDING_APPROVAL';
alter table public.bookings add constraint bookings_status_check check (status in (
  'PENDING_APPROVAL','ON_HOLD','REJECTED','APPROVED','DRIVER_NOT_FOUND','CONFIRMED','ONGOING','COMPLETED','CANCELLED'
));

alter table public.bookings add column if not exists status_reason text;
alter table public.bookings add column if not exists approved_by_user_id bigint references public.users(id);
alter table public.bookings add column if not exists approved_at timestamptz;

-- ASSIGNED = placed on a cab by an admin; BOOKING_REJECTED = driver declined an open offer.
alter table public.driver_status_events drop constraint if exists driver_status_events_status_check;
alter table public.driver_status_events add constraint driver_status_events_status_check check (status in (
  'OFFERED','ASSIGNED','BOOKING_ACCEPTED','BOOKING_REJECTED','GOING_TO_PICKUP','ARRIVED','TRIP_STARTED','TRIP_COMPLETED'
));
create index if not exists driver_status_events_driver_idx on public.driver_status_events(driver_id, booking_id);

-- One phone can be signed in to one account; an account can have several phones.
create table if not exists public.user_push_tokens (
  token text primary key,
  user_id bigint not null references public.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists user_push_tokens_user_idx on public.user_push_tokens(user_id);
alter table public.user_push_tokens enable row level security;

-- Carry over tokens registered by the earlier driver-only notifications.
insert into public.user_push_tokens (token, user_id)
select push_token, user_id from public.drivers where push_token is not null and user_id is not null
on conflict (token) do nothing;
