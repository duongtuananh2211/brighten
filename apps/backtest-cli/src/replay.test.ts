import { describe, expect, it } from "vitest";
import type { BehavioralState, TradeCandidate } from "@brighten/decision-core";

import { replay } from "./replay.js";
import { defaultTiers } from "./run.js";
import { makeConfigSnapshot, makeKline, makeSnapshot } from "./test-support.js";
import type { BacktestStrategyInput } from "./types.js";

const longCandidate: TradeCandidate = {
  direction: "long",
  entry: "100",
  stop: "95",
  target: "115"
};

const cleanState: BehavioralState = { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 };

function snapshotTwoTicks() {
  return makeSnapshot({
    klines: [makeKline(0), makeKline(1, { high: "116", low: "99", close: "115" })]
  });
}

function baseInput(overrides: Partial<BacktestStrategyInput> = {}): BacktestStrategyInput {
  return {
    state: cleanState,
    account: { equity: "10000" },
    signals: [],
    ...overrides
  };
}

describe("replay (drives the real decision-core pipeline)", () => {
  it("emits a suggestion when Tier 0 passes and a candidate is injected", () => {
    const emitted = replay(
      snapshotTwoTicks(),
      baseInput({ signals: [{ tickIndex: 0, candidate: longCandidate }] }),
      makeConfigSnapshot(),
      defaultTiers()
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ entryTickIndex: 0, sizing: { volume: "20", riskAmount: "100" } });
  });

  it("emits nothing when Tier 0 vetoes (proves the driver uses the real core)", () => {
    const emitted = replay(
      snapshotTwoTicks(),
      baseInput({
        signals: [
          {
            tickIndex: 0,
            candidate: longCandidate,
            state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 5 } // max_trades_reached
          }
        ]
      }),
      makeConfigSnapshot(),
      defaultTiers()
    );

    expect(emitted).toHaveLength(0);
  });

  it("respects the Tier 3 cost-hurdle: low expected edge is vetoed, high edge passes", () => {
    const snapshot = snapshotTwoTicks();
    const config = makeConfigSnapshot();

    // Estimated roundTrip fee = 0.0007 × (20 × 100) × 2 = 2.8 ; hurdle = 2.8.
    const vetoed = replay(
      snapshot,
      baseInput({ signals: [{ tickIndex: 0, candidate: longCandidate, expectedEdge: "1" }] }),
      config,
      defaultTiers()
    );
    const passed = replay(
      snapshot,
      baseInput({ signals: [{ tickIndex: 0, candidate: longCandidate, expectedEdge: "1000" }] }),
      config,
      defaultTiers()
    );

    expect(vetoed).toHaveLength(0);
    expect(passed).toHaveLength(1);
  });

  it("emits nothing when no candidate is injected", () => {
    const emitted = replay(snapshotTwoTicks(), baseInput(), makeConfigSnapshot(), defaultTiers());

    expect(emitted).toHaveLength(0);
  });
});
