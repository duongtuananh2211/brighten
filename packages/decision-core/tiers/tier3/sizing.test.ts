import { describe, expect, it } from "vitest";
import type { SizingInput, SizingResult } from "./sizing.js";
import { sizeTrade } from "./sizing.js";

const validInput: SizingInput = {
  equity: "10000",
  riskPct: "1",
  minRr: "1.5",
  candidate: {
    direction: "long",
    entry: "100",
    stop: "95",
    target: "115"
  }
};

type SizingInputOverride = Partial<Omit<SizingInput, "candidate">> & {
  readonly candidate?: Partial<SizingInput["candidate"]>;
};

const invalidCases: readonly (readonly [string, SizingInputOverride, string])[] = [
  ["equity <= 0", { equity: "0" }, "invalid_equity"],
  ["risk_pct <= 0", { riskPct: "0" }, "invalid_risk_pct"],
  ["risk_pct >= 100", { riskPct: "100" }, "invalid_risk_pct"],
  ["min_rr <= 0", { minRr: "0" }, "invalid_min_rr"],
  [
    "long stop on wrong side",
    { candidate: { direction: "long", entry: "100", stop: "101", target: "115" } },
    "invalid_setup_side"
  ],
  [
    "short target on wrong side",
    { candidate: { direction: "short", entry: "100", stop: "105", target: "101" } },
    "invalid_setup_side"
  ],
  [
    "entry equals stop",
    { candidate: { direction: "long", entry: "100", stop: "100", target: "115" } },
    "zero_stop_distance"
  ],
  [
    "bad decimal string",
    { candidate: { direction: "long", entry: "wat", stop: "95", target: "115" } },
    "invalid_decimal_string"
  ]
];

describe("sizeTrade", () => {
  it("calculates risk amount, stop distance, volume, and risk/reward using decimal strings", () => {
    const result = sizeTrade(validInput);

    expect(result).toEqual({
      ok: true,
      direction: "long",
      entry: "100",
      stop: "95",
      target: "115",
      stopDistance: "5",
      riskAmount: "100",
      volume: "20",
      rr: "3"
    });
  });

  it("rejects when rr is below min_rr and records both values", () => {
    const result = sizeTrade({
      ...validInput,
      minRr: "2",
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "105"
      }
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "rr_below_min",
        source: "tier3.sizing",
        context: {
          rr: "1",
          minRr: "2",
          message: "Risk/reward is below configured minimum"
        }
      }
    });
  });

  it("passes when rr equals min_rr", () => {
    const result = sizeTrade({
      ...validInput,
      minRr: "2",
      candidate: {
        direction: "long",
        entry: "100",
        stop: "95",
        target: "110"
      }
    });

    expect(result.ok).toBe(true);
    expect((result as SizingResult).rr).toBe("2");
  });

  it.each(invalidCases)(
    "rejects invalid input: %s",
    (_name, override, code) => {
      const result = sizeTrade({
        ...validInput,
        ...override,
        candidate: {
          ...validInput.candidate,
          ...override.candidate
        }
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.source).toBe("tier3.sizing");
      }
    }
  );

  it("rejects zero stop distance with a distinct code before division", () => {
    const result = sizeTrade({
      ...validInput,
      candidate: {
        direction: "long",
        entry: "100",
        stop: "100",
        target: "101"
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("zero_stop_distance");
      expect(result.error.source).toBe("tier3.sizing");
    }
  });

  it("is deterministic and does not mutate input", () => {
    const before = structuredClone(validInput);

    const first = sizeTrade(validInput);
    const second = sizeTrade(validInput);

    expect(first).toEqual(second);
    expect(validInput).toEqual(before);
  });

  it("returns every sizing field as a string", () => {
    const result = sizeTrade(validInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const field of ["entry", "stop", "target", "stopDistance", "riskAmount", "volume", "rr"] as const) {
        expect(typeof result[field]).toBe("string");
      }
    }
  });
});
