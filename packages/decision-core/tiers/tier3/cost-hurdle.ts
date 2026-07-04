import { cmp, mul, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";
import type { CoreError } from "../../types/index.js";

const source = "tier3.cost_hurdle";
const zero = toDecimal("0");

export interface CostHurdleInput {
  readonly expectedEdge: string;
  readonly roundTripFee: string;
  readonly costHurdleX: string;
}

export interface CostHurdlePass {
  readonly ok: true;
  readonly expectedEdge: string;
  readonly roundTripFee: string;
  readonly hurdle: string;
}

export interface CostHurdleRejection {
  readonly ok: false;
  readonly error: CoreError;
}

type ParsedInput = {
  readonly expectedEdge: CoreDecimal;
  readonly roundTripFee: CoreDecimal;
  readonly costHurdleX: CoreDecimal;
};

export type CostHurdleOutcome = CostHurdlePass | CostHurdleRejection;

export function evaluateCostHurdle(input: CostHurdleInput): CostHurdleOutcome {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return parsed;
  }

  const { expectedEdge, roundTripFee, costHurdleX } = parsed.value;
  const hurdle = mul(costHurdleX, roundTripFee);
  if (cmp(expectedEdge, hurdle) >= 0) {
    return {
      ok: true,
      expectedEdge: toDecimalString(expectedEdge),
      roundTripFee: toDecimalString(roundTripFee),
      hurdle: toDecimalString(hurdle)
    };
  }

  return reject("cost_hurdle_not_met", "Expected edge is below configured cost hurdle", {
    expectedEdge: toDecimalString(expectedEdge),
    hurdle: toDecimalString(hurdle),
    roundTripFee: toDecimalString(roundTripFee),
    costHurdleX: toDecimalString(costHurdleX)
  });
}

function parseInput(input: CostHurdleInput): CostHurdleRejection | { readonly ok: true; readonly value: ParsedInput } {
  const expectedEdge = parseDecimal("expectedEdge", input.expectedEdge);
  if (!expectedEdge.ok) {
    return expectedEdge;
  }

  const roundTripFee = parseDecimal("roundTripFee", input.roundTripFee);
  if (!roundTripFee.ok) {
    return roundTripFee;
  }

  const costHurdleX = parseDecimal("costHurdleX", input.costHurdleX);
  if (!costHurdleX.ok) {
    return costHurdleX;
  }

  if (cmp(roundTripFee.value, zero) < 0) {
    return reject("invalid_round_trip_fee", "Round-trip fee must be a decimal string greater than or equal to 0", {
      roundTripFee: input.roundTripFee
    });
  }

  if (cmp(costHurdleX.value, zero) <= 0) {
    return reject("invalid_cost_hurdle_x", "Cost hurdle multiplier must be a decimal string greater than 0", {
      costHurdleX: input.costHurdleX
    });
  }

  return {
    ok: true,
    value: {
      expectedEdge: expectedEdge.value,
      roundTripFee: roundTripFee.value,
      costHurdleX: costHurdleX.value
    }
  };
}

function parseDecimal(field: string, value: string): CostHurdleRejection | { readonly ok: true; readonly value: CoreDecimal } {
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
): CostHurdleRejection {
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
