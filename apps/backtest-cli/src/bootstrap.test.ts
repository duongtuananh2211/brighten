import { describe, expect, it } from "vitest";
import { cmp } from "@brighten/decision-core/math";

import { bootstrapExpectancyCI } from "./bootstrap.js";

describe("bootstrapExpectancyCI", () => {
  it("is deterministic for the same seed and emits an ordered interval", () => {
    const first = bootstrapExpectancyCI(["1", "-1", "2", "0"], { resamples: 20, seed: 42 });
    const second = bootstrapExpectancyCI(["1", "-1", "2", "0"], { resamples: 20, seed: 42 });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value).toEqual({
        lower: "-0.75",
        median: "0.75",
        upper: "1.25",
        resamples: 20,
        seed: 42
      });
      expect(cmp(first.value.lower, first.value.median)).toBeLessThanOrEqual(0);
      expect(cmp(first.value.median, first.value.upper)).toBeLessThanOrEqual(0);
      expect(typeof first.value.lower).toBe("string");
    }
  });

  it("rejects empty samples", () => {
    expect(bootstrapExpectancyCI([], { resamples: 20, seed: 42 })).toMatchObject({
      ok: false,
      error: { source: "validation.bootstrap" }
    });
  });
});
