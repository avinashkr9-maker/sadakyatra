-- Online advance (SadakYatra's commission) through Razorpay; the rest is paid to the driver in cash.
-- Run after password_schema.sql. Safe to re-run.

-- AWAITING_PAYMENT: approved by SadakYatra, waiting for the customer's online advance before drivers see it.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (status in (
  'PENDING_APPROVAL','ON_HOLD','REJECTED','AWAITING_PAYMENT','APPROVED','DRIVER_NOT_FOUND','CONFIRMED','ONGOING','COMPLETED','CANCELLED'
));

alter table public.bookings add column if not exists advance_amount double precision;
-- NOT_REQUIRED (cash only) | PENDING | PAID | REFUNDED | REFUND_FAILED
alter table public.bookings add column if not exists advance_status text not null default 'NOT_REQUIRED';
alter table public.bookings add column if not exists razorpay_link_id text;
alter table public.bookings add column if not exists razorpay_link_url text;
alter table public.bookings add column if not exists razorpay_payment_id text;
alter table public.bookings add column if not exists advance_paid_at timestamptz;
create index if not exists bookings_razorpay_link_idx on public.bookings(razorpay_link_id);
