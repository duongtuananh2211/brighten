import { describe, expect, it } from "vitest";
import type { ConfigParams } from "@brighten/config";
import type { Kline, MarketSnapshot } from "../../types/index.js";
import { evaluateEntryZone } from "./entry-zone.js";

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
};

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

function snapshot(klines: readonly Kline[]): MarketSnapshot {
  return {
    pair: "EURUSD",
    timeframe: "1m",
    atEpochMillis: 1_700_000_000_000,
    klines,
    warnings: []
  };
}

const klines = [
  kline(1, "1.1050", "1.1010", "1.1030"),
  kline(3, "1.1080", "1.1000", "1.1040"),
  kline(5, "1.1060", "1.1020", "1.1050"),
  kline(7, "1.1060", "1.1010", "1.1040")
] as const;

describe("evaluateEntryZone", () => {
  it("builds a long candidate from swing structure using decimal strings", () => {
    expect(evaluateEntryZone({ direction: "long", snapshot: snapshot(klines), params })).toEqual({
      ok: true,
      candidate: {
        direction: "long",
        entry: "1.1",
        stop: "1.0992",
        target: "1.108"
      },
      signals: {
        swingHigh: "1.108",
        swingLow: "1.1",
        range: "0.008"
      }
    });
  });

  it("builds a short candidate from the same structure without reversing the requested direction", () => {
    expect(evaluateEntryZone({ direction: "short", snapshot: snapshot(klines), params })).toEqual({
      ok: true,
      candidate: {
        direction: "short",
        entry: "1.108",
        stop: "1.1088",
        target: "1.1"
      },
      signals: {
        swingHigh: "1.108",
        swingLow: "1.1",
        range: "0.008"
      }
    });
  });

  it("waits when the move has already reached target or stop distance is zero", () => {
    expect(
      evaluateEntryZone({
        direction: "long",
        snapshot: snapshot([...klines.slice(0, 3), kline(7, "1.1080", "1.1010", "1.1080")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "no_setup",
        source: "tier2.entry_zone"
      }
    });

    expect(
      evaluateEntryZone({
        direction: "short",
        snapshot: snapshot([...klines.slice(0, 3), kline(7, "1.1060", "1.1000", "1.1000")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "no_setup",
        source: "tier2.entry_zone"
      }
    });

    expect(
      evaluateEntryZone({
        direction: "long",
        snapshot: snapshot(klines),
        params: { ...params, tier2_stop_buffer: "0" }
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "no_setup",
        source: "tier2.entry_zone"
      }
    });
  });

  it("rejects insufficient data and zero-range swing windows", () => {
    expect(evaluateEntryZone({ direction: "long", snapshot: snapshot(klines.slice(0, 3)), params })).toMatchObject({
      ok: false,
      error: {
        code: "insufficient_data",
        source: "tier2.entry_zone"
      }
    });

    expect(
      evaluateEntryZone({
        direction: "long",
        snapshot: snapshot([
          kline(1, "1.1000", "1.1000", "1.1000"),
          kline(3, "1.1000", "1.1000", "1.1000"),
          kline(5, "1.1000", "1.1000", "1.1000"),
          kline(7, "1.1000", "1.1000", "1.1000")
        ]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "insufficient_data",
        source: "tier2.entry_zone"
      }
    });
  });

  it("rejects invalid price decimal strings and invalid tier2 config", () => {
    expect(
      evaluateEntryZone({
        direction: "long",
        snapshot: snapshot([...klines.slice(0, 3), kline(7, "x", "1.1010", "1.1040")]),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier2.entry_zone",
        context: {
          field: "high"
        }
      }
    });

    expect(
      evaluateEntryZone({
        direction: "long",
        snapshot: snapshot(klines),
        params: { ...params, tier2_swing_lookback: 0 }
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_tier2_param",
        source: "tier2.entry_zone",
        context: {
          field: "tier2_swing_lookback"
        }
      }
    });
  });

  it("is deterministic, does not mutate input, and keeps price values as strings", () => {
    const input = { direction: "long" as const, snapshot: snapshot(klines), params };
    const before = structuredClone(input);

    const first = evaluateEntryZone(input);
    const second = evaluateEntryZone(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(typeof first.candidate.entry).toBe("string");
      expect(typeof first.candidate.stop).toBe("string");
      expect(typeof first.candidate.target).toBe("string");
      expect(typeof first.signals.range).toBe("string");
    }
  });
});
