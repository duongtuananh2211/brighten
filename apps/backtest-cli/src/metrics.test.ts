import { describe, expect, it } from "vitest";

import { computeMetrics } from "./metrics.js";

describe("computeMetrics", () => {
  it("aggregates a known net-R sequence into honest metrics", () => {
    const metrics = computeMetrics(["1", "-0.5", "2", "-0.5"]);

    expect(metrics).toEqual({
      tradeCount: 4,
      expectancy: "0.5", // (1 - 0.5 + 2 - 0.5) / 4
      maxDrawdown: "0.5", // peak 2.5 → trough 2.0
      equityCurve: ["1", "0.5", "2.5", "2"],
      rDistribution: [
        { r: "-0.5", count: 2 },
        { r: "1", count: 1 },
        { r: "2", count: 1 }
      ],
      winRateReference: "0.5" // 2 winners of 4 — reference only
    });
  });

  it("returns zeroed metrics for an empty sequence", () => {
    expect(computeMetrics([])).toEqual({
      tradeCount: 0,
      expectancy: "0",
      maxDrawdown: "0",
      equityCurve: [],
      rDistribution: [],
      winRateReference: "0"
    });
  });

  it("labels win rate as reference and never as a headline metric", () => {
    const metrics = computeMetrics(["1", "-1"]);

    expect("winRateReference" in metrics).toBe(true);
    expect("winRate" in metrics).toBe(false);
  });

  it("emits decimal-string amounts (no number leak)", () => {
    const metrics = computeMetrics(["1.25", "-0.75"]);

    expect(typeof metrics.expectancy).toBe("string");
    expect(typeof metrics.maxDrawdown).toBe("string");
    expect(typeof metrics.winRateReference).toBe("string");
    for (const equity of metrics.equityCurve) {
      expect(typeof equity).toBe("string");
    }
    for (const bin of metrics.rDistribution) {
      expect(typeof bin.r).toBe("string");
    }
  });
});
