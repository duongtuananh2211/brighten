import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { TierContext } from "../../pipeline/runner.js";
import type { BehavioralState, Kline, MarketSnapshot } from "../../types/index.js";
import { createTier2, createTier2Stub } from "./index.js";

const state: BehavioralState = {
  winStreak: 0,
  dailyLoss: "0",
  lastLossEpochMillis: undefined,
  tradeCountToday: 0
};

const config: ConfigSnapshot = {
  version: 1,
  params: {
    cooldown_after_loss: 300_000,
    win_streak_threshold: 3,
    size_dampening: "0.5",
    daily_loss_limit: "100",
    max_trades_per_day: 5,
    max_tunable_params: 5,
    funding_extreme_threshold: "0.0005",
    long_short_extreme_ratio: "2",
    oi_confirmation_min: "0.01",
    tier1_min_data_points: 2,
    fx_swing_lookback: 20,
    fx_sweep_min_penetration: "0.0005",
    fx_min_data_points: 21,
    tier2_swing_lookback: 3,
    tier2_stop_buffer: "0.1",
    tier2_min_data_points: 4,
    min_rr: "1.5",
    risk_pct: "1",
    cost_hurdle_x: "1",
    overtrade_cost_ratio_limit: "0.3",
    fee_rate: "0.0004",
    spread: "0.0001",
    slippage: "0.0002",
    news_blackout_buffer_before_ms: 1_800_000,
    news_blackout_buffer_after_ms: 1_800_000,
    news_blackout: [],
    trading_day_boundary: "UTC 00:00", drift_min_samples: 20, drift_window: 50, override_cooldown_ms: 60_000, override_ttl_ms: 300_000
  }
};

const input: MarketSnapshot = {
  pair: "EURUSD",
  timeframe: "1m",
  atEpochMillis: 1_700_000_000_000,
  klines: [
    kline(1, "1.1050", "1.1010", "1.1030"),
    kline(3, "1.1080", "1.1000", "1.1040"),
    kline(5, "1.1060", "1.1020", "1.1050"),
    kline(7, "1.1060", "1.1010", "1.1040")
  ],
  warnings: []
};

function context(override: Partial<TierContext> = {}): TierContext {
  return {
    input,
    state,
    config,
    nowEpochMillis: 1_700_000_000_000,
    ...override
  };
}

function kline(openTime: number, high: string, low: string, close: string): Kline {
  return {
    openTime,
    open: close,
    high,
    low,
    close,
    volume: "10",
    closeTime: openTime + 1,
    quoteVolume: "10",
    numberOfTrades: 1,
    takerBuyBaseVolume: "5",
    takerBuyQuoteVolume: "5"
  };
}

describe("createTier2", () => {
  it("passes with a generated candidate enrichment when direction is present", () => {
    expect(createTier2().run(context({ direction: "long" }))).toEqual({
      kind: "pass",
      enrich: {
        candidate: {
          direction: "long",
          entry: "1.1",
          stop: "1.0992",
          target: "1.108"
        }
      }
    });
  });

  it("vetoes when direction is missing", () => {
    expect(createTier2().run(context())).toEqual({
      kind: "veto",
      tier: "tier2",
      reason: "missing_direction"
    });
  });

  it("vetoes with formatted no_setup and insufficient_data reasons", () => {
    expect(
      createTier2().run(
        context({
          direction: "long",
          input: {
            ...input,
            klines: [
              kline(1, "1.1050", "1.1010", "1.1030"),
              kline(3, "1.1080", "1.1000", "1.1040"),
              kline(5, "1.1060", "1.1020", "1.1050"),
              kline(7, "1.1080", "1.1010", "1.1080")
            ]
          }
        })
      )
    ).toEqual({
      kind: "veto",
      tier: "tier2",
      reason: "no_setup: lastClose 1.108 has reached target 1.108"
    });

    expect(
      createTier2().run(
        context({
          direction: "long",
          input: {
            ...input,
            klines: input.klines.slice(0, 3)
          }
        })
      )
    ).toEqual({
      kind: "veto",
      tier: "tier2",
      reason: "insufficient_data: requires 4 klines, got 3"
    });
  });

  it("keeps tier2 stub default pass and explicit veto behavior", () => {
    expect(createTier2Stub().run(context())).toEqual({ kind: "pass" });
    expect(createTier2Stub({ vetoReason: "manual block" }).run(context())).toEqual({
      kind: "veto",
      tier: "tier2",
      reason: "manual block"
    });
  });
});
