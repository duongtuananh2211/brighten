-- Story 3.4: Feedback loop — dedup fills + attributions (append-only, AD-8).
-- Idempotent: safe to re-run.

-- 1. Account fills — dedup table for automated probe (idempotent feedback)
create table if not exists public.account_fills (
  fill_id text primary key,
  symbol text not null,
  realized_pnl text not null,
  closed_epoch_millis bigint not null,
  processed_at timestamptz not null default now(),
  raw jsonb
);

-- 2. Trade attributions — user links a fill to a suggestion (append-only)
create table if not exists public.trade_attributions (
  fill_id text primary key,
  suggestion_id uuid not null,
  result text not null check (result in ('win', 'loss')),
  confirmed_at timestamptz not null default now()
);

-- 3. Append-only guard for both tables (AD-8)
drop trigger if exists account_fills_reject_mutation on public.account_fills;
create trigger account_fills_reject_mutation
  before update or delete on public.account_fills
  for each row execute function public.reject_mutation();

drop trigger if exists trade_attributions_reject_mutation on public.trade_attributions;
create trigger trade_attributions_reject_mutation
  before update or delete on public.trade_attributions
  for each row execute function public.reject_mutation();

-- 4. Revoke write from public roles
revoke update, delete on public.account_fills from public;
revoke update, delete on public.trade_attributions from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.trade_attributions from anon;
    grant select on table public.trade_attributions to anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.trade_attributions from authenticated;
    grant select on table public.trade_attributions to authenticated;
  end if;
end
$$;

-- 5. Cron job for feedback probe (separate rhythm from tick, default every 2 min)
do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'brighten-feedback'
  ) then
    perform cron.schedule(
      'brighten-feedback',
      '*/2 * * * *',
      $job$
        select net.http_post(
          url := current_setting('app.settings.feedback_url', true),
          headers := jsonb_build_object(
            'content-type', 'application/json',
            'authorization', 'Bearer ' || current_setting('app.settings.tick_secret', true)
          ),
          body := '{}'::jsonb
        );
      $job$
    );
  end if;
end
$$;
