import { describe, expect, it } from "vitest";
import type { ConfigParams } from "@brighten/config";
import type { Kline, MarketSnapshot } from "../../types/index.js";
import { evaluateFxRegime } from "./fx-regime.js";

const params: ConfigParams = {
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
  fx_swing_lookback: 3,
  fx_sweep_min_penetration: "0.125",
  fx_min_data_points: 4,
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
};

function kline(openTime: number, high: string, low: string, close: string, open = close): Kline {
  return {
    openTime,
    open,
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

function snapshot(klines: readonly Kline[]): MarketSnapshot {
  return {
    pair: "EURUSD",
    timeframe: "1m",
    atEpochMillis: 1_700_000_000_000,
    klines,
    warnings: []
  };
}

const swingWindow = [
  kline(1, "1.1050", "1.1010", "1.1030"),
  kline(3, "1.1080", "1.1000", "1.1040"),
  kline(5, "1.1060", "1.1020", "1.1050")
] as const;

describe("evaluateFxRegime", () => {
  it("detects a high liquidity sweep and returns a short direction with signal snapshot", () => {
    expect(evaluateFxRegime({ snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075")]), params })).toEqual({
      ok: true,
      direction: "short",
      signals: {
        swingHigh: "1.108",
        swingLow: "1.1",
        range: "0.008",
        highPenetration: "0.125",
        lowPenetration: "-0.375",
        sweepSide: "high"
      }
    });
  });

  it("detects a low liquidity sweep and returns a long direction", () => {
    expect(evaluateFxRegime({ snapshot: snapshot([...swingWindow, kline(7, "1.1050", "1.0990", "1.1005")]), params })).toMatchObject({
      ok: true,
      direction: "long",
      signals: {
        sweepSide: "low",
        lowPenetration: "0.125"
      }
    });
  });

  it("requires penetration at or above the configured threshold", () => {
    const boundary = evaluateFxRegime({
      snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075")]),
      params
    });
    const below = evaluateFxRegime({
      snapshot: snapshot([...swingWindow, kline(7, "1.1089", "1.1030", "1.1075")]),
      params
    });

    expect(boundary).toMatchObject({ ok: true, direction: "short" });
    expect(below).toMatchObject({
      ok: false,
      error: {
        code: "no_liquidity_sweep",
        source: "tier1.fx_regime"
      }
    });
  });

  it("does not treat breakout closes outside the swing extreme as reversal sweeps", () => {
    expect(
      evaluateFxRegime({
        snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1095")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "no_liquidity_sweep",
        source: "tier1.fx_regime"
      }
    });
  });

  it("rejects when the candidate sweeps both sides", () => {
    expect(
      evaluateFxRegime({
        snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.0990", "1.1040")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "conflicting_signals",
        source: "tier1.fx_regime"
      }
    });
  });

  it("rejects insufficient kline data and zero swing range before sweep checks", () => {
    expect(evaluateFxRegime({ snapshot: snapshot(swingWindow), params })).toMatchObject({
      ok: false,
      error: {
        code: "insufficient_data",
        source: "tier1.fx_regime"
      }
    });

    expect(
      evaluateFxRegime({
        snapshot: snapshot([
          kline(1, "1.1000", "1.1000", "1.1000"),
          kline(3, "1.1000", "1.1000", "1.1000"),
          kline(5, "1.1000", "1.1000", "1.1000"),
          kline(7, "1.1010", "1.0990", "1.1000")
        ]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "insufficient_data",
        source: "tier1.fx_regime"
      }
    });
  });

  it("rejects invalid price decimal strings and invalid FX config", () => {
    expect(
      evaluateFxRegime({
        snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075", "x")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier1.fx_regime",
        context: {
          field: "open"
        }
      }
    });

    expect(
      evaluateFxRegime({
        snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075")]),
        params: { ...params, fx_swing_lookback: 0 }
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_tier1_param",
        source: "tier1.fx_regime",
        context: {
          field: "fx_swing_lookback"
        }
      }
    });
  });

  it("does not depend on news blackout config", () => {
    const input = snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075")]);
    const withoutNews = evaluateFxRegime({ snapshot: input, params });
    const withNews = evaluateFxRegime({
      snapshot: input,
      params: {
        ...params,
        news_blackout: [{ startsAt: 1_699_999_999_999, endsAt: 1_700_000_000_001, pairs: ["EURUSD"] }]
      }
    });

    expect(withNews).toEqual(withoutNews);
  });

  it("is deterministic, does not mutate input, and keeps signal prices as strings", () => {
    const input = { snapshot: snapshot([...swingWindow, kline(7, "1.1090", "1.1030", "1.1075")]), params };
    const before = structuredClone(input);

    const first = evaluateFxRegime(input);
    const second = evaluateFxRegime(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(typeof first.signals.swingHigh).toBe("string");
      expect(typeof first.signals.swingLow).toBe("string");
      expect(typeof first.signals.range).toBe("string");
      expect(typeof first.signals.highPenetration).toBe("string");
      expect(typeof first.signals.lowPenetration).toBe("string");
    }
  });
});
