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

  // ── Live drift halt (3.5) ──────────────────────────────────────────────

  it("vetoes with live_drift_halt when drifting=true (systemic, first in order)", () => {
    expect(
      createTier0().run({
        ...context,
        liveDrift: {
          liveExpectancy: "-0.5",
          drifting: true,
          sampleCount: 25,
          baselineLower: "0",
        },
      })
    ).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: "live_drift_halt: liveExpectancy -0.5 below baselineLower 0 (25 samples)",
    });
  });

  it("live_drift_halt takes priority over cooldown (systemic > per-session)", () => {
    // Even if cooldown would also fire, drift halt comes first
    expect(
      createTier0().run({
        ...context,
        state: { ...state, lastLossEpochMillis: nowEpochMillis },
        liveDrift: {
          liveExpectancy: "-0.5",
          drifting: true,
          sampleCount: 25,
          baselineLower: "0",
        },
      })
    ).toEqual({
      kind: "veto",
      tier: "tier0",
      reason: "live_drift_halt: liveExpectancy -0.5 below baselineLower 0 (25 samples)",
    });
  });

  it("does NOT veto when drifting=false (proceeds to behavioral checks)", () => {
    const result = createTier0().run({
      ...context,
      liveDrift: {
        liveExpectancy: "0.5",
        drifting: false,
        sampleCount: 10,
        baselineLower: "0",
      },
    });

    // Should pass (or veto on behavioral grounds, but not drift)
    if (result.kind === "veto") {
      expect(result.reason).not.toContain("live_drift_halt");
    }
  });

  it("does NOT veto when liveDrift is undefined (legacy tests unaffected)", () => {
    // No liveDrift in context ⇒ old behavioral veto runs normally
    expect(context.liveDrift).toBeUndefined();
    const result = createTier0().run(context);
    // Should either pass or behavioral-veto, never drift-halt
    if (result.kind === "veto") {
      expect(result.reason).not.toContain("live_drift_halt");
    }
  });
});
