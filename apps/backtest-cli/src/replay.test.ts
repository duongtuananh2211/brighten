import { describe, expect, it } from "vitest";
import type { BehavioralState } from "@brighten/decision-core";

import { replay } from "./replay.js";
import { defaultTiers } from "./run.js";
import { makeFxPipelineSnapshot, makeKline, makeRealPipelineConfig, makeSnapshot } from "./test-support.js";
import type { BacktestStrategyInput } from "./types.js";

const cleanState: BehavioralState = { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 };

function baseInput(overrides: Partial<BacktestStrategyInput> = {}): BacktestStrategyInput {
  return {
    state: cleanState,
    account: { equity: "10000" },
    signals: [],
    ...overrides
  };
}

describe("replay (drives the real decision-core pipeline)", () => {
  it("emits a suggestion when the real four-tier pipeline passes", () => {
    const emitted = replay(
      makeFxPipelineSnapshot(),
      baseInput({ signals: [{ tickIndex: 3 }] }),
      makeRealPipelineConfig(),
      defaultTiers("fx")
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      entryTickIndex: 3,
      sizing: { direction: "short", entry: "1.109", stop: "1.1099", target: "1.1" }
    });
  });

  it("emits nothing when Tier 0 vetoes (proves the driver uses the real core)", () => {
    const emitted = replay(
      makeFxPipelineSnapshot(),
      baseInput({
        signals: [
          {
            tickIndex: 0,
            state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 5 } // max_trades_reached
          }
        ]
      }),
      makeRealPipelineConfig(),
      defaultTiers("fx")
    );

    expect(emitted).toHaveLength(0);
  });

  it("respects the Tier 3 self-derived cost-hurdle", () => {
    const vetoed = replay(
      makeFxPipelineSnapshot(),
      baseInput({ signals: [{ tickIndex: 3 }] }),
      makeRealPipelineConfig({ cost_hurdle_x: "10" }),
      defaultTiers("fx")
    );
    const passed = replay(
      makeFxPipelineSnapshot(),
      baseInput({ signals: [{ tickIndex: 3 }] }),
      makeRealPipelineConfig(),
      defaultTiers("fx")
    );

    expect(vetoed).toHaveLength(0);
    expect(passed).toHaveLength(1);
  });

  it("emits nothing when Tier 1 finds no FX direction", () => {
    const emitted = replay(
      makeSnapshot({
        pair: "EURUSD",
        klines: [
          makeKline(0, { high: "1.1050", low: "1.1010", close: "1.1030" }),
          makeKline(1, { high: "1.1080", low: "1.1000", close: "1.1040" }),
          makeKline(2, { high: "1.1060", low: "1.1020", close: "1.1050" }),
          makeKline(3, { high: "1.1070", low: "1.1030", close: "1.1060" })
        ]
      }),
      baseInput({ signals: [{ tickIndex: 3 }] }),
      makeRealPipelineConfig(),
      defaultTiers("fx")
    );

    expect(emitted).toHaveLength(0);
  });

  it("emits nothing when Tier 2 finds no setup", () => {
    const emitted = replay(
      makeSnapshot({
        pair: "EURUSD",
        klines: [
          makeKline(0, { high: "1.1050", low: "1.1010", close: "1.1030" }),
          makeKline(1, { high: "1.1080", low: "1.1000", close: "1.1040" }),
          makeKline(2, { high: "1.1060", low: "1.1020", close: "1.1050" }),
          makeKline(3, { high: "1.1090", low: "1.1030", close: "1.1000" })
        ]
      }),
      baseInput({ signals: [{ tickIndex: 3 }] }),
      makeRealPipelineConfig(),
      defaultTiers("fx")
    );

    expect(emitted).toHaveLength(0);
  });

  it("emits nothing when no tick is scheduled for evaluation", () => {
    const emitted = replay(makeFxPipelineSnapshot(), baseInput(), makeRealPipelineConfig(), defaultTiers("fx"));

    expect(emitted).toHaveLength(0);
  });
});
