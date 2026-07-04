import { describe, expect, it, vi } from "vitest";
import type { ConfigSnapshot } from "@brighten/config";
import type { ClockPort } from "../ports/index.js";
import type { BehavioralState, MarketSnapshot } from "../types/index.js";
import { runPipeline } from "./runner.js";
import type { Tier, TierContext, TierId, TierOutcome } from "./runner.js";

const fixedNowEpochMillis = 1_700_000_000_000;

const input: MarketSnapshot = {
  pair: "BTCUSDT",
  timeframe: "1m",
  atEpochMillis: fixedNowEpochMillis
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
