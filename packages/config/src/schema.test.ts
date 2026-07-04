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
