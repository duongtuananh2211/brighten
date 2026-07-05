import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  InMemoryConfigStore,
  validateParams
} from "./index.js";

describe("config param validation", () => {
  it("accepts the complete default params shape", () => {
    expect(validateParams(DEFAULT_PARAMS)).toEqual({
      ok: true,
      value: DEFAULT_PARAMS
    });
    expect(DEFAULT_PARAMS.overtrade_cost_ratio_limit).toBe("0.3");
    expect(DEFAULT_PARAMS.fee_rate).toBe("0.0004");
    expect(DEFAULT_PARAMS.spread).toBe("0.0001");
    expect(DEFAULT_PARAMS.slippage).toBe("0.0002");
    expect(DEFAULT_PARAMS.max_tunable_params).toBe(5);
    expect(DEFAULT_PARAMS.funding_extreme_threshold).toBe("0.0005");
    expect(DEFAULT_PARAMS.long_short_extreme_ratio).toBe("2");
    expect(DEFAULT_PARAMS.oi_confirmation_min).toBe("0.01");
    expect(DEFAULT_PARAMS.tier1_min_data_points).toBe(2);
    expect(DEFAULT_PARAMS.fx_swing_lookback).toBe(20);
    expect(DEFAULT_PARAMS.fx_sweep_min_penetration).toBe("0.0005");
    expect(DEFAULT_PARAMS.fx_min_data_points).toBe(21);
    expect(DEFAULT_PARAMS.tier2_swing_lookback).toBe(20);
    expect(DEFAULT_PARAMS.tier2_stop_buffer).toBe("0.1");
    expect(DEFAULT_PARAMS.tier2_min_data_points).toBe(21);
    expect(DEFAULT_PARAMS.news_blackout_buffer_before_ms).toBe(1_800_000);
    expect(DEFAULT_PARAMS.news_blackout_buffer_after_ms).toBe(1_800_000);
  });

  it.each([
    ["fee_rate zero is allowed", { fee_rate: "0" }],
    ["spread zero is allowed", { spread: "0" }],
    ["slippage zero is allowed", { slippage: "0" }]
  ])("accepts %s (>= 0, unlike strictly-positive params)", (_, override) => {
    const result = validateParams({ ...DEFAULT_PARAMS, ...override });

    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_PARAMS, ...override }
    });
  });

  it.each([
    ["daily_loss_limit", { daily_loss_limit: "not-decimal" }],
    ["risk_pct", { risk_pct: "0" }],
    ["min_rr", { min_rr: "-1" }],
    ["overtrade_cost_ratio_limit", { overtrade_cost_ratio_limit: "0" }],
    ["overtrade_cost_ratio_limit", { overtrade_cost_ratio_limit: "not-decimal" }],
    ["fee_rate", { fee_rate: "-0.0001" }],
    ["fee_rate", { fee_rate: "not-decimal" }],
    ["spread", { spread: "-1" }],
    ["slippage", { slippage: "not-decimal" }],
    ["win_streak_threshold", { win_streak_threshold: -1 }],
    ["max_trades_per_day", { max_trades_per_day: -1 }],
    ["max_tunable_params", { max_tunable_params: 0 }],
    ["max_tunable_params", { max_tunable_params: 1.5 }],
    ["funding_extreme_threshold", { funding_extreme_threshold: "-0.1" }],
    ["long_short_extreme_ratio", { long_short_extreme_ratio: "1" }],
    ["long_short_extreme_ratio", { long_short_extreme_ratio: "0.9" }],
    ["oi_confirmation_min", { oi_confirmation_min: "-0.1" }],
    ["tier1_min_data_points", { tier1_min_data_points: 0 }],
    ["fx_swing_lookback", { fx_swing_lookback: 0 }],
    ["fx_sweep_min_penetration", { fx_sweep_min_penetration: "-0.1" }],
    ["fx_min_data_points", { fx_min_data_points: 0 }],
    ["tier2_swing_lookback", { tier2_swing_lookback: 0 }],
    ["tier2_stop_buffer", { tier2_stop_buffer: "-1" }],
    ["tier2_min_data_points", { tier2_min_data_points: 0 }],
    ["news_blackout_buffer_before_ms", { news_blackout_buffer_before_ms: "x" }],
    ["news_blackout_buffer_after_ms", { news_blackout_buffer_after_ms: -1 }],
    ["trading_day_boundary", { trading_day_boundary: "midnight" }]
  ])("rejects invalid %s without creating a version", (_, override) => {
    const store = new InMemoryConfigStore({ now: () => 1_700_000_000_000 });
    const before = store.getLatest();

    const result = store.save({ ...DEFAULT_PARAMS, ...override });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: expect.any(String),
        source: "config.validation",
        context: expect.any(Object)
      });
    }
    expect(store.getLatest()).toBe(before);
  });

  it("requires overtrade_cost_ratio_limit in params", () => {
    const withoutLimit: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutLimit.overtrade_cost_ratio_limit;

    const result = validateParams(withoutLimit);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "overtrade_cost_ratio_limit",
          message: "Config param is required"
        }
      }
    });
  });

  it("requires fee_rate in params", () => {
    const withoutFeeRate: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutFeeRate.fee_rate;

    const result = validateParams(withoutFeeRate);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "fee_rate",
          message: "Config param is required"
        }
      }
    });
  });

  it("requires max_tunable_params in params", () => {
    const withoutMaxTunableParams: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutMaxTunableParams.max_tunable_params;

    const result = validateParams(withoutMaxTunableParams);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "max_tunable_params",
          message: "Config param is required"
        }
      }
    });
  });

  it("requires tier1 crypto params in params", () => {
    const withoutFundingThreshold: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutFundingThreshold.funding_extreme_threshold;

    const result = validateParams(withoutFundingThreshold);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "funding_extreme_threshold",
          message: "Config param is required"
        }
      }
    });
  });

  it.each([
    ["long_short_extreme_ratio", { long_short_extreme_ratio: "1" }, "invalid_tier1_param"],
    ["long_short_extreme_ratio", { long_short_extreme_ratio: "0.9" }, "invalid_tier1_param"],
    ["funding_extreme_threshold", { funding_extreme_threshold: "-0.1" }, "invalid_non_negative_decimal_string"],
    ["tier1_min_data_points", { tier1_min_data_points: 0 }, "invalid_positive_integer"]
  ])("reports the expected tier1 validation code for %s", (field, override, code) => {
    const result = validateParams({ ...DEFAULT_PARAMS, ...override });

    expect(result).toEqual({
      ok: false,
      error: {
        code,
        source: "config.validation",
        context: {
          field,
          message: expect.any(String)
        }
      }
    });
  });

  it("requires tier1 FX params in params", () => {
    const withoutFxLookback: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutFxLookback.fx_swing_lookback;

    const result = validateParams(withoutFxLookback);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "fx_swing_lookback",
          message: "Config param is required"
        }
      }
    });
  });

  it.each([
    ["fx_swing_lookback", { fx_swing_lookback: 0 }, "invalid_positive_integer"],
    ["fx_sweep_min_penetration", { fx_sweep_min_penetration: "-0.1" }, "invalid_non_negative_decimal_string"],
    ["fx_min_data_points", { fx_min_data_points: 0 }, "invalid_positive_integer"]
  ])("reports the expected tier1 FX validation code for %s", (field, override, code) => {
    const result = validateParams({ ...DEFAULT_PARAMS, ...override });

    expect(result).toEqual({
      ok: false,
      error: {
        code,
        source: "config.validation",
        context: {
          field,
          message: expect.any(String)
        }
      }
    });
  });

  it("requires news blackout buffer params in params", () => {
    const withoutBuffer: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutBuffer.news_blackout_buffer_before_ms;

    const result = validateParams(withoutBuffer);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "news_blackout_buffer_before_ms",
          message: "Config param is required"
        }
      }
    });
  });

  it.each([
    ["news_blackout_buffer_before_ms", { news_blackout_buffer_before_ms: "x" }, "invalid_non_negative_integer"],
    ["news_blackout_buffer_after_ms", { news_blackout_buffer_after_ms: -1 }, "invalid_non_negative_integer"],
    [
      "news_blackout_buffer_after_ms",
      { news_blackout_buffer_before_ms: 0, news_blackout_buffer_after_ms: 0 },
      "invalid_news_blackout_buffer"
    ]
  ])("reports the expected news blackout buffer validation code for %s", (field, override, code) => {
    const result = validateParams({ ...DEFAULT_PARAMS, ...override });

    expect(result).toEqual({
      ok: false,
      error: {
        code,
        source: "config.validation",
        context: {
          field,
          message: expect.any(String)
        }
      }
    });
  });

  it("requires tier2 params in params", () => {
    const withoutTier2Lookback: Record<string, unknown> = { ...DEFAULT_PARAMS };
    delete withoutTier2Lookback.tier2_swing_lookback;

    const result = validateParams(withoutTier2Lookback);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_config_param",
        source: "config.validation",
        context: {
          field: "tier2_swing_lookback",
          message: "Config param is required"
        }
      }
    });
  });

  it.each([
    ["tier2_swing_lookback", { tier2_swing_lookback: 0 }, "invalid_positive_integer"],
    ["tier2_stop_buffer", { tier2_stop_buffer: "-1" }, "invalid_non_negative_decimal_string"],
    ["tier2_min_data_points", { tier2_min_data_points: 0 }, "invalid_positive_integer"]
  ])("reports the expected tier2 validation code for %s", (field, override, code) => {
    const result = validateParams({ ...DEFAULT_PARAMS, ...override });

    expect(result).toEqual({
      ok: false,
      error: {
        code,
        source: "config.validation",
        context: {
          field,
          message: expect.any(String)
        }
      }
    });
  });

  it("accepts news blackout windows scoped to pairs", () => {
    const result = validateParams({
      ...DEFAULT_PARAMS,
      news_blackout: [
        {
          startsAt: 1_700_000_000_000,
          endsAt: 1_700_000_060_000,
          reason: "NFP",
          pairs: ["EURUSD", "GBPUSD"]
        }
      ]
    });

    expect(result).toEqual({
      ok: true,
      value: {
        ...DEFAULT_PARAMS,
        news_blackout: [
          {
            startsAt: 1_700_000_000_000,
            endsAt: 1_700_000_060_000,
            reason: "NFP",
            pairs: ["EURUSD", "GBPUSD"]
          }
        ]
      }
    });
  });

  it("accepts generated news blackout windows in params", () => {
    const windows = [
      {
        startsAt: 1_699_998_200_000,
        endsAt: 1_700_001_800_000,
        reason: "USD CPI",
        pairs: ["EURUSD", "USDJPY"]
      }
    ];

    expect(validateParams({ ...DEFAULT_PARAMS, news_blackout: windows })).toEqual({
      ok: true,
      value: {
        ...DEFAULT_PARAMS,
        news_blackout: windows
      }
    });
  });

  it("rejects invalid news blackout pairs", () => {
    const result = validateParams({
      ...DEFAULT_PARAMS,
      news_blackout: [
        {
          startsAt: 1_700_000_000_000,
          endsAt: 1_700_000_060_000,
          pairs: ["EURUSD", 1]
        }
      ]
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_news_blackout_window_pairs",
        source: "config.validation",
        context: {
          field: "news_blackout",
          message: "Window pairs must be strings",
          index: 0
        }
      }
    });
  });
});
