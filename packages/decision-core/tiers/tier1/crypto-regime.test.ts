import { describe, expect, it } from "vitest";
import type { ConfigParams } from "@brighten/config";
import type { Kline, MarketSnapshot } from "../../types/index.js";
import { evaluateCryptoRegime } from "./crypto-regime.js";

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

const baseKline: Kline = {
  openTime: 1,
  open: "1",
  high: "1",
  low: "1",
  close: "1",
  volume: "10",
  closeTime: 2,
  quoteVolume: "10",
  numberOfTrades: 1,
  takerBuyBaseVolume: "3",
  takerBuyQuoteVolume: "3"
};

type SnapshotOverride = Omit<Partial<MarketSnapshot>, "funding" | "openInterest" | "longShortRatio"> & {
  readonly funding?: MarketSnapshot["funding"] | undefined;
  readonly openInterest?: MarketSnapshot["openInterest"] | undefined;
  readonly longShortRatio?: MarketSnapshot["longShortRatio"] | undefined;
};

function snapshot(override: SnapshotOverride = {}): MarketSnapshot {
  const base: MarketSnapshot = {
    pair: "BTCUSDT",
    timeframe: "1m",
    atEpochMillis: 1_700_000_000_000,
    klines: [baseKline, { ...baseKline, openTime: 3, closeTime: 4, takerBuyBaseVolume: "3" }],
    funding: [
      { fundingTime: 1, fundingRate: "0" },
      { fundingTime: 2, fundingRate: "0.0006" }
    ],
    openInterest: [
      { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "100" },
      { timestamp: 2, sumOpenInterest: "102", sumOpenInterestValue: "102" }
    ],
    longShortRatio: [
      { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
      { timestamp: 2, longShortRatio: "2", longAccount: "0.6667", shortAccount: "0.3333" }
    ],
    warnings: []
  };

  const merged = { ...base, ...override } as MarketSnapshot & {
    funding?: MarketSnapshot["funding"] | undefined;
    openInterest?: MarketSnapshot["openInterest"] | undefined;
    longShortRatio?: MarketSnapshot["longShortRatio"] | undefined;
  };
  if (Object.prototype.hasOwnProperty.call(override, "funding") && override.funding === undefined) {
    delete merged.funding;
  }
  if (Object.prototype.hasOwnProperty.call(override, "openInterest") && override.openInterest === undefined) {
    delete merged.openInterest;
  }
  if (Object.prototype.hasOwnProperty.call(override, "longShortRatio") && override.longShortRatio === undefined) {
    delete merged.longShortRatio;
  }

  return merged;
}

describe("evaluateCryptoRegime", () => {
  it("passes with a short direction when non-neutral votes agree and OI confirms", () => {
    expect(evaluateCryptoRegime({ snapshot: snapshot(), params })).toEqual({
      ok: true,
      direction: "short",
      signals: {
        fundingRate: "0.0006",
        longShortRatio: "2",
        cvd: "-8",
        oiDeltaRatio: "0.02",
        fundingVote: "short",
        longShortVote: "short",
        cvdVote: "short"
      }
    });
  });

  it.each([
    ["funding positive boundary", { funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "0.0005" }] }, "short"],
    ["funding negative boundary", { funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "-0.0005" }] }, "long"],
    ["long short upper boundary", { longShortRatio: [{ timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" }, { timestamp: 2, longShortRatio: "2", longAccount: "0.6", shortAccount: "0.4" }] }, "short"],
    ["long short lower boundary", { longShortRatio: [{ timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" }, { timestamp: 2, longShortRatio: "0.5", longAccount: "0.3", shortAccount: "0.7" }] }, "long"]
  ] satisfies readonly (readonly [string, Partial<MarketSnapshot>, "long" | "short"])[])(
    "votes at threshold: %s",
    (_name, override, expectedDirection) => {
      const neutralFunding = { funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "0" }] };
      const neutralLongShort = {
        longShortRatio: [
          { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
          { timestamp: 2, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }
        ]
      };
      const neutralCvd = { klines: [baseKline, { ...baseKline, takerBuyBaseVolume: "7" }] };

      const result = evaluateCryptoRegime({
        snapshot: snapshot({ ...neutralFunding, ...neutralLongShort, ...neutralCvd, ...override }),
        params
      });

      expect(result).toMatchObject({
        ok: true,
        direction: expectedDirection
      });
    }
  );

  it("rejects when all votes are neutral", () => {
    const result = evaluateCryptoRegime({
      snapshot: snapshot({
        funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "0.0004" }],
        longShortRatio: [
          { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
          { timestamp: 2, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }
        ],
        klines: [baseKline, { ...baseKline, takerBuyBaseVolume: "7" }]
      }),
      params
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "no_edge_below_threshold",
        source: "tier1.crypto_regime"
      }
    });
  });

  it("rejects conflicting non-neutral votes", () => {
    const result = evaluateCryptoRegime({
      snapshot: snapshot({
        funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "-0.0006" }]
      }),
      params
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "conflicting_signals",
        source: "tier1.crypto_regime"
      }
    });
  });

  it("rejects when direction is clear but OI is flat", () => {
    const result = evaluateCryptoRegime({
      snapshot: snapshot({
        openInterest: [
          { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "100" },
          { timestamp: 2, sumOpenInterest: "100", sumOpenInterestValue: "100" }
        ]
      }),
      params
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "oi_unconfirmed",
        source: "tier1.crypto_regime"
      }
    });
  });

  it("accepts the exact OI confirmation boundary", () => {
    expect(
      evaluateCryptoRegime({
        snapshot: snapshot({
          openInterest: [
            { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "100" },
            { timestamp: 2, sumOpenInterest: "101", sumOpenInterestValue: "101" }
          ]
        }),
        params
      })
    ).toMatchObject({ ok: true, direction: "short" });
  });

  it("rejects missing or undersized series before evaluating signal conflicts", () => {
    const result = evaluateCryptoRegime({
      snapshot: snapshot({
        funding: undefined,
        longShortRatio: [
          { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
          { timestamp: 2, longShortRatio: "0.5", longAccount: "0.3", shortAccount: "0.7" }
        ]
      }),
      params
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "insufficient_data",
        source: "tier1.crypto_regime"
      }
    });
  });

  it("rejects invalid config domain before data checks", () => {
    const result = evaluateCryptoRegime({
      snapshot: snapshot({ funding: undefined }),
      params: { ...params, long_short_extreme_ratio: "1" }
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_tier1_param",
        source: "tier1.crypto_regime",
        context: {
          field: "long_short_extreme_ratio"
        }
      }
    });
  });

  it("rejects invalid signal decimal strings", () => {
    expect(
      evaluateCryptoRegime({
        snapshot: snapshot({ funding: [{ fundingTime: 1, fundingRate: "0" }, { fundingTime: 2, fundingRate: "x" }] }),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier1.crypto_regime"
      }
    });

    expect(
      evaluateCryptoRegime({
        snapshot: snapshot({ klines: [baseKline, { ...baseKline, volume: "x" }] }),
        params
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier1.cvd"
      }
    });
  });

  it("is deterministic, does not mutate input, and keeps signal numbers as strings", () => {
    const input = { snapshot: snapshot(), params };
    const before = structuredClone(input);

    const first = evaluateCryptoRegime(input);
    const second = evaluateCryptoRegime(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(typeof first.signals.fundingRate).toBe("string");
      expect(typeof first.signals.longShortRatio).toBe("string");
      expect(typeof first.signals.cvd).toBe("string");
      expect(typeof first.signals.oiDeltaRatio).toBe("string");
    }
  });
});
