import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { TierContext } from "../../pipeline/runner.js";
import type { BehavioralState, Kline, MarketSnapshot } from "../../types/index.js";
import { createTier1, createTier1Crypto, createTier1Fx, createTier1Stub } from "./index.js";

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
    tier2_swing_lookback: 20,
    tier2_stop_buffer: "0.1",
    tier2_min_data_points: 21,
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

const noEdgeSnapshot: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: 1_700_000_000_000,
  klines: [
    baseKline("3"),
    baseKline("7")
  ],
  funding: [
    { fundingTime: 1, fundingRate: "0" },
    { fundingTime: 2, fundingRate: "0" }
  ],
  openInterest: [
    { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "100" },
    { timestamp: 2, sumOpenInterest: "102", sumOpenInterestValue: "102" }
  ],
  longShortRatio: [
    { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
    { timestamp: 2, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }
  ],
  warnings: []
};

const passSnapshot: MarketSnapshot = {
  ...noEdgeSnapshot,
  klines: [baseKline("3"), baseKline("3")],
  funding: [
    { fundingTime: 1, fundingRate: "0" },
    { fundingTime: 2, fundingRate: "0.0006" }
  ],
  longShortRatio: [
    { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
    { timestamp: 2, longShortRatio: "2", longAccount: "0.66", shortAccount: "0.34" }
  ]
};

const fxPassSnapshot: MarketSnapshot = {
  pair: "EURUSD",
  timeframe: "1m",
  atEpochMillis: 1_700_000_000_000,
  klines: [
    fxKline(1, "1.1050", "1.1010", "1.1030"),
    fxKline(3, "1.1080", "1.1000", "1.1040"),
    fxKline(5, "1.1060", "1.1020", "1.1050"),
    fxKline(7, "1.1090", "1.1030", "1.1075")
  ],
  warnings: []
};

const fxNoEdgeSnapshot: MarketSnapshot = {
  ...fxPassSnapshot,
  klines: [
    fxKline(1, "1.1050", "1.1010", "1.1030"),
    fxKline(3, "1.1080", "1.1000", "1.1040"),
    fxKline(5, "1.1060", "1.1020", "1.1050"),
    fxKline(7, "1.1070", "1.1030", "1.1060")
  ]
};

function context(input: MarketSnapshot, configOverride: ConfigSnapshot = config): TierContext {
  return {
    input,
    state,
    config: configOverride,
    nowEpochMillis: 1_700_000_000_000
  };
}

function fxConfig(): ConfigSnapshot {
  return {
    ...config,
    params: {
      ...config.params,
      fx_swing_lookback: 3,
      fx_sweep_min_penetration: "0.125",
      fx_min_data_points: 4
    }
  };
}

function baseKline(takerBuyBaseVolume: string) {
  return {
    openTime: 1,
    open: "1",
    high: "1",
    low: "1",
    close: "1",
    volume: "10",
    closeTime: 2,
    quoteVolume: "10",
    numberOfTrades: 1,
    takerBuyBaseVolume,
    takerBuyQuoteVolume: takerBuyBaseVolume
  };
}

function fxKline(openTime: number, high: string, low: string, close: string): Kline {
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

describe("createTier1Crypto", () => {
  it("passes when crypto regime resolves a direction", () => {
    expect(createTier1Crypto().run(context(passSnapshot))).toEqual({
      kind: "pass",
      enrich: { direction: "short" }
    });
  });

  it("vetoes with formatted reasons when crypto regime has no direction", () => {
    expect(createTier1Crypto().run(context(noEdgeSnapshot))).toEqual({
      kind: "veto",
      tier: "tier1",
      reason: "no_edge_below_threshold: All tier1 crypto votes are neutral"
    });
  });

  it("keeps tier1 stub default pass and explicit veto behavior", () => {
    expect(createTier1Stub().run(context(noEdgeSnapshot))).toEqual({ kind: "pass" });
    expect(createTier1Stub({ vetoReason: "manual block" }).run(context(passSnapshot))).toEqual({
      kind: "veto",
      tier: "tier1",
      reason: "manual block"
    });
  });
});

describe("createTier1Fx", () => {
  it("passes when FX regime resolves a direction", () => {
    expect(createTier1Fx().run(context(fxPassSnapshot, fxConfig()))).toEqual({
      kind: "pass",
      enrich: { direction: "short" }
    });
  });

  it("vetoes with formatted reasons when FX regime has no direction", () => {
    expect(createTier1Fx().run(context(fxNoEdgeSnapshot, fxConfig()))).toEqual({
      kind: "veto",
      tier: "tier1",
      reason: "no_liquidity_sweep: highPenetration -0.125, lowPenetration -0.375"
    });
  });

  it("dispatches crypto and FX by assembly-time asset class", () => {
    const missingFundingSnapshot = { ...passSnapshot } as MarketSnapshot & {
      funding?: MarketSnapshot["funding"] | undefined;
    };
    delete missingFundingSnapshot.funding;

    expect(createTier1("crypto").run(context(missingFundingSnapshot))).toMatchObject({
      kind: "veto",
      tier: "tier1",
      reason: "insufficient_data: requires at least 2 points for each tier1 crypto source"
    });
    expect(createTier1("fx").run(context(fxPassSnapshot, fxConfig()))).toEqual({
      kind: "pass",
      enrich: { direction: "short" }
    });
  });
});
