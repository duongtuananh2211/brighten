import { describe, expect, it, vi } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { ClockPort } from "../ports/index.js";
import type { BehavioralState, MarketSnapshot, TradeCandidate } from "../types/index.js";
import { createTier1Crypto, createTier1Fx } from "../tiers/tier1/index.js";
import { createTier2 } from "../tiers/tier2/index.js";
import { runPipeline } from "./runner.js";
import type { Tier, TierContext, TierId, TierOutcome } from "./runner.js";

const fixedNowEpochMillis = 1_700_000_000_000;

const input: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: fixedNowEpochMillis,
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

function clock(): ClockPort {
  return {
    nowEpochMillis: vi.fn(() => fixedNowEpochMillis)
  };
}

function tier(
  id: TierId,
  calls: TierId[],
  outcome: TierOutcome = { kind: "pass" },
  contexts: TierContext[] = []
): Tier {
  return {
    id,
    run(ctx) {
      calls.push(id);
      contexts.push(ctx);
      return outcome;
    }
  };
}

function allPassTiers(calls: TierId[], contexts: TierContext[] = []): readonly Tier[] {
  return [
    tier("tier0", calls, { kind: "pass" }, contexts),
    tier("tier1", calls, { kind: "pass" }, contexts),
    tier("tier2", calls, { kind: "pass" }, contexts),
    tier("tier3", calls, { kind: "pass" }, contexts)
  ];
}

