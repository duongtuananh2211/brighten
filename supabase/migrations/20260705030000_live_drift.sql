-- Story 3.5: Live-drift baseline + metrics tables (AD-5, AD-8).
-- Idempotent: safe to re-run.

-- 0. Update config seed to include drift params (additive — existing row needs new fields)
update public.config
set params = params || '{"drift_min_samples": 20, "drift_window": 50}'::jsonb
where version = 1 and not (params ? 'drift_min_samples');

-- 1. Drift baseline — single-row reference from backtest validate (AD-4 provenance)
create table if not exists public.drift_baseline (
  id integer primary key default 1 check (id = 1),
  lower text not null,
  median text not null,
  upper text not null,
  source jsonb,
  config_version integer,
  updated_at timestamptz not null default now()
);

-- 2. Drift metrics — append-only time series for Epic 4 (AD-8 immutable history)
create table if not exists public.drift_metrics (
  id uuid primary key default gen_random_uuid(),
  live_expectancy text not null,
  drifting boolean not null default false,
  sample_count integer not null default 0,
  baseline_lower text not null default '0',
  at_epoch_millis bigint not null,
  created_at timestamptz not null default now()
);

-- 3. Append-only guard for drift_metrics (lịch sử drift bất biến)
drop trigger if exists drift_metrics_reject_mutation on public.drift_metrics;
create trigger drift_metrics_reject_mutation
  before update or delete on public.drift_metrics
  for each row execute function public.reject_mutation();

revoke update, delete on public.drift_metrics from public;

-- 4. Read-only grants for UI (nối AD-6, AD-8)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.drift_metrics from anon;
    grant select on table public.drift_metrics to anon;
    revoke all on table public.drift_baseline from anon;
    grant select on table public.drift_baseline to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.drift_metrics from authenticated;
    grant select on table public.drift_metrics to authenticated;
    revoke all on table public.drift_baseline from authenticated;
    grant select on table public.drift_baseline to authenticated;
  end if;
end
$$;
