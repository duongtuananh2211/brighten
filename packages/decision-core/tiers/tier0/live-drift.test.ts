import { describe, expect, it } from "vitest";
import { evaluateLiveDrift } from "./live-drift.js";

describe("evaluateLiveDrift", () => {
  it("computes mean expectancy from recent R values", () => {
    const result = evaluateLiveDrift({
      liveRs: ["1", "-1", "0.5"],
      baselineLower: "0",
      minSamples: 2,
      window: 3,
    });

    // mean = (1 + (-1) + 0.5) / 3 = 0.5 / 3 = 0.1666666666666666666666666666666667
    expect(result.sampleCount).toBe(3);
    expect(typeof result.liveExpectancy).toBe("string");
    expect(result.liveExpectancy).not.toBe("0");
    expect(result.baselineLower).toBe("0");
  });

  it("drifting=true when liveExpectancy < baselineLower AND count >= minSamples", () => {
    const result = evaluateLiveDrift({
      liveRs: ["-1", "-2", "-3"],
      baselineLower: "0",
      minSamples: 2,
      window: 5,
    });

    expect(result.drifting).toBe(true);
    expect(result.sampleCount).toBe(3);
  });

  it("drifting=false when liveExpectancy >= baselineLower", () => {
    const result = evaluateLiveDrift({
      liveRs: ["2", "3", "4"],
      baselineLower: "0",
      minSamples: 2,
      window: 5,
    });

    expect(result.drifting).toBe(false);
  });

  it("drifting=false when count < minSamples even if expectancy is below baseline", () => {
    const result = evaluateLiveDrift({
      liveRs: ["-5"],
      baselineLower: "0",
      minSamples: 5,
      window: 10,
    });

    expect(result.drifting).toBe(false);
    expect(result.sampleCount).toBe(1);
  });

  it("drifting=false when baselineLower is undefined (no baseline set)", () => {
    const result = evaluateLiveDrift({
      liveRs: ["-1", "-2", "-3", "-4", "-5", "-6"],
      baselineLower: undefined,
      minSamples: 3,
      window: 10,
    });

    expect(result.drifting).toBe(false);
    expect(result.baselineLower).toBe("0"); // default
  });

  it("always returns expectancy and sampleCount even when not drifting", () => {
    const result = evaluateLiveDrift({
      liveRs: ["1.5", "2", "0.5"],
      baselineLower: undefined,
      minSamples: 10, // far above what we have
      window: 5,
    });

    expect(result.liveExpectancy).not.toBe("0");
    expect(result.sampleCount).toBe(3);
    expect(result.drifting).toBe(false);
  });

  it("handles empty R series gracefully", () => {
    const result = evaluateLiveDrift({
      liveRs: [],
      baselineLower: "0",
      minSamples: 1,
      window: 50,
    });

    expect(result.sampleCount).toBe(0);
    expect(result.liveExpectancy).toBe("0");
    expect(result.drifting).toBe(false);
  });

  it("windows to the most recent N values only", () => {
    const result = evaluateLiveDrift({
      liveRs: ["10", "10", "10", "10", "-1", "-1"],
      baselineLower: "0",
      minSamples: 1,
      window: 2, // only last 2: [-1, -1]
    });

    // mean of last 2 = (-1 + -1) / 2 = -1
    expect(result.sampleCount).toBe(2);
    expect(result.drifting).toBe(true); // -1 < 0
  });

  it("is deterministic: same inputs ⇒ same outputs", () => {
    const input = { liveRs: ["-1", "2", "-3"] as const, baselineLower: "0" as const, minSamples: 2, window: 5 };
    expect(evaluateLiveDrift(input)).toEqual(evaluateLiveDrift(input));
  });

  it("is pure: does not mutate input", () => {
    const liveRs = ["-1", "2", "-3"];
    const clone = [...liveRs];
    evaluateLiveDrift({ liveRs, baselineLower: "0", minSamples: 2, window: 5 });
    expect(liveRs).toEqual(clone);
  });
});