describe("runPipeline", () => {
  it("calls tiers in tier0 to tier3 order when all tiers pass", () => {
    const calls: TierId[] = [];

    const result = runPipeline(allPassTiers(calls), { input, state, config }, clock());

    expect(calls).toEqual(["tier0", "tier1", "tier2", "tier3"]);
    expect(result.outcome).toBe("suggestion");
  });

  it.each([
    ["tier0", ["tier0"]],
    ["tier1", ["tier0", "tier1"]],
    ["tier2", ["tier0", "tier1", "tier2"]],
    ["tier3", ["tier0", "tier1", "tier2", "tier3"]]
  ] satisfies readonly (readonly [TierId, readonly TierId[]])[])(
    "stops immediately when %s vetoes",
    (vetoTierId, expectedCalls) => {
      const calls: TierId[] = [];
      const reason = `${vetoTierId} blocked`;
      const tiers: readonly Tier[] = (["tier0", "tier1", "tier2", "tier3"] as const).map((id) =>
        tier(id, calls, id === vetoTierId ? { kind: "veto", tier: id, reason } : { kind: "pass" })
      );

      const result = runPipeline(tiers, { input, state, config }, clock());

      expect(calls).toEqual(expectedCalls);
      expect(result).toEqual({
        outcome: "silent",
        vetoedBy: vetoTierId,
        reason
      });
    }
  );

  it("reads the clock exactly once and injects the resolved tick time into every tier context", () => {
    const calls: TierId[] = [];
    const contexts: TierContext[] = [];
    const fakeClock = clock();

    runPipeline(allPassTiers(calls, contexts), { input, state, config }, fakeClock);

    expect(fakeClock.nowEpochMillis).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(4);
    expect(contexts.map((ctx) => ctx.nowEpochMillis)).toEqual([
      fixedNowEpochMillis,
      fixedNowEpochMillis,
      fixedNowEpochMillis,
      fixedNowEpochMillis
    ]);
  });

  it("is deterministic for the same input, state, config, tiers, and fixed clock", () => {
    const first = runPipeline(allPassTiers([]), { input, state, config }, clock());
    const second = runPipeline(allPassTiers([]), { input, state, config }, clock());

    expect(first).toEqual(second);
  });

  it("threads pass enrichments into downstream tier contexts", () => {
    const calls: TierId[] = [];
    const contexts: TierContext[] = [];
    const candidate: TradeCandidate = {
      direction: "long",
      entry: "1.1",
      stop: "1.09",
      target: "1.12"
    };
    const sizing = {
      ok: true as const,
      direction: "long" as const,
      entry: "1.1",
      stop: "1.09",
      target: "1.12",
      stopDistance: "0.01",
      volume: "10000",
      riskAmount: "100",
      rr: "2"
    };
    const tier1: Tier = {
      id: "tier1",
      run(ctx) {
        calls.push("tier1");
        contexts.push(ctx);
        return { kind: "pass", enrich: { direction: "long" } };
      }
    };
    const tier2: Tier = {
      id: "tier2",
      run(ctx) {
        calls.push("tier2");
        contexts.push(ctx);
        return { kind: "pass", enrich: { candidate } };
      }
    };
    const tier3: Tier = {
      id: "tier3",
      run(ctx) {
        calls.push("tier3");
        contexts.push(ctx);
        return { kind: "pass", enrich: { sizing } };
      }
    };

    const result = runPipeline([tier("tier0", calls, { kind: "pass" }, contexts), tier1, tier2, tier3], {
      input,
      state,
      config
    }, clock());

    expect(result.outcome).toBe("suggestion");
    expect(calls).toEqual(["tier0", "tier1", "tier2", "tier3"]);
    expect(contexts[2]?.direction).toBe("long");
    expect(contexts[3]?.candidate).toEqual(candidate);
    expect(result.direction).toBe("long");
    expect(result.candidate).toEqual(candidate);
    expect(result.sizing).toEqual(sizing);
  });

  it("does not surface decision enrichments on silent outcomes", () => {
    const candidate: TradeCandidate = {
      direction: "long",
      entry: "1.1",
      stop: "1.09",
      target: "1.12"
    };
    const result = runPipeline(
      [
        tier("tier0", []),
        {
          id: "tier1",
          run() {
            return { kind: "pass", enrich: { direction: "long" } };
          }
        },
        {
          id: "tier2",
          run() {
            return { kind: "pass", enrich: { candidate } };
          }
        },
        {
          id: "tier3",
          run() {
            return { kind: "veto", tier: "tier3", reason: "blocked" };
          }
        }
      ],
      { input, state, config },
      clock()
    );

    expect(result).toEqual({
      outcome: "silent",
      vetoedBy: "tier3",
      reason: "blocked"
    });
  });

  it("threads a tier1 direction into real tier2 and forwards the generated candidate", () => {
    const calls: TierId[] = [];
    const contexts: TierContext[] = [];
    const tier1: Tier = {
      id: "tier1",
      run() {
        calls.push("tier1");
        return { kind: "pass", enrich: { direction: "long" } };
      }
    };
    const tier2 = createTier2();
    const trackedTier2: Tier = {
      id: "tier2",
      run(ctx) {
        calls.push("tier2");
        return tier2.run(ctx);
      }
    };
    const tier3: Tier = {
      id: "tier3",
      run(ctx) {
        calls.push("tier3");
        contexts.push(ctx);
        return { kind: "pass" };
      }
    };
    const entryInput: MarketSnapshot = {
      ...input,
      pair: "EURUSD",
      klines: [
        fxKline(1, "1.1050", "1.1010", "1.1030"),
        fxKline(3, "1.1080", "1.1000", "1.1040"),
        fxKline(5, "1.1060", "1.1020", "1.1050"),
        fxKline(7, "1.1060", "1.1010", "1.1040")
      ]
    };
    const entryConfig: ConfigSnapshot = {
      ...config,
      params: {
        ...config.params,
        tier2_swing_lookback: 3,
        tier2_stop_buffer: "0.1",
        tier2_min_data_points: 4
      }
    };

    const result = runPipeline([tier("tier0", calls), tier1, trackedTier2, tier3], {
      input: entryInput,
      state,
      config: entryConfig
    }, clock());

    expect(result.outcome).toBe("suggestion");
    expect(calls).toEqual(["tier0", "tier1", "tier2", "tier3"]);
    expect(contexts[0]?.candidate).toEqual({
      direction: "long",
      entry: "1.1",
      stop: "1.0992",
      target: "1.108"
    });
  });

  it("stops silently at tier1 when crypto regime has no direction", () => {
    const calls: TierId[] = [];
    const tier2 = tier("tier2", calls);
    const tier3 = tier("tier3", calls);
    const noEdgeInput: MarketSnapshot = {
      ...input,
      klines: [
        {
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
        },
        {
          openTime: 3,
          open: "1",
          high: "1",
          low: "1",
          close: "1",
          volume: "10",
          closeTime: 4,
          quoteVolume: "10",
          numberOfTrades: 1,
          takerBuyBaseVolume: "7",
          takerBuyQuoteVolume: "7"
        }
      ],
      funding: [
        { fundingTime: 1, fundingRate: "0" },
        { fundingTime: 2, fundingRate: "0" }
      ],
      openInterest: [
        { timestamp: 1, sumOpenInterest: "100", sumOpenInterestValue: "100" },
        { timestamp: 2, sumOpenInterest: "102", sumOpenInterestValue: "102" }
      ],
      longShortRatio: [
        { timestamp: 1, longShortRatio: "1", longAccount: "0.5", shortAccount: "0.5" },
        { timestamp: 2, longShortRatio: "1.2", longAccount: "0.55", shortAccount: "0.45" }
      ]
    };
    const tier1 = createTier1Crypto();
    const trackedTier1: Tier = {
      id: "tier1",
      run(ctx) {
        calls.push("tier1");
        return tier1.run(ctx);
      }
    };

    const result = runPipeline(
      [tier("tier0", calls), trackedTier1, tier2, tier3],
      { input: noEdgeInput, state, config },
      clock()
    );

    expect(calls).toEqual(["tier0", "tier1"]);
    expect(result).toEqual({
      outcome: "silent",
      vetoedBy: "tier1",
      reason: "no_edge_below_threshold: All tier1 crypto votes are neutral"
    });
  });

  it("stops silently at tier1 when FX regime has no liquidity sweep", () => {
    const calls: TierId[] = [];
    const tier2 = tier("tier2", calls);
    const tier3 = tier("tier3", calls);
    const fxInput: MarketSnapshot = {
      ...input,
      pair: "EURUSD",
      klines: [
        fxKline(1, "1.1050", "1.1010", "1.1030"),
        fxKline(3, "1.1080", "1.1000", "1.1040"),
        fxKline(5, "1.1060", "1.1020", "1.1050"),
        fxKline(7, "1.1070", "1.1030", "1.1060")
      ]
    };
    const fxConfig: ConfigSnapshot = {
      ...config,
      params: {
        ...config.params,
        fx_swing_lookback: 3,
        fx_sweep_min_penetration: "0.125",
        fx_min_data_points: 4
      }
    };
    const tier1 = createTier1Fx();
    const trackedTier1: Tier = {
      id: "tier1",
      run(ctx) {
        calls.push("tier1");
        return tier1.run(ctx);
      }
    };

    const result = runPipeline(
      [tier("tier0", calls), trackedTier1, tier2, tier3],
      { input: fxInput, state, config: fxConfig },
      clock()
    );

    expect(calls).toEqual(["tier0", "tier1"]);
    expect(result).toEqual({
      outcome: "silent",
      vetoedBy: "tier1",
      reason: "no_liquidity_sweep: highPenetration -0.125, lowPenetration -0.375"
    });
  });

  it("does not mutate input, state, or config", () => {
    const inputBefore = structuredClone(input);
    const stateBefore = structuredClone(state);
    const configBefore = structuredClone(config);

    runPipeline(allPassTiers([]), { input, state, config }, clock());

    expect(input).toEqual(inputBefore);
    expect(state).toEqual(stateBefore);
    expect(config).toEqual(configBefore);
  });
});

function fxKline(openTime: number, high: string, low: string, close: string) {
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
