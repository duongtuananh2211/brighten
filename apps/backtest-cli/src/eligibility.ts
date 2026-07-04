import { cmp } from "@brighten/decision-core/math";

import type { LiveEligibility, ValidationMode } from "./types.js";

export type { ValidationMode };

export interface LiveEligibilityInput {
  readonly holdoutExpectancy: string;
  readonly ciLower: string;
  readonly paperTradeCompleted: boolean;
}

// Paper-trade v1 is only a label plus gate: no real capital and no order send.
// Live wiring belongs to epic 3.
export function assessLiveEligibility(input: LiveEligibilityInput): LiveEligibility {
  const reasons: string[] = [];

  if (cmp(input.holdoutExpectancy, "0") <= 0) {
    reasons.push("holdout_expectancy_not_positive");
  }
  if (cmp(input.ciLower, "0") <= 0) {
    reasons.push("ci_lower_not_positive");
  }
  if (!input.paperTradeCompleted) {
    reasons.push("paper_trade_not_completed");
  }

  return {
    eligible: reasons.length === 0,
    reasons
  };
}
