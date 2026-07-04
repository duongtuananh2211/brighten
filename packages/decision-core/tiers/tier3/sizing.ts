import type { CoreError, TradeCandidate, TradeDirection } from "../../types/index.js";
import { abs, cmp, div, isPositive, mul, sub, toDecimal, toDecimalString } from "../../math/decimal.js";
import type { CoreDecimal } from "../../math/decimal.js";

const source = "tier3.sizing";
const oneHundred = toDecimal("100");
const zero = toDecimal("0");

export interface SizingInput {
  readonly equity: string;
  readonly candidate: TradeCandidate;
  readonly riskPct: string;
  readonly minRr: string;
}

export interface SizingResult {
  readonly ok: true;
  readonly direction: TradeDirection;
  readonly entry: string;
  readonly stop: string;
  readonly target: string;
  readonly stopDistance: string;
  readonly riskAmount: string;
  readonly volume: string;
  readonly rr: string;
}

export interface SizingRejection {
  readonly ok: false;
  readonly error: CoreError;
}

type ParsedInput = {
  readonly equity: CoreDecimal;
  readonly entry: CoreDecimal;
  readonly stop: CoreDecimal;
  readonly target: CoreDecimal;
  readonly riskPct: CoreDecimal;
  readonly minRr: CoreDecimal;
};

export type SizingOutcome = SizingResult | SizingRejection;

export function sizeTrade(input: SizingInput): SizingOutcome {
  const parsed = parseInput(input);
  if (!parsed.ok) {
    return parsed;
  }

  const { equity, entry, stop, target, riskPct, minRr } = parsed.value;
  const stopDistance = abs(sub(entry, stop));
  if (cmp(stopDistance, zero) === 0) {
    return reject("zero_stop_distance", "Entry and stop must differ", {
      entry: input.candidate.entry,
      stop: input.candidate.stop
    });
  }

  const sideError = validateSide(input.candidate.direction, entry, stop, target);
  if (sideError !== undefined) {
    return reject("invalid_setup_side", sideError, {
      direction: input.candidate.direction,
      entry: input.candidate.entry,
      stop: input.candidate.stop,
      target: input.candidate.target
    });
  }

  const riskAmount = div(mul(equity, riskPct), oneHundred);
  const volume = div(riskAmount, stopDistance);
  const rr = div(abs(sub(target, entry)), stopDistance);

  if (cmp(rr, minRr) < 0) {
    return reject("rr_below_min", "Risk/reward is below configured minimum", {
      rr: toDecimalString(rr),
      minRr: input.minRr
    });
  }

  return {
    ok: true,
    direction: input.candidate.direction,
    entry: toDecimalString(entry),
    stop: toDecimalString(stop),
    target: toDecimalString(target),
    stopDistance: toDecimalString(stopDistance),
    riskAmount: toDecimalString(riskAmount),
    volume: toDecimalString(volume),
    rr: toDecimalString(rr)
  };
}

function parseInput(input: SizingInput): SizingRejection | { readonly ok: true; readonly value: ParsedInput } {
  const equity = parseDecimal("equity", input.equity);
  if (!equity.ok) {
    return equity;
  }

  const entry = parseDecimal("entry", input.candidate.entry);
  if (!entry.ok) {
    return entry;
  }

  const stop = parseDecimal("stop", input.candidate.stop);
  if (!stop.ok) {
    return stop;
  }

  const target = parseDecimal("target", input.candidate.target);
  if (!target.ok) {
    return target;
  }

  const riskPct = parseDecimal("riskPct", input.riskPct);
  if (!riskPct.ok) {
    return riskPct;
  }

  const minRr = parseDecimal("minRr", input.minRr);
  if (!minRr.ok) {
    return minRr;
  }

  if (!isPositive(equity.value)) {
    return reject("invalid_equity", "Equity must be a decimal string greater than 0", { equity: input.equity });
  }

  if (!isPositive(riskPct.value) || cmp(riskPct.value, oneHundred) >= 0) {
    return reject("invalid_risk_pct", "Risk percent must be greater than 0 and less than 100", {
      riskPct: input.riskPct
    });
  }

  if (!isPositive(minRr.value)) {
    return reject("invalid_min_rr", "Minimum R:R must be a decimal string greater than 0", { minRr: input.minRr });
  }

  return {
    ok: true,
    value: {
      equity: equity.value,
      entry: entry.value,
      stop: stop.value,
      target: target.value,
      riskPct: riskPct.value,
      minRr: minRr.value
    }
  };
}

function parseDecimal(field: string, value: string): SizingRejection | { readonly ok: true; readonly value: CoreDecimal } {
  try {
    return { ok: true, value: toDecimal(value) };
  } catch {
    return reject("invalid_decimal_string", "Expected parseable decimal string", { field, value });
  }
}

function validateSide(
  direction: TradeDirection,
  entry: CoreDecimal,
  stop: CoreDecimal,
  target: CoreDecimal
): string | undefined {
  if (direction === "long") {
    return cmp(stop, entry) < 0 && cmp(entry, target) < 0
      ? undefined
      : "Long setup requires stop < entry < target";
  }

  return cmp(target, entry) < 0 && cmp(entry, stop) < 0
    ? undefined
    : "Short setup requires target < entry < stop";
}

function reject(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>>
): SizingRejection {
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
