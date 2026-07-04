import { describe, expect, it } from "vitest";

import { computeRoundTripCost } from "./round-trip.js";
import type { RoundTripCostInput } from "./round-trip.js";

const baseInput: RoundTripCostInput = {
  notional: "10000",
  feeRate: "0.0004",
  spread: "0.0001",
  slippage: "0.0002"
};

describe("computeRoundTripCost", () => {
  it("sums fee + spread + slippage over both sides (no funding)", () => {
    // perSide = (0.0004 + 0.0001 + 0.0002) × 10000 = 7 ; base = 7 × 2 = 14
    const result = computeRoundTripCost(baseInput);

    expect(result).toEqual({ ok: true, cost: "14" });
  });

  it("adds funding cost across held funding points for perp crypto", () => {
    // base = 14 ; funding = (0.0001 × 10000) × 2 = 2 ; cost = 16
    const result = computeRoundTripCost({
      ...baseInput,
      fundingPoints: [{ fundingRate: "0.0001" }, { fundingRate: "0.0001" }]
    });

    expect(result).toEqual({ ok: true, cost: "16" });
  });

  it("treats an absent funding window as zero funding (FX / non-perp)", () => {
    const withoutFunding = computeRoundTripCost(baseInput);
    const emptyFunding = computeRoundTripCost({ ...baseInput, fundingPoints: [] });

    expect(withoutFunding).toEqual({ ok: true, cost: "14" });
    expect(emptyFunding).toEqual({ ok: true, cost: "14" });
  });

  it("supports negative funding (funding received reduces cost)", () => {
    // base = 14 ; funding = -0.0001 × 10000 = -1 ; cost = 13
    const result = computeRoundTripCost({
      ...baseInput,
      fundingPoints: [{ fundingRate: "-0.0001" }]
    });

    expect(result).toEqual({ ok: true, cost: "13" });
  });

  it("returns a decimal-string cost, never a JS number", () => {
    const result = computeRoundTripCost(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.cost).toBe("string");
    }
  });

  it("rejects a negative notional", () => {
    const result = computeRoundTripCost({ ...baseInput, notional: "-1" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_notional",
        source: "cost.round_trip",
        context: {
          notional: "-1",
          message: "Notional must be a decimal string greater than or equal to 0"
        }
      }
    });
  });

  it("rejects unparseable decimal input", () => {
    const result = computeRoundTripCost({ ...baseInput, feeRate: "not-decimal" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "cost.round_trip",
        context: { field: "feeRate", value: "not-decimal" }
      }
    });
  });

  it("rejects an unparseable funding rate", () => {
    const result = computeRoundTripCost({
      ...baseInput,
      fundingPoints: [{ fundingRate: "oops" }]
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "cost.round_trip",
        context: { field: "fundingRate", value: "oops", index: 0 }
      }
    });
  });

  it("is deterministic and does not mutate its input", () => {
    const input: RoundTripCostInput = {
      ...baseInput,
      fundingPoints: [{ fundingRate: "0.0001" }]
    };
    const frozen = Object.freeze({ ...input, fundingPoints: Object.freeze([...input.fundingPoints ?? []]) });

    const first = computeRoundTripCost(frozen);
    const second = computeRoundTripCost(frozen);

    expect(first).toEqual(second);
    expect(input.notional).toBe("10000");
  });
});
