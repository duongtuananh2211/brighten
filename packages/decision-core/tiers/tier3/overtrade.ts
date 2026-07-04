import { cmp, div, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";
import type { CoreError } from "../../types/index.js";

const source = "tier3.overtrade";
const zero = toDecimal("0");

export interface OvertradeInput {
  readonly cumulativeFees: string;
  readonly cumulativeGrossProfit: string;
  readonly limit: string;
}

export interface OvertradeAssessment {
  readonly ok: true;
  readonly ratio: string | null;
  readonly flagged: boolean;
}

export interface OvertradeRejection {
  readonly ok: false;
  readonly error: CoreError;
}

type ParsedInput = {
  readonly cumulativeFees: CoreDecimal;
  readonly cumulativeGrossProfit: CoreDecimal;
  readonly limit: CoreDecimal;
};

export type OvertradeOutcome = OvertradeAssessment | OvertradeRejection;

export function evaluateOvertrade(input: OvertradeInput): OvertradeOutcome {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return parsed;
  }

  const { cumulativeFees, cumulativeGrossProfit, limit } = parsed.value;
  if (cmp(cumulativeGrossProfit, zero) <= 0) {
    return {
      ok: true,
      ratio: null,
      flagged: cmp(cumulativeFees, zero) > 0
    };
  }

  const ratio = div(cumulativeFees, cumulativeGrossProfit);
  return {
    ok: true,
    ratio: toDecimalString(ratio),
    flagged: cmp(ratio, limit) > 0
  };
}

function parseInput(input: OvertradeInput): OvertradeRejection | { readonly ok: true; readonly value: ParsedInput } {
  const cumulativeFees = parseDecimal("cumulativeFees", input.cumulativeFees);
  if (!cumulativeFees.ok) {
    return cumulativeFees;
  }

  const cumulativeGrossProfit = parseDecimal("cumulativeGrossProfit", input.cumulativeGrossProfit);
  if (!cumulativeGrossProfit.ok) {
    return cumulativeGrossProfit;
  }

  const limit = parseDecimal("limit", input.limit);
  if (!limit.ok) {
    return limit;
  }

  if (cmp(cumulativeFees.value, zero) < 0) {
    return reject("invalid_cumulative_fees", "Cumulative fees must be a decimal string greater than or equal to 0", {
      cumulativeFees: input.cumulativeFees
    });
  }

  if (cmp(limit.value, zero) <= 0) {
    return reject("invalid_overtrade_limit", "Overtrade limit must be a decimal string greater than 0", {
      limit: input.limit
    });
  }

  return {
    ok: true,
    value: {
      cumulativeFees: cumulativeFees.value,
      cumulativeGrossProfit: cumulativeGrossProfit.value,
      limit: limit.value
    }
  };
}

function parseDecimal(field: string, value: string): OvertradeRejection | { readonly ok: true; readonly value: CoreDecimal } {
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
): OvertradeRejection {
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
