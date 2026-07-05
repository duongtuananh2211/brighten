-- Story 3.3: Append-only audit log + immutability guard for suggestions (AD-8).
-- Idempotent: safe to re-run. Each record is immutable evidence — never update/delete.

-- 1. Audit events table (UUID ordered by time — Consistency Conventions)
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  at_epoch_millis bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- 2. Shared rejection trigger function (belt-and-suspenders with revokes below)
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table % is immutable — update/delete rejected', tg_table_name;
end;
$$;

-- 3. Apply reject_mutation trigger to both append-only tables
drop trigger if exists audit_events_reject_mutation on public.audit_events;
create trigger audit_events_reject_mutation
  before update or delete on public.audit_events
  for each row execute function public.reject_mutation();

drop trigger if exists suggestions_reject_mutation on public.suggestions;
create trigger suggestions_reject_mutation
  before update or delete on public.suggestions
  for each row execute function public.reject_mutation();

-- 4. Revoke update/delete from all roles — only insert (and select for read-only roles)
revoke update, delete on public.audit_events from public;
revoke update, delete on public.suggestions from public;

-- If anon/authenticated roles exist (Supabase default), restrict to select only.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- audit_events
    revoke all on table public.audit_events from anon;
    grant select on table public.audit_events to anon;
    -- suggestions (already revoke update/delete above; add explicit select)
    revoke all on table public.suggestions from anon;
    grant select on table public.suggestions to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.audit_events from authenticated;
    grant select on table public.audit_events to authenticated;
    revoke all on table public.suggestions from authenticated;
    grant select on table public.suggestions to authenticated;
  end if;
end
$$;
