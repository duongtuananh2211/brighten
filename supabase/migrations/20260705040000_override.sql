-- Story 3.6: Override grants — append-only evidence of every rule override (AD-8, FR-12).
-- Idempotent: safe to re-run.

-- 1. Override grants table (append-only — immutable evidence)
create table if not exists public.override_grants (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,
  reason text not null,
  typed_confirmation text not null,
  requested_at_epoch_millis bigint not null,
  active_from_epoch_millis bigint not null,
  expires_at_epoch_millis bigint not null,
  created_at timestamptz not null default now()
);

-- 2. Append-only guard (AD-8)
drop trigger if exists override_grants_reject_mutation on public.override_grants;
create trigger override_grants_reject_mutation
  before update or delete on public.override_grants
  for each row execute function public.reject_mutation();

revoke update, delete on public.override_grants from public;

-- 3. Read-only grants for UI (nối AD-6, AD-8)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.override_grants from anon;
    grant select on table public.override_grants to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.override_grants from authenticated;
    grant select on table public.override_grants to authenticated;
  end if;
end
$$;

-- 4. Update config seed with override params
update public.config
set params = params || '{"override_cooldown_ms": 60000, "override_ttl_ms": 300000}'::jsonb
where version = 1 and not (params ? 'override_cooldown_ms');
