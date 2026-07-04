import { describe, expect, it } from "vitest";
import type { WinStreakInput } from "./win-streak.js";
import { evaluateWinStreakDampening } from "./win-streak.js";

const input: WinStreakInput = {
  winStreak: 3,
  threshold: 3,
  sizeDampening: "0.5",
  riskPct: "1"
};

describe("evaluateWinStreakDampening", () => {
  it("dampens risk when win streak reaches the threshold", () => {
    expect(evaluateWinStreakDampening(input)).toEqual({
      ok: true,
      dampened: true,
      effectiveRiskPct: "0.5"
    });
  });

  it("does not dampen risk one win below the threshold", () => {
    expect(evaluateWinStreakDampening({ ...input, winStreak: 2 })).toEqual({
      ok: true,
      dampened: false,
      effectiveRiskPct: "1"
    });
  });

  it.each([
    ["bad size dampening", { sizeDampening: "wat" }],
    ["bad risk pct", { riskPct: "Infinity" }]
  ])("rejects invalid decimal input: %s", (_name, override) => {
    const result = evaluateWinStreakDampening({ ...input, ...override });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid_decimal_string",
        source: "tier0.win_streak"
      }
    });
  });

  it("is deterministic and does not mutate input", () => {
    const before = structuredClone(input);

    const first = evaluateWinStreakDampening(input);
    const second = evaluateWinStreakDampening(input);

    expect(first).toEqual(second);
    expect(input).toEqual(before);
  });

  it("returns effective risk as a string", () => {
    const result = evaluateWinStreakDampening(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.effectiveRiskPct).toBe("string");
    }
  });
});
