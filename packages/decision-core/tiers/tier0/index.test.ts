import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { TierContext } from "../../pipeline/runner.js";
import type { BehavioralState, MarketSnapshot } from "../../types/index.js";
import { createTier0, createTier0Stub } from "./index.js";

const nowEpochMillis = 1_700_000_000_000;

const input: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: nowEpochMillis,
  klines: [],
  warnings: []
};

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
    min_rr: "1.5",
    risk_pct: "1",
    cost_hurdle_x: "1",
    overtrade_cost_ratio_limit: "0.3",
    fee_rate: "0.0004",
    spread: "0.0001",
    slippage: "0.0002",
    news_blackout: [],
    trading_day_boundary: "UTC 00:00"
  }
};

const context: TierContext = {
  input,
  state,
  config,
  nowEpochMillis
};

describe("createTier0", () => {
  it("passes when behavioral veto is clear", () => {
    expect(createTier0().run(context)).toEqual({ kind: "pass" });
  });

  it("vetoes with a formatted cooldown reason", () => {
    expect(
      createTier0().run({
        ...context,
        state: {
          ...state,
          lastLossEpochMillis: nowEpochMillis - 1
        }
      })
    ).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: `cooldown_active: cooldown until ${nowEpochMillis + 299_999}, now ${nowEpochMillis}`
    });
  });

  it("vetoes with a formatted daily loss reason", () => {
    expect(createTier0().run({ ...context, state: { ...state, dailyLoss: "100" } })).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: "daily_loss_limit_reached: dailyLoss 100 reached limit 100"
    });
  });

  it("vetoes with a formatted max trades reason", () => {
    expect(createTier0().run({ ...context, state: { ...state, tradeCountToday: 5 } })).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: "max_trades_reached: tradeCountToday 5 reached max 5"
    });
  });

  it("vetoes with a formatted news blackout reason", () => {
    expect(
      createTier0().run({
        ...context,
        config: {
          ...config,
          params: {
            ...config.params,
            news_blackout: [{ startsAt: nowEpochMillis, endsAt: nowEpochMillis + 1, reason: "FOMC" }]
          }
        }
      })
    ).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: `news_blackout_active: BTCUSDT blocked until ${nowEpochMillis + 1} (FOMC)`
    });
  });

  it("keeps stub override behavior", () => {
    expect(createTier0Stub({ vetoReason: "manual block" }).run(context)).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: "manual block"
    });
  });
});
