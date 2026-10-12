-- Mobile number + password login. Run after wedding_schema.sql. Safe to re-run.
-- password_hash is "scrypt$<salt>$<hash>"; null means the account has not set a password yet.
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists password_changed_at timestamptz;
