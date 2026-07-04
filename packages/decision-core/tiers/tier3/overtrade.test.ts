import { describe, expect, it } from "vitest";

import type { OvertradeInput } from "./overtrade.js";
import { evaluateOvertrade } from "./overtrade.js";

const validInput: OvertradeInput = {
  cumulativeFees: "30",
  cumulativeGrossProfit: "100",
  limit: "0.3"
};

describe("evaluateOvertrade", () => {
  it("calculates fee/gross ratio and does not flag at the exact limit", () => {
    expect(evaluateOvertrade(validInput)).toEqual({
      ok: true,
      ratio: "0.3",
      flagged: false
    });
  });

  it("flags only when ratio is strictly greater than the limit", () => {
    expect(evaluateOvertrade({ ...validInput, limit: "0.2" })).toEqual({
      ok: true,
      ratio: "0.3",
      flagged: true
    });
  });

  it("flags positive fees with zero gross profit without dividing", () => {
    expect(
      evaluateOvertrade({
        cumulativeFees: "5",
        cumulativeGrossProfit: "0",
        limit: "0.3"
      })
    ).toEqual({
      ok: true,
      ratio: null,
      flagged: true
    });
  });

  it("does not flag zero fees with zero gross profit", () => {
    expect(
      evaluateOvertrade({
        cumulativeFees: "0",
        cumulativeGrossProfit: "0",
        limit: "0.3"
      })
    ).toEqual({
      ok: true,
      ratio: null,
      flagged: false
    });
  });

  it.each([
    ["negative cumulative fees", { cumulativeFees: "-1" }, "invalid_cumulative_fees"],
    ["zero limit", { limit: "0" }, "invalid_overtrade_limit"],
    ["bad cumulative fees", { cumulativeFees: "wat" }, "invalid_decimal_string"],
    ["bad cumulative gross profit", { cumulativeGrossProfit: "Infinity" }, "invalid_decimal_string"],
    ["bad limit", { limit: "NaN" }, "invalid_decimal_string"]
  ])("rejects invalid input: %s", (_name, override, code) => {
    const result = evaluateOvertrade({ ...validInput, ...override });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.source).toBe("tier3.overtrade");
      expect(result.error.context).toEqual(expect.any(Object));
    }
  });

  it("is deterministic and does not mutate input", () => {
    const before = structuredClone(validInput);

    const first = evaluateOvertrade(validInput);
    const second = evaluateOvertrade(validInput);

    expect(first).toEqual(second);
    expect(validInput).toEqual(before);
  });
});
