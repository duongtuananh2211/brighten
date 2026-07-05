import { describe, expect, it } from "vitest";

import { makeKline, makeSnapshot } from "./test-support.js";
import { reindexStrategyInput, sliceSnapshot } from "./slice.js";
import type { BacktestStrategyInput } from "./types.js";

describe("sliceSnapshot and reindexStrategyInput", () => {
  it("slices klines and reindexes signals without mutating input", () => {
    const snapshot = makeSnapshot({
      klines: Array.from({ length: 5 }, (_, index) => makeKline(index))
    });
    const strategyInput: BacktestStrategyInput = {
      state: { winStreak: 0, dailyLoss: "0", tradeCountToday: 0 },
      account: { equity: "10000" },
      signals: [{ tickIndex: 0 }, { tickIndex: 2 }, { tickIndex: 4 }]
    };
    const beforeSnapshot = structuredClone(snapshot);
    const beforeInput = structuredClone(strategyInput);

    const sliced = sliceSnapshot(snapshot, { fromIndex: 1, toIndex: 4 });
    const reindexed = reindexStrategyInput(strategyInput, { fromIndex: 1, toIndex: 4 });

    expect(sliced.klines.map((kline) => kline.openTime)).toEqual([
      makeKline(1).openTime,
      makeKline(2).openTime,
      makeKline(3).openTime
    ]);
    expect(sliced.atEpochMillis).toBe(makeKline(1).openTime);
    expect(reindexed.signals).toEqual([{ tickIndex: 1 }]);
    expect(snapshot).toEqual(beforeSnapshot);
    expect(strategyInput).toEqual(beforeInput);
  });
});
