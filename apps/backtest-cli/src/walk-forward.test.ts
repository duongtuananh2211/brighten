import { describe, expect, it } from "vitest";

import { makeKline, makeSnapshot } from "./test-support.js";
import { splitWalkForward } from "./walk-forward.js";

describe("splitWalkForward", () => {
  it("creates deterministic contiguous folds and a separated terminal holdout", () => {
    const snapshot = makeSnapshot({
      klines: Array.from({ length: 12 }, (_, index) => makeKline(index))
    });

    const result = splitWalkForward(snapshot, {
      folds: 3,
      inSampleRatio: "0.5",
      holdoutRatio: "0.25"
    });

    expect(result).toEqual({
      ok: true,
      holdout: { fromIndex: 9, toIndex: 12 },
      folds: [
        { inSample: { fromIndex: 0, toIndex: 1 }, outOfSample: { fromIndex: 1, toIndex: 3 } },
        { inSample: { fromIndex: 3, toIndex: 4 }, outOfSample: { fromIndex: 4, toIndex: 6 } },
        { inSample: { fromIndex: 6, toIndex: 7 }, outOfSample: { fromIndex: 7, toIndex: 9 } }
      ]
    });
  });

  it("rejects invalid input with validation.walk_forward source", () => {
    const snapshot = makeSnapshot({ klines: [makeKline(0), makeKline(1)] });

    const result = splitWalkForward(snapshot, {
      folds: 0,
      inSampleRatio: "0.5",
      holdoutRatio: "0.25"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { source: "validation.walk_forward" }
    });
  });
});
