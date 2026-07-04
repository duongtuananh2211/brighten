import { describe, expect, it } from "vitest";
import type { ConfigParams } from "@brighten/config";
import type { BehavioralState } from "../../types/index.js";
import type { BehavioralVetoInput } from "./behavioral-veto.js";
import { evaluateBehavioralVeto } from "./behavioral-veto.js";

const nowEpochMillis = 1_700_000_000_000;

const state: BehavioralState = {
  winStreak: 0,
  dailyLoss: "0",
  lastLossEpochMillis: undefined,
  tradeCountToday: 0
};

const params: ConfigParams = {
  cooldown_after_loss: 300_000,
  win_streak_threshold: 3,
  size_dampening: "0.5",
  daily_loss_limit: "100",
  max_trades_per_day: 5,
  max_tunable_params: 5,
  min_rr: "1.5",
  risk_pct: "1",
  cost_hurdle_x: "1",
  overtrade_cost_ratio_limit: "0.3",
  fee_rate: "0.0004",
  spread: "0.0001",
  slippage: "0.0002",
  news_blackout: [],
  trading_day_boundary: "UTC 00:00"
};

const input: BehavioralVetoInput = {
  state,
  params,
  pair: "BTCUSDT",
  nowEpochMillis
};

describe("evaluateBehavioralVeto", () => {
  it("passes when no behavioral rule is active", () => {
    expect(evaluateBehavioralVeto(input)).toEqual({ blocked: false });
  });

  it("blocks during cooldown after a loss and records derived end time", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          lastLossEpochMillis: nowEpochMillis - 1
        }
      })
    ).toEqual({
      blocked: true,
      error: {
        code: "cooldown_active",
        source: "tier0.behavioral",
        context: {
          lastLossEpochMillis: nowEpochMillis - 1,
          cooldownUntilEpochMillis: nowEpochMillis + 299_999,
          nowEpochMillis,
          message: "Cooldown after loss is active"
        }
      }
    });
  });

  it("does not block when cooldown reaches its exact end boundary", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          lastLossEpochMillis: nowEpochMillis - params.cooldown_after_loss
        }
      })
    ).toEqual({ blocked: false });
  });

  it("does not block cooldown when no last loss exists", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          lastLossEpochMillis: undefined
        }
      })
    ).toEqual({ blocked: false });
  });

  it("blocks when daily loss touches the configured limit", () => {
    const result = evaluateBehavioralVeto({
      ...input,
      state: {
        ...state,
        dailyLoss: "100"
      }
    });

    expect(result).toEqual({
      blocked: true,
      error: {
        code: "daily_loss_limit_reached",
        source: "tier0.behavioral",
        context: {
          dailyLoss: "100",
          dailyLossLimit: "100",
          message: "Daily loss limit reached"
        }
      }
    });
  });

  it("does not block daily loss while below the configured limit", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          dailyLoss: "99.99"
        }
      })
    ).toEqual({ blocked: false });
  });

  it("blocks when max trades per day is reached", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          tradeCountToday: 5
        }
      })
    ).toEqual({
      blocked: true,
      error: {
        code: "max_trades_reached",
        source: "tier0.behavioral",
        context: {
          tradeCountToday: 5,
          maxTradesPerDay: 5,
          message: "Max trades per day reached"
        }
      }
    });
  });

  it("does not block when one trade remains", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        state: {
          ...state,
          tradeCountToday: 4
        }
      })
    ).toEqual({ blocked: false });
  });

  it("blocks global news blackout at the inclusive start boundary", () => {
    const result = evaluateBehavioralVeto({
      ...input,
      params: {
        ...params,
        news_blackout: [{ startsAt: nowEpochMillis, endsAt: nowEpochMillis + 60_000, reason: "FOMC" }]
      }
    });

    expect(result).toEqual({
      blocked: true,
      error: {
        code: "news_blackout_active",
        source: "tier0.behavioral",
        context: {
          pair: "BTCUSDT",
          windowStartsAt: nowEpochMillis,
          windowEndsAt: nowEpochMillis + 60_000,
          reason: "FOMC",
          message: "News blackout is active"
        }
      }
    });
  });

  it("does not block news blackout at the exclusive end boundary", () => {
    expect(
      evaluateBehavioralVeto({
        ...input,
        params: {
          ...params,
          news_blackout: [{ startsAt: nowEpochMillis - 60_000, endsAt: nowEpochMillis }]
        }
      })
    ).toEqual({ blocked: false });
  });

  it("applies scoped news blackout only to matching pairs", () => {
    const scopedParams: ConfigParams = {
      ...params,
      news_blackout: [{ startsAt: nowEpochMillis - 1, endsAt: nowEpochMillis + 1, pairs: ["EURUSD"] }]
    };

    expect(evaluateBehavioralVeto({ ...input, params: scopedParams, pair: "BTCUSDT" })).toEqual({
      blocked: false
    });
    expect(evaluateBehavioralVeto({ ...input, params: scopedParams, pair: "EURUSD" })).toMatchObject({
      blocked: true,
      error: {
        code: "news_blackout_active",
        source: "tier0.behavioral"
      }
    });
  });

  it("returns the first matching rule in fixed priority order", () => {
    const result = evaluateBehavioralVeto({
      ...input,
      state: {
        ...state,
        lastLossEpochMillis: nowEpochMillis - 1,
        dailyLoss: "100",
        tradeCountToday: 5
      },
      params: {
        ...params,
        news_blackout: [{ startsAt: nowEpochMillis, endsAt: nowEpochMillis + 1 }]
      }
    });

    expect(result).toMatchObject({
      blocked: true,
      error: {
        code: "cooldown_active",
        source: "tier0.behavioral"
      }
    });
  });

  it.each([
    ["bad daily loss", { state: { ...state, dailyLoss: "wat" } }, "invalid_decimal_string"],
    ["bad daily loss limit", { params: { ...params, daily_loss_limit: "0" } }, "invalid_daily_loss_limit"]
  ])("blocks invalid input: %s", (_name, override, code) => {
    const result = evaluateBehavioralVeto({ ...input, ...override });

    expect(result).toMatchObject({
      blocked: true,
      error: {
        code,
        source: "tier0.behavioral"
      }
    });
  });

  it("is deterministic and does not mutate input", () => {
    const before = structuredClone(input);

    const first = evaluateBehavioralVeto(input);
    const second = evaluateBehavioralVeto(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  it("keeps monetary values as strings in context", () => {
    const result = evaluateBehavioralVeto({
      ...input,
      state: {
        ...state,
        dailyLoss: "100"
      }
    });

    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(typeof result.error.context?.dailyLoss).toBe("string");
      expect(typeof result.error.context?.dailyLossLimit).toBe("string");
    }
  });
});
