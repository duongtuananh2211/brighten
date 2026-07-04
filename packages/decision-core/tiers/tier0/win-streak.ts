import { mul, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";
import type { CoreError } from "../../types/index.js";

const source = "tier0.win_streak";

export interface WinStreakInput {
  readonly winStreak: number;
  readonly threshold: number;
  readonly sizeDampening: string;
  readonly riskPct: string;
}

export interface WinStreakResult {
  readonly ok: true;
  readonly dampened: boolean;
  readonly effectiveRiskPct: string;
}

export interface WinStreakRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type WinStreakOutcome = WinStreakResult | WinStreakRejection;

export function evaluateWinStreakDampening(input: WinStreakInput): WinStreakOutcome {
  const riskPct = parseDecimal("riskPct", input.riskPct);
  if (!riskPct.ok) {
    return riskPct;
  }

  const sizeDampening = parseDecimal("sizeDampening", input.sizeDampening);
  if (!sizeDampening.ok) {
    return sizeDampening;
  }

  const dampened = input.winStreak >= input.threshold;
  return {
    ok: true,
    dampened,
    effectiveRiskPct: toDecimalString(dampened ? mul(riskPct.value, sizeDampening.value) : riskPct.value)
  };
}

function parseDecimal(field: string, value: string): WinStreakRejection | { readonly ok: true; readonly value: CoreDecimal } {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", "Expected parseable decimal string", { field, value });
  }
}

function reject(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>>
): WinStreakRejection {
  return {
    ok: false,
    error: {
      code,
      source,
      context: {
        ...context,
        message
      }
    }
  };
}
