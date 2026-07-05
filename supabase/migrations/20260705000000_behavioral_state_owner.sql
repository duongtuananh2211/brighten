-- Story 3.2: Add trading-day-start bookkeeping column + read-only grant for UI (AD-6).
-- Idempotent: safe to re-run.

-- 1. Add the trading-day-start column (bookkeeping for state-owner day-boundary detection)
alter table public.behavioral_state
  add column if not exists trading_day_start_epoch_millis bigint;

-- 2. Read-only grant for the UI role (AD-6: UI & all other components read-only).
-- The `anon` and `authenticated` roles used by apps/web (epic 4) must only SELECT
-- behavioral_state — never insert/update/delete. Cron/feedback drivers use service_role
-- as the sole write-path.
--
-- If the app already has a dedicated read-only role, grants accumulate safely.
do $$
begin
  -- Revoke any overly broad defaults that might have been granted to anon/authenticated
  -- on behavioral_state, then grant only SELECT.
  -- (Safe even if the role doesn't exist yet — Supabase creates anon/authenticated at init.)
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.behavioral_state from anon;
    grant select on table public.behavioral_state to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.behavioral_state from authenticated;
    grant select on table public.behavioral_state to authenticated;
  end if;
end
$$;
