import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { TierContext } from "../../pipeline/runner.js";
import type { BehavioralState, MarketSnapshot } from "../../types/index.js";
import { evaluateWinStreakDampening } from "../tier0/index.js";
import { createTier3 } from "./index.js";
import { sizeTrade } from "./sizing.js";

const input: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: 1_700_000_000_000,
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
    ).toMatchObject({
      kind: "pass",
      enrich: {
        sizing: {
          direction: "long",
          entry: "100",
          stop: "95",
          target: "115",
          volume: "20",
          riskAmount: "100"
        }
      }
    });
  });

  it("passes when sizing succeeds and expected edge clears the cost hurdle", () => {
    expect(
      createTier3().run({
        ...baseContext,
        expectedEdge: "10",
        cost: { roundTripFee: "5" },
        account: { equity: "10000" },
        candidate: {
          direction: "long",
          entry: "100",
          stop: "95",
          target: "115"
        }
      })
    ).toMatchObject({ kind: "pass", enrich: { sizing: { volume: "20", riskAmount: "100" } } });
  });

  it("vetoes at tier3 when expected edge is below the cost hurdle", () => {
    const result = createTier3().run({
      ...baseContext,
      expectedEdge: "4.99",
      cost: { roundTripFee: "5" },
      account: { equity: "10000" },
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "115"
      }
    });

    expect(result).toEqual({
      kind: "veto",
      tier: "tier3",
      reason: "cost_hurdle_not_met: expectedEdge 4.99 is below hurdle 5 (roundTripFee 5, cost_hurdle_x 1)"
    });
  });

  it("self-derives expected edge and cost when external cost-hurdle inputs are missing", () => {
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
    ).toMatchObject({ kind: "pass", enrich: { sizing: { volume: "20", riskAmount: "100" } } });
  });

  it("vetoes when self-derived expected edge is below the self-derived cost hurdle", () => {
    const result = createTier3().run({
      ...baseContext,
      config: {
        ...config,
        params: {
          ...config.params,
          cost_hurdle_x: "300"
        }
      },
      account: { equity: "10000" },
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "115"
      }
    });

    expect(result).toEqual({
      kind: "veto",
      tier: "tier3",
      reason: "cost_hurdle_not_met: expectedEdge 300 is below hurdle 840 (roundTripFee 2.8, cost_hurdle_x 300)"
    });
  });

  it("uses external expected edge and cost as a backward-compatible override", () => {
    expect(
      createTier3().run({
        ...baseContext,
        expectedEdge: "1",
        cost: { roundTripFee: "0.1" },
        account: { equity: "10000" },
        candidate: {
          direction: "long",
          entry: "100",
          stop: "95",
          target: "115"
        }
      })
    ).toMatchObject({ kind: "pass", enrich: { sizing: { volume: "20", riskAmount: "100" } } });
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

  it("short-circuits cost hurdle when sizing rejects first", () => {
    const result = createTier3().run({
      ...baseContext,
      expectedEdge: "0.01",
      cost: { roundTripFee: "999" },
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

  it("applies win-streak dampening before sizing", () => {
    const result = createTier3().run({
      ...baseContext,
      state: {
        ...state,
        winStreak: 3
      },
      config: {
        ...config,
        params: {
          ...config.params,
          risk_pct: "150",
          size_dampening: "0.5",
          win_streak_threshold: 3
        }
      },
      account: { equity: "10000" },
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "115"
      }
    });

    expect(result).toMatchObject({ kind: "pass", enrich: { sizing: { volume: "1500", riskAmount: "7500" } } });
  });

  it("keeps baseline sizing when win streak is below threshold", () => {
    const result = createTier3().run({
      ...baseContext,
      state: {
        ...state,
        winStreak: 2
      },
      account: { equity: "10000" },
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "115"
      }
    });

    expect(result).toMatchObject({ kind: "pass", enrich: { sizing: { volume: "20", riskAmount: "100" } } });
  });

  it("dampened effective risk produces volume reduced by size_dampening", () => {
    const baseline = sizeTrade({
      equity: "10000",
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "115"
      },
      riskPct: "1",
      minRr: "1.5"
    });
    const dampening = evaluateWinStreakDampening({
      winStreak: 3,
      threshold: 3,
      riskPct: "1",
      sizeDampening: "0.5"
    });

    expect(dampening).toEqual({
      ok: true,
      dampened: true,
      effectiveRiskPct: "0.5"
    });
    expect(baseline.ok).toBe(true);
    if (baseline.ok && dampening.ok) {
      const dampened = sizeTrade({
        equity: "10000",
        candidate: {
          direction: "long",
          entry: "100",
          stop: "95",
          target: "115"
        },
        riskPct: dampening.effectiveRiskPct,
        minRr: "1.5"
      });

      expect(dampened.ok).toBe(true);
      if (dampened.ok) {
        expect(baseline.volume).toBe("20");
        expect(dampened.volume).toBe("10");
      }
    }
  });
});
