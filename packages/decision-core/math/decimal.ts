import Decimal from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP
});

export type CoreDecimal = string;

export function toDecimal(value: string): CoreDecimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new Error("Expected finite decimal string");
  }

  return parsed.toString();
}

export function add(left: CoreDecimal, right: CoreDecimal): CoreDecimal {
  return decimal(left).plus(right).toString();
}

export function sub(left: CoreDecimal, right: CoreDecimal): CoreDecimal {
  return decimal(left).minus(right).toString();
}

export function mul(left: CoreDecimal, right: CoreDecimal): CoreDecimal {
  return decimal(left).times(right).toString();
}

export function div(left: CoreDecimal, right: CoreDecimal): CoreDecimal {
  return decimal(left).dividedBy(right).toString();
}

export function abs(value: CoreDecimal): CoreDecimal {
  return decimal(value).abs().toString();
}

export function cmp(left: CoreDecimal, right: CoreDecimal): number {
  return decimal(left).comparedTo(right);
}

export function isPositive(value: CoreDecimal): boolean {
  return cmp(value, "0") > 0;
}

export function toDecimalString(value: CoreDecimal): string {
  return value;
}

function decimal(value: CoreDecimal): Decimal {
  return new Decimal(value);
}
