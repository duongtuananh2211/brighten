import { describe, expect, it } from "vitest";

import { assessLiveEligibility } from "./eligibility.js";

describe("assessLiveEligibility", () => {
  it("requires positive holdout, positive lower CI, and completed paper trade", () => {
    expect(
      assessLiveEligibility({
        holdoutExpectancy: "0.2",
        ciLower: "0.1",
        paperTradeCompleted: true
      })
    ).toEqual({ eligible: true, reasons: [] });

    expect(
      assessLiveEligibility({
        holdoutExpectancy: "0",
        ciLower: "-0.1",
        paperTradeCompleted: false
      })
    ).toEqual({
      eligible: false,
      reasons: [
        "holdout_expectancy_not_positive",
        "ci_lower_not_positive",
        "paper_trade_not_completed"
      ]
    });
  });
});
