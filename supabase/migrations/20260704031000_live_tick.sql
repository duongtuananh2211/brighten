create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.config (
  version integer primary key,
  params jsonb not null,
  created_at timestamptz not null default now()
);

-- Keep this seed synchronized with @brighten/config DEFAULT_PARAMS.
insert into public.config (version, params)
values (
  1,
  '{
    "cooldown_after_loss": 300000,
    "win_streak_threshold": 3,
    "size_dampening": "0.5",
    "daily_loss_limit": "100",
    "max_trades_per_day": 5,
    "max_tunable_params": 5,
    "funding_extreme_threshold": "0.0005",
    "long_short_extreme_ratio": "2",
    "oi_confirmation_min": "0.01",
    "tier1_min_data_points": 2,
    "fx_swing_lookback": 20,
    "fx_sweep_min_penetration": "0.0005",
    "fx_min_data_points": 21,
    "tier2_swing_lookback": 20,
    "tier2_stop_buffer": "0.1",
    "tier2_min_data_points": 21,
    "min_rr": "1.5",
    "risk_pct": "1",
    "cost_hurdle_x": "1",
    "overtrade_cost_ratio_limit": "0.3",
    "fee_rate": "0.0004",
    "spread": "0.0001",
    "slippage": "0.0002",
    "news_blackout_buffer_before_ms": 1800000,
    "news_blackout_buffer_after_ms": 1800000,
    "news_blackout": [],
    "trading_day_boundary": "UTC 00:00"
  }'::jsonb
)
on conflict (version) do nothing;

create table if not exists public.behavioral_state (
  id integer primary key default 1 check (id = 1),
  win_streak integer not null default 0,
  daily_loss text not null default '0',
  last_loss_epoch_millis bigint,
  trade_count_today integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.behavioral_state (id, win_streak, daily_loss, last_loss_epoch_millis, trade_count_today)
values (1, 0, '0', null, 0)
on conflict (id) do nothing;

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'brighten-live-tick'
  ) then
    perform cron.schedule(
      'brighten-live-tick',
      '* * * * *',
      $job$
        select net.http_post(
          url := current_setting('app.settings.tick_url', true),
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
