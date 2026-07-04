import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { TierContext } from "../../pipeline/runner.js";
import type { BehavioralState, MarketSnapshot } from "../../types/index.js";
import { createTier3 } from "./index.js";

const input: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: 1_700_000_000_000
};

const state: BehavioralState = {
  winStreak: 0,
  dailyLoss: "0",
  cooldownUntilEpochMillis: undefined,
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
    min_rr: "1.5",
    risk_pct: "1",
    cost_hurdle_x: "1",
    news_blackout: [],
    trading_day_boundary: "UTC 00:00"
  }
};

const baseContext: TierContext = {
  input,
  state,
  config,
  nowEpochMillis: 1_700_000_000_000
};

describe("createTier3", () => {
  it("passes when candidate is missing", () => {
    expect(createTier3().run(baseContext)).toEqual({ kind: "pass" });
  });

  it("passes when sizing succeeds", () => {
    expect(
      createTier3().run({
        ...baseContext,
        account: { equity: "10000" },
        candidate: {
          direction: "long",
          entry: "100",
          stop: "95",
          target: "115"
        }
      })
    ).toEqual({ kind: "pass" });
  });

  it("vetoes at tier3 when sizing rejects", () => {
    const result = createTier3().run({
      ...baseContext,
      account: { equity: "10000" },
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "101"
      }
    });

    expect(result).toEqual({
      kind: "veto",
      tier: "tier3",
      reason: "rr_below_min: rr 0.2 is below min_rr 1.5"
    });
  });
});
