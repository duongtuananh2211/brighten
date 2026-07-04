import { add, cmp, mul, toDecimal, toDecimalString } from "../math/decimal.js";
import type { CoreDecimal } from "../math/decimal.js";
import type { CoreError } from "../types/index.js";

const source = "cost.round_trip";
const zero = toDecimal("0");

// A funding accrual point observed while a perp-crypto position is held.
// FX / non-perp instruments simply omit fundingPoints ⇒ funding = 0.
export interface RoundTripFundingPoint {
  readonly fundingRate: string;
}

export interface RoundTripCostInput {
  readonly notional: string;
  readonly feeRate: string;
  readonly spread: string;
  readonly slippage: string;
  readonly fundingPoints?: readonly RoundTripFundingPoint[];
}

export interface RoundTripCostResult {
  readonly ok: true;
  readonly cost: string;
}

export interface RoundTripCostRejection {
  readonly ok: false;
  readonly error: CoreError;
}

export type RoundTripCostOutcome = RoundTripCostResult | RoundTripCostRejection;

type ParsedInput = {
  readonly notional: CoreDecimal;
  readonly feeRate: CoreDecimal;
  readonly spread: CoreDecimal;
  readonly slippage: CoreDecimal;
  readonly fundingRates: readonly CoreDecimal[];
};

// Single source of round-trip cost, in quote units, used both by the Tier 3
// cost-hurdle gate (estimated notional) and by backtest P&L accounting (real
// notional + real funding). Pure: no IO, no mutation, decimal-only.
export function computeRoundTripCost(input: RoundTripCostInput): RoundTripCostOutcome {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return parsed;
  }

  const { notional, feeRate, spread, slippage, fundingRates } = parsed.value;

  const perSideRate = add(add(feeRate, spread), slippage);
  const perSide = mul(perSideRate, notional);
  const base = mul(perSide, "2");

  const funding = fundingRates.reduce<CoreDecimal>(
    (accumulated, fundingRate) => add(accumulated, mul(fundingRate, notional)),
    zero
  );

  return { ok: true, cost: toDecimalString(add(base, funding)) };
}

function parseInput(
  input: RoundTripCostInput
): RoundTripCostRejection | { readonly ok: true; readonly value: ParsedInput } {
  const notional = parseDecimal("notional", input.notional);
  if (!notional.ok) {
    return notional;
  }

  const feeRate = parseDecimal("feeRate", input.feeRate);
  if (!feeRate.ok) {
    return feeRate;
  }

  const spread = parseDecimal("spread", input.spread);
  if (!spread.ok) {
    return spread;
  }

  const slippage = parseDecimal("slippage", input.slippage);
  if (!slippage.ok) {
    return slippage;
  }

  if (cmp(notional.value, zero) < 0) {
    return reject("invalid_notional", "Notional must be a decimal string greater than or equal to 0", {
      notional: input.notional
    });
  }

  const fundingRates: CoreDecimal[] = [];
  for (const [index, point] of (input.fundingPoints ?? []).entries()) {
    const fundingRate = parseDecimal("fundingRate", point.fundingRate, { index });
    if (!fundingRate.ok) {
      return fundingRate;
    }
    fundingRates.push(fundingRate.value);
  }

  return {
    ok: true,
    value: {
      notional: notional.value,
      feeRate: feeRate.value,
      spread: spread.value,
      slippage: slippage.value,
      fundingRates
    }
  };
}

function parseDecimal(
  field: string,
  value: string,
  extraContext: Readonly<Record<string, unknown>> = {}
): RoundTripCostRejection | { readonly ok: true; readonly value: CoreDecimal } {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", "Expected parseable decimal string", { field, value, ...extraContext });
  }
}

function reject(code: string, message: string, context: Readonly<Record<string, unknown>>): RoundTripCostRejection {
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
