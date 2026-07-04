import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARAMS,
  InMemoryConfigStore,
  validateParams
} from "./index.js";

describe("config param validation", () => {
  it("accepts the complete default params shape", () => {
    expect(validateParams(DEFAULT_PARAMS)).toEqual({
      ok: true,
      value: DEFAULT_PARAMS
    });
  });

  it.each([
    ["daily_loss_limit", { daily_loss_limit: "not-decimal" }],
    ["risk_pct", { risk_pct: "0" }],
    ["min_rr", { min_rr: "-1" }],
    ["win_streak_threshold", { win_streak_threshold: -1 }],
    ["max_trades_per_day", { max_trades_per_day: -1 }],
    ["trading_day_boundary", { trading_day_boundary: "midnight" }]
  ])("rejects invalid %s without creating a version", (_, override) => {
    const store = new InMemoryConfigStore({ now: () => 1_700_000_000_000 });
    const before = store.getLatest();

    const result = store.save({ ...DEFAULT_PARAMS, ...override });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: expect.any(String),
        source: "config.validation",
        context: expect.any(Object)
      });
    }
    expect(store.getLatest()).toBe(before);
  });
});
