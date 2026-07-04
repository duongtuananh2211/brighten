import { describe, expect, it } from "vitest";

import type { CostHurdleInput } from "./cost-hurdle.js";
import { evaluateCostHurdle } from "./cost-hurdle.js";

const validInput: CostHurdleInput = {
  expectedEdge: "30",
  roundTripFee: "10",
  costHurdleX: "2"
};

describe("evaluateCostHurdle", () => {
  it("passes when expected edge clears the configured fee multiple", () => {
    expect(evaluateCostHurdle(validInput)).toEqual({
      ok: true,
      expectedEdge: "30",
      roundTripFee: "10",
      hurdle: "20"
    });
  });

  it("passes at the exact hurdle boundary", () => {
    expect(
      evaluateCostHurdle({
        expectedEdge: "20",
        roundTripFee: "10",
        costHurdleX: "2"
      })
    ).toEqual({
      ok: true,
      expectedEdge: "20",
      roundTripFee: "10",
      hurdle: "20"
    });
  });

  it("rejects when expected edge is below the hurdle and records decision context", () => {
    expect(
      evaluateCostHurdle({
        expectedEdge: "15",
        roundTripFee: "10",
        costHurdleX: "2"
      })
    ).toEqual({
      ok: false,
      error: {
        code: "cost_hurdle_not_met",
        source: "tier3.cost_hurdle",
        context: {
          expectedEdge: "15",
          hurdle: "20",
          roundTripFee: "10",
          costHurdleX: "2",
          message: "Expected edge is below configured cost hurdle"
        }
      }
    });
  });

  it.each([
    ["negative round-trip fee", { roundTripFee: "-1" }, "invalid_round_trip_fee"],
    ["zero cost hurdle", { costHurdleX: "0" }, "invalid_cost_hurdle_x"],
    ["bad expected edge", { expectedEdge: "wat" }, "invalid_decimal_string"],
    ["bad round-trip fee", { roundTripFee: "Infinity" }, "invalid_decimal_string"],
    ["bad cost hurdle", { costHurdleX: "NaN" }, "invalid_decimal_string"]
  ])("rejects invalid input: %s", (_name, override, code) => {
    const result = evaluateCostHurdle({ ...validInput, ...override });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.source).toBe("tier3.cost_hurdle");
      expect(result.error.context).toEqual(expect.any(Object));
    }
  });

  it("is deterministic and does not mutate input", () => {
    const before = structuredClone(validInput);

    const first = evaluateCostHurdle(validInput);
    const second = evaluateCostHurdle(validInput);

    expect(first).toEqual(second);
    expect(validInput).toEqual(before);
  });

  it("returns monetary fields as strings", () => {
    const result = evaluateCostHurdle(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const field of ["expectedEdge", "roundTripFee", "hurdle"] as const) {
        expect(typeof result[field]).toBe("string");
      }
    }
  });
});
