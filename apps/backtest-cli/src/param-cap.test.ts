import { describe, expect, it } from "vitest";

import { enforceParamCap } from "./param-cap.js";

describe("enforceParamCap", () => {
  it("passes at the cap and rejects above it", () => {
    expect(enforceParamCap(["risk_pct", "min_rr"], 2)).toEqual({ ok: true, count: 2, cap: 2 });
    expect(enforceParamCap(["risk_pct", "min_rr", "fee_rate"], 2)).toEqual({
      ok: false,
      error: {
        code: "param_cap_exceeded",
        source: "validation.param_cap",
        context: { count: 3, cap: 2 }
      }
    });
  });
});
